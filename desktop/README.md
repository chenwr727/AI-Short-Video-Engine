# 桌面版（TypeScript 重写）

结构：Electron 外壳 + 独立 Node 后端 + React 前端，三块通过 HTTP 与 SSE 通信。

```
desktop/   Electron 外壳（拉起后端、自绘菜单、免安装模式、打包）
server/    Fastify + TS 后端（抓取 / 剧本 / 配音 / 素材 / 合成）
web/       React + Vite 前端（由后端在打包态托管）
```

## 开发

```bash
# 1) 依赖（仓库根目录执行）
pnpm install                  # server + web
npm --prefix desktop install  # Electron 等

# Electron 二进制若被 npm 拦截，手动补一次（国内建议走镜像）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node desktop/node_modules/electron/install.js

# 2) 启动（自动构建前端 + 编译主进程 + 拉起后端）
npm --prefix desktop run dev
```

只想调后端/前端时可以分开跑：

```bash
pnpm dev:server   # http://127.0.0.1:4000
pnpm dev:web      # http://127.0.0.1:3000，/api 已代理到 4000
```

Electron 在开发态会复用已在运行的 `:4000` 后端，不会重复拉起。

## 配置

配置文件位于应用数据目录的 `config.json`，首次启动自动生成：

| 平台 | 路径 |
| --- | --- |
| 免安装 | `<exe 同级>/UserData/config.json` |
| 安装 | `%APPDATA%/aisv-desktop/config.json` |
| 开发 | `%APPDATA%/aisv-desktop/config.json` |

字段说明：

| 分组 | 字段 | 说明 |
| --- | --- | --- |
| LLM | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | `LLM_API_URL` 可只填域名（自动补 `/chat/completions`） |
| 配音 | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` | 百炼 key；专用 MaaS 域名填到 `/api/v1` |
| 配音 | `SEED_TTS_API_KEY` / `TTS_SEED_RESOURCE_ID` / `TTS_SEED_MODEL` | 豆包（火山引擎）；不填 Key 则不出现该引擎 |
| 素材 | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | 取其一即可 |
| 画面 | `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `FPS` / `TTS_SPEED` | 默认 1080×1920 / 24fps |

环境变量优先级高于文件，便于临时覆盖。

## 打包

```bash
npm --prefix desktop run dist:win   # Windows 免安装 zip
```

产物：`desktop/release/AI Short Video-0.1.0-win-portable.zip`（约 219MB，5001 个条目）。
`compression: maximum` 会让 zip 阶段跑约 20 分钟，日常迭代可临时改成 `normal`。

解压后双击 `AI Short Video.exe` 即为免安装运行，数据落在同级 `UserData/`：

```
UserData/config.json   # 首次启动自动生成，需填 API Key
UserData/data/         # 工作目录、成片、素材缓存
```

开发态的配置在 `%APPDATA%/aisv-desktop/config.json`，可直接复制过去复用。

流程：前端构建 → 生成图标 → 复制 ffmpeg/ffprobe → 暂存后端并装生产依赖 → 编译主进程 → electron-builder → 产物自检。

关键点：后端暂存到 `build/resources/payload/server`（多套一层 `payload/`，否则 electron-builder 会丢掉顶层 `node_modules`），并用 `--node-linker=hoisted` 重装成扁平依赖，避免 pnpm 符号链接在打包后失效。

## 当前进度

- [x] 骨架：Fastify 服务（health/meta/静态托管）+ React 页面 + Electron 外壳
- [x] 随包 ffmpeg/ffprobe、免安装模式、产物自检
- [x] 内容抓取（含 36kr 解密）+ LLM 两段写稿 + 分句 + 剧本确认与编辑
- [x] TTS 配音（CosyVoice / Edge / 豆包，含音色分配、时长解析、断点复用）
- [x] 素材检索与选片（Pixabay / Pexels、竖屏优先、AI 语义选片 + 时长兜底、下载缓存与校验）
- [x] ASS 字幕（libass 自动换行）+ ffmpeg 分段合成 + 转场/程序化 BGM
- [x] 素材预览步骤（逐段播放、换素材后重新合成）
- [x] 图形化设置面板 + 自绘标题栏菜单（文件 / 帮助），首次启动缺配置时自动弹出
