简体中文 | [English](README_EN.md)

# 桌面版（Electron 外壳）

Electron 只做三件事：**拉起后端进程**、**管好数据目录**、**打包成免安装 zip**。业务逻辑全在 `server/`，界面全在 `web/`。

```
desktop/   Electron 外壳：进程编排、免安装模式、自绘菜单、打包流水线
server/    Fastify + TS 后端：抓取 / 剧本 / 配音 / 素材 / 合成
web/       React + Vite 前端：打包态由后端托管，Electron 窗口只是加载它的 URL
```

窗口与后端之间是普通 HTTP + SSE，Electron 不参与业务数据流转，只负责进程编排与文件系统操作。

## 主进程行为

### 启动顺序

```
setupPortableMode()      → 有 portable.txt 就把 userData 改到 exe 同级
ensureConfig()           → 首次启动写入默认 config.json
ensureBackend()          → 选端口、spawn 后端、轮询 /api/health 直到就绪
createMainWindow(url)    → 窗口只是 loadURL(后端地址)
health() 检查 LLM Key    → 未配置则弹设置页
```

后端 spawn 方式：`process.execPath` + `tsx/dist/cli.mjs` + `server/src/index.ts`，环境变量 `ELECTRON_RUN_AS_NODE=1` 让 Electron 二进制以纯 Node 身份跑。所以**打包后不需要额外 Node 运行时**。

### 端口策略

| 模式 | 端口 |
| --- | --- |
| 开发态 | 固定 `4000`，已在运行则直接复用（避免重复拉起） |
| 打包态 | `findFreePort()` 动态分配 |

复用外部后端时 `backend.proc === null`，此时「保存并重启后端」无法生效，IPC 返回 `reused: true`，界面会提示手动重启。

### 免安装模式

exe 同级存在 `portable.txt` 即启用，`userData` 改指 `<exe 同级>/UserData`。会先做写权限探测，目录不可写（比如放在 Program Files）则打日志并回退到 `%APPDATA%/shortdeck-desktop`。

删掉 `portable.txt` 就切成安装模式，数据回到 `%APPDATA%`。

### IPC 与快捷键

菜单由渲染层绘制（`titleBarStyle: hidden`），主进程只保留窗口按钮，`Menu.setApplicationMenu(null)`。macOS 例外：保留 `appMenu` / `editMenu`，否则系统快捷键失效。

| 通道 | 用途 |
| --- | --- |
| `settings:get` / `settings:save` | 读写配置，附带 `__defaults` 供「恢复默认」使用 |
| `settings:test` | 把**表单当前值**转发到 `/api/config-test`，未保存也能试 |
| `settings:restart` | 停旧后端 → 重新 spawn → 主窗口重载 |
| `app:menu` | 菜单动作：设置 / 输出目录 / 数据目录 / 配置文件 / 关于 / 文档 / 反馈 |
| `music:pick` / `app:reveal-file` | 系统选文件对话框、在资源管理器中定位成片 |

快捷键在 `before-input-event` 里兜住：`Ctrl+,` 设置、`Ctrl+O` 打开输出目录、`Ctrl+N` 新建任务（发 `app:new-task` 给渲染层）。

窗口 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 `preload.ts` 暴露的 `window.aisv` 访问主进程能力。

## 开发

```bash
# 仓库根目录
pnpm install                  # server + web
npm --prefix desktop install  # Electron / electron-builder / sharp

# Electron 二进制被 npm 拦截时手动补一次
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node desktop/node_modules/electron/install.js

# 启动：构建前端 → 生成图标 → 复制 ffmpeg → 暂存后端 → 编译主进程 → 开窗口
pnpm dev
```

只调一端时分开跑：

```bash
pnpm dev:server   # http://127.0.0.1:4000
pnpm dev:web      # http://127.0.0.1:3000，/api 已代理到 4000
```

Electron 在开发态会复用已在运行的 `:4000` 后端。调试用 `SHORTDECK_OPEN_DEVTOOLS=1`。

## 配置

配置读写走白名单：`config.ts` 里的 `DEFAULTS` 键集合是唯一允许的范围，`saveConfig` 会把范围外的键直接丢掉。

同一批键散落在三处，漏改只会静默丢值而不报错，因此 `pnpm check:config` 会校验三者是否一致：

| 位置 | 角色 |
| --- | --- |
| `server/src/config.ts` | 唯一真源 |
| `desktop/src/config.ts` | 白名单与默认值 |
| `desktop/assets/settings.html` | 表单字段（`data-key`） |

配置文件位置随运行方式变化：

| 运行方式 | 路径 |
| --- | --- |
| 免安装 | `<exe 同级>/UserData/config.json` |
| 安装 / 开发 | `%APPDATA%/shortdeck-desktop/config.json` |

启动后端时，配置文件的每个非空值都会注入成环境变量（`buildEnv`），另外固定注入 `SHORTDECK_DATA_DIR`、`SHORTDECK_OUT_DIR`、`SHORTDECK_ASSETS_DIR`、`SHORTDECK_CONFIG_FILE`、`SHORTDECK_VERSION`、`PORT`、`HOST`。`build/bin` 存在时会加进 `PATH` 并设 `SHORTDECK_BIN_DIR`。

