简体中文 | [English](development_EN.md)

# 从源码运行

需要 Node.js 20+（建议 22 LTS）与 pnpm：

```bash
git clone -b main https://github.com/chenwr727/AI-Short-Video-Engine.git
cd AI-Short-Video-Engine

pnpm install                  # server + web
npm --prefix desktop install  # desktop

pnpm dev                      # 构建前端 → 编译主进程 → 拉起后端 → 开窗口
```

Electron 二进制下载失败时手动补一次：

```powershell
# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node desktop/node_modules/electron/install.js
```

```bash
# macOS / Linux
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node desktop/node_modules/electron/install.js
```

只调后端或前端时分开跑：

```bash
pnpm dev:server   # Fastify，http://127.0.0.1:4000
pnpm dev:web      # Vite，http://127.0.0.1:3000（/api 已代理到 4000）
```

开发态 Electron 会复用已在运行的 `:4000` 后端，不会重复拉起。

## 需要 Remotion 卡片时

`remotion/` 是独立的 npm 子工程，不在 pnpm workspace 里，根目录 `pnpm install` 不会装它：

```bash
cd remotion && npm install
```

不装时卡片渲染会失败并按原逻辑回退（片头用字幕标题，其余卡片跳过），不会中断出片。细节见 [remotion.md](remotion.md)。

## 项目结构

```
desktop/     Electron 外壳：窗口与自绘菜单、拉起后端、设置面板、打包脚本
             src/main.ts 主进程 · src/preload.ts 渲染层桥 · assets/settings.html 配置面板
server/      Fastify 后端
             src/pipeline/  抓取写稿 / 分句 / 配音 / 素材 / 版式卡 / 合成
             src/services/  LLM、TTS（edge / cosyvoice / seed）、素材站、ffmpeg、字幕、Remotion、音效
             src/task/      任务状态机与流水线编排（三个人工确认点，版式那步可关）
             src/card-templates.ts  卡片模板清单（片头 / 章节 / 片尾 / 兜底观点卡）
             assets/prompts/  内置提示词模板，可用数据目录下的 prompts/ 覆盖
             data/          运行期产物：workspaces/、cache/、out/（不入库）
web/         React + Vite 前端，打包态由后端托管
remotion/    可选 Remotion 子工程：片头 / 片尾 / 版式卡（独立依赖，不打包进桌面版）
docs/        详细文档，中英双版
```

桌面端开发与打包细节见 [desktop/README.md](../desktop/README.md)。

## 提交前自检

```bash
pnpm typecheck   # 配置一致性 + server / web 类型检查
pnpm lint        # ESLint
pnpm format:check  # Prettier（*.md 已在 .prettierignore 中排除）
pnpm test        # 后端纯函数单测
```

CI 会依次跑这四项。

`pnpm install` 会把 `core.hooksPath` 指向仓库内的 `.githooks`（`scripts/setup-hooks.mjs`），之后 `git push` 会自动先跑 `lint`、`typecheck`、`format:check`，和 CI 的前三项一致，省一次「推上去等 CI 报红」的往返。

- **`test` 不在 hook 里**：`tsx --test` 启动子进程在部分机器上会偶发 `EPERM`，会无故挡住推送，留给 CI。
- **跳过**：`git push --no-verify`。
- **没生效**：确认 `git config core.hooksPath` 输出 `.githooks`；CI 与打包暂存目录不会设置它。