保存用「写临时文件 + rename」保证原子性，POSIX 下 mode 收窄到 `0600`（文件里有 API Key）。解析失败会先备份成 `config.json.corrupt-<时间戳>` 再回退默认值，避免下次保存覆盖掉已填的 Key。

字段含义见[主 README 的配置表](../README.md#配置)。

## 打包

```bash
pnpm dist:win     # 构建 → electron-builder → 产物自检
```

产物：`desktop/release/ShortDeck-<version>-win-portable.zip`，当前 `0.2.0` 约 214 MB / 2719 个条目。`compression: maximum` 让 zip 阶段要跑很久，日常迭代可临时改成 `normal`。

解压即用，数据落在同级 `UserData/`：

```
UserData/config.json   # 首次启动自动生成，需填 API Key
UserData/data/         # 工作目录、成片、素材缓存
```

### 流水线

```
web 构建 → 生成图标 → 复制 ffmpeg/ffprobe → 暂存后端并装生产依赖
        → tsc 编译主进程 → electron-builder → verify-pack 自检
```

`scripts/build.mjs` 是逐个 `spawnSync` 而不是链式 `&&`：Windows 上子进程被系统杀掉会得到 `0x80000003` 这类 NTSTATUS 退出码，链式命令只报一句 ELIFECYCLE，看不出死在哪一步。现在会明确指出步骤名并翻译退出码。

### 几个必须遵守的点

**后端多套一层 `payload/`**
暂存到 `build/resources/payload/server`，再整体映射到 `resources/`。直接放顶层 `node_modules` 会被 electron-builder 的默认排除规则丢掉。

**依赖用 `--node-linker=hoisted` 重装**
pnpm 默认的符号链接结构打包后会失效，必须重装成扁平依赖。安装加 `--ignore-scripts`，避免在暂存目录里触发原生模块编译。

**依赖缓存标记**
`package.json` + `pnpm-lock.yaml` 的内容哈希写进 `node_modules/.aisv-stage-stamp`，一致则跳过 `pnpm install`。用内容哈希而非 mtime——`cpSync` 不保留时间戳。

**ffmpeg 固定用 essentials 构建**
从 gyan.dev 取 `ffmpeg-release-essentials.zip`，版本锁定在 `ESSENTIALS_VERSION`，缓存在 `build/.cache`。原由：`ffmpeg-static` 与 `ffprobe-static` 差两个大版本，ffprobe 认不出新容器会让时长探测静默失败；系统 PATH 里的 full build 又各 217 MB，多出约 230 MB 用不到的东西。essentials 只含常用库，保留 `libx264` + `aac` + `libass`，正好覆盖成片渲染。

**精简 Electron 语言包**
自带 55 个语言包共 48 MB，只留 `zh-CN` / `zh-TW` / `en-US`。`en-US` 是 Chromium 的兜底语言，删掉界面会异常。

**剔除运行时读不到的文件**
依赖里约 12 MB 是 sourcemap、README、类型声明、测试用例。Node 只加载 `package.json` 的 `main` / `exports` 指向的 `.js`，这些文件永远不会被读到，在 `extraResources.filter` 里排除。

## 脚本一览

| 脚本 | 作用 |
| --- | --- |
| `scripts/build.mjs` | 顺序执行全部构建步骤，失败时报步骤名与退出码 |
| `scripts/make-icon.mjs` | 从 `web/public/favicon.svg` 生成 1024px 图标（`build/` 与 `assets/` 各一份） |
| `scripts/copy-ffmpeg.mjs` | 取 ffmpeg/ffprobe 到 `build/bin`，已是最新则跳过 |
| `scripts/stage-server.mjs` | 暂存后端 + 装生产依赖 + 关键文件自检 |
| `scripts/verify-pack.mjs` | 产物自检：缺关键文件即失败，`win-unpacked` 部分缺失只警告 |

在 `desktop/` 下用 `npm run icon` / `ffmpeg` / `stage` / `verify` 可单独跑，便于定位。

## 排查

**窗口白屏**
`web/dist/index.html` 不存在时后端不会托管前端。先 `pnpm build:web`。

**后端起不来**
日志以 `[server]` 前缀打在 Electron 控制台。常见原因：`tsx` 没装（提示会列出尝试过的路径）、端口被占、`server/src/index.ts` 缺失。

**「保存并重启后端」无反应**
后端是外部启动的（`pnpm dev:server` 先跑起来了），主进程停不掉它，需手动重启。

**打包后缺文件**
在 `desktop/` 下跑 `npm run verify`，它会逐项检查 `build/bin`、`build/resources/payload`、`web/dist`、`dist/main.js`；再检查 `release/win-unpacked/resources` 下的实际产物。

**macOS 快捷键失效**
确认 `buildMenu()` 走了 `appMenu` / `editMenu` 分支——设成 `null` 会让系统级快捷键全部失灵。

## 平台差异

| 项 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 标题栏 | `hidden` + `titleBarOverlay` | `hiddenInset` + 红绿灯偏移 | `hidden` + overlay |
| 应用菜单 | 置空，交给渲染层 | 保留 `appMenu` / `editMenu` | 置空 |
| 打包目标 | zip（x64） | dmg（最低 11.0） | AppImage |
| 字幕字体 | 微软雅黑 | 系统字体 | libass 回退，字形可能有差异 |
