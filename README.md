简体中文 | [English](README_EN.md)

# AI Short Video Engine

把一篇网页文章、一段文案或一个链接，自动做成带多角色配音与字幕的竖屏短视频。

Electron 桌面应用，TypeScript 全栈（Electron + Fastify + React），开箱自带 ffmpeg，Windows 免安装解压即用。

```
文案脚本 → 剧本生成 → 配音合成 → 素材确认 → 成片预览
```

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2f6fed)

## 目录

- [特性](#特性)
- [示例展示](#示例展示)
- [快速开始](#快速开始)
- [配置](#配置)
- [使用流程](#使用流程)
- [任务产物与断点续跑](#任务产物与断点续跑)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [打包](#打包)
- [环境变量](#环境变量)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [致谢](#致谢)
- [许可](#许可)

## 特性

- **一条流水线跑完**：抓取正文（含 36kr 解密）→ LLM 写稿 → 改写成结构化剧本 → 分句 → 配音 → 检索素材 → 合成带字幕成片
- **两步人工确认**：剧本生成后暂停可逐句改台词；素材匹配后暂停可逐段预览、不满意就换一段，避免"配音做完才发现文案不对"或"素材不搭"
- **多引擎配音**：Edge 在线语音（免费、默认）/ CosyVoice（DashScope）/ 豆包 Seed-TTS（火山引擎），同一角色固定音色，按角色分配
- **素材语义匹配**：Pixabay / Pexels 检索，竖屏优先，AI 选片失败时用时长规则兜底
- **字幕与转场**：ASS + libass 渲染（系统字体自动换行）、`xfade` / `acrossfade` 段落转场、程序化生成 BGM
- **随时可停可续**：每个阶段产物落盘（`_terms.json`、音频、`_videos.json`、`_output.mp4`），中断后重跑只补缺失部分
- **桌面体验**：自绘标题栏菜单（文件 / 帮助）、首次启动自动弹出设置页、图形化配置面板、免安装模式

## 示例展示

> 示例视频经过剪辑压缩，仅展示部分效果。同一篇原文换不同脚本风格即可复现，完整成片可用本项目自行生成。

📄 **示例原文**：[36kr 原文](https://36kr.com/p/3286128054051718)

<table>
  <thead>
    <tr>
      <th align="center">▶️ 播客</th>
      <th align="center">▶️ 相声</th>
      <th align="center">▶️ 脱口秀</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><video src="https://github.com/user-attachments/assets/a8a4175d-2ebf-47cc-9c81-8c9a7aa78ae1"></video></td>
      <td align="center"><video src="https://github.com/user-attachments/assets/d1819bc3-c909-4ede-927c-57a10f609827"></video></td>
      <td align="center"><video src="https://github.com/user-attachments/assets/896de713-e059-4834-b5ca-91a514d89d24"></video></td>
    </tr>
  </tbody>
</table>

三种效果对应界面里的脚本风格：**播客**（两人对谈，信息密度高）、**相声**（捧逗互动，节奏快）、**脱口秀**（单人讲述，只需填主讲角色名）。

## 快速开始

### 方式一：下载免安装包（Windows）

到 [Releases](https://github.com/chenwr727/AI-Short-Video-Engine/releases) 下载 `AI Short Video-x.y.z-win-portable.zip`，解压后双击 `AI Short Video.exe`。

内置 ffmpeg / ffprobe，无需安装 Node、Python 或任何运行时。首次启动会自动弹出设置页，填好 API Key 就能用。

数据落在 exe 同级的 `UserData/`：

```
UserData/config.json   # 配置，首次启动自动生成
UserData/data/         # 工作目录、成片、素材缓存
```

### 方式二：从源码运行

需要 Node.js 20+（建议 22 LTS）与 pnpm。默认主分支为 `main`：

```bash
# 克隆主分支
git clone -b main https://github.com/chenwr727/AI-Short-Video-Engine.git
cd AI-Short-Video-Engine

# 已有仓库时：切回主分支并更新
git checkout main && git pull --ff-only

# 依赖：server + web 用 pnpm，desktop 用 npm
pnpm install
npm --prefix desktop install

# 启动（自动构建前端 → 编译主进程 → 拉起后端 → 打开窗口）
pnpm dev
```

Electron 二进制若下载失败，可手动补一次：

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

只想调后端或前端时也可以分开跑：

```bash
pnpm dev:server   # Fastify，http://127.0.0.1:4000
pnpm dev:web      # Vite，http://127.0.0.1:3000（/api 已代理到 4000）
```

Electron 开发态会复用已在运行的 `:4000` 后端，不会重复拉起。

## 配置

界面里通过 **文件 → 设置…**（`Ctrl+,`）填写，保存后自动重启后端生效。配置文件位置：

| 运行方式 | 路径 |
| --- | --- |
| 免安装版 | `<exe 同级>/UserData/config.json` |
| 安装版 / 开发态 | `%APPDATA%/aisv-desktop/config.json` |

**最小可用配置**：`LLM_API_KEY`（及对应的 `LLM_API_URL` / `LLM_MODEL`）＋ `PIXABAY_API_KEY` 或 `PEXELS_API_KEY` 任选一个。配音默认走免费的 Edge 在线语音，无需额外 Key。

字段说明（环境变量优先级高于文件，便于临时覆盖）：

| 分组 | 字段 | 说明 |
| --- | --- | --- |
| 大模型 | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | **必填**。任何 OpenAI 兼容接口；`LLM_API_URL` 可只填域名，自动补全接口路径 |
| 配音（必选其一） | — | Edge 在线语音免费、无需 Key，默认可用 |
| 配音（DashScope） | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `DASHSCOPE_WS_URL` / `TTS_COSYVOICE_MODEL` | 填 Key 后出现 CosyVoice；WebSocket 地址留空会自动推导 |
| 配音（豆包） | `SEED_TTS_API_KEY` / `TTS_SEED_RESOURCE_ID` / `TTS_SEED_MODEL` | 填 Key 后出现豆包引擎 |
| 素材 | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | **至少填一个**，否则无法检索素材 |
| 素材 | `MATERIAL_MIN_DURATION` | 候选素材最短时长（秒），默认 10 |
| 画面 | `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `FPS` / `TTS_SPEED` | 默认 1080×1920 / 24fps / 1.1 倍速 |
| 画面 | `TRANSITION_DURATION` | 段落转场秒数，默认 0.5；设为 0 关闭转场 |
| 字幕 | `SUBTITLE_FONT_SIZE` | 字幕字号（px），默认 0 = 按画面宽度自动换算（1080 宽约 72px，720 宽约 48px）；标题按 1.4 倍放大 |
| 画面 | `VIDEO_FADE_IN` / `VIDEO_FADE_OUT` | 成片开头/结尾淡入淡出秒数，默认 0.5；设为 0 关闭 |
| BGM | `BGM_ENABLED` | 是否混入背景音乐，默认 1；填 0 只保留配音 |
| BGM | `BGM_VOLUME` | BGM 音量，默认 0.1（1 = 原音量） |
| BGM | `AUDIO_FADE_IN` / `AUDIO_FADE_OUT` | BGM 淡入/淡出秒数，默认 0.8 / 1.2；设为 0 关闭 |
| BGM | `AISV_MUSIC_DIR` | 自定义音乐目录，默认 `<数据目录>/music`；成片页只填文件名时按它解析 |

上面这些是全局默认值。**成片预览** 页还能按任务单独改字幕字号、是否插入 BGM、BGM 音量与自定义音乐：字号框里显示的是按当前分辨率算好的具体 px（不显示 0），支持 mp3/wav/m4a/aac/ogg/flac（绝对路径，或 `AISV_MUSIC_DIR` 目录下的文件名），文件找不到时自动退回程序合成并在日志里提示。改完点「重新生成」只重跑合成，配音与素材全部复用；改字号会额外重渲染烧了字幕的分段片段。

音色表内置在 `server/src/voices.ts`，界面上按角色选择，不需要写进配置。

## 使用流程

1. **文案脚本**：粘贴网页链接或正文，选择脚本风格，点「开始生成」
2. **剧本生成**：AI 抓取并写稿，完成后停下等你确认；标题与每句台词都能直接改
3. **配音合成**：为每个角色选音色，并选配音引擎与语速（默认 1.1 倍，可用配置项 `TTS_SPEED` 改默认值），确认后开始配音
4. **素材确认**：选素材来源（Pixabay / Pexels）与成片分辨率，点「开始匹配素材」；逐段播放匹配到的视频，不满意点「换一个」重新检索候选，选中后替换；确认后点「下一步：成片预览」（此时**不会**自动合成）
5. **成片预览**：先设置字幕字号、是否插入 BGM、BGM 音量与自定义音乐，再点「生成成片」；完成后可改这些参数再点「重新生成」。桌面端点「在文件夹中显示」直接定位成片文件（浏览器里是下载）

顶部步骤条可以点回已完成的步骤回看，历史快照来自后端 SSE 推送。

## 任务产物与断点续跑

每个任务在 `<数据目录>/workspaces/<时间戳>/` 下留一份完整中间产物（源码运行为 `server/data/workspaces/`，免安装版为 `UserData/data/workspaces/`）：

```
20261115-214501/
  _html.txt          # 抓取到的原文
  _transcript.txt    # LLM 草稿
  _transcript.json   # 确认后的结构化剧本
  _terms.json        # 每段素材检索词
  *.mp3              # 分句配音，命名为 段_句_分片
  _durations.json    # 配音时长
  _videos.json       # 素材清单
  clips/ subs/       # 分段视频与 ASS 字幕
  _bgm.wav           # 混入的背景音乐
  _output.mp4        # 成片
```

中断后重跑会复用已有产物，只补缺失部分；在成片页点「重新生成」会清掉 `_output.mp4` 与 `clips/` 重跑合成，配音与素材保持不变。

## 项目结构

```
desktop/          Electron 外壳（窗口与自绘菜单、拉起后端、设置面板、打包脚本）
  src/main.ts       主进程：窗口、IPC、菜单动作、快捷键
  src/preload.ts    暴露给渲染层的最小桥（窗口菜单 / 设置读写）
  assets/settings.html  图形化配置面板
server/           Fastify + TypeScript 后端
  src/pipeline/     抓取写稿 / 分句 / 配音 / 素材 / 合成
  src/services/     LLM、TTS（edge / cosyvoice / seed）、素材站、ffmpeg、字幕
  src/task/         任务状态机与流水线编排（含两个人工确认暂停点）
  assets/prompts/   提示词模板（播客 / 相声 / 脱口秀等风格）
  data/             运行期产物：workspaces/、cache/、out/（不入库）
web/              React + Vite 前端（打包态由后端托管）
```

桌面端开发与打包细节见 [desktop/README.md](desktop/README.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动桌面应用（先构建 web 与主进程） |
| `pnpm dev:server` | 只启动后端 |
| `pnpm dev:web` | 只启动前端（Vite） |
| `pnpm build:web` | 构建前端产物到 `web/dist` |
| `pnpm typecheck` | server + web 类型检查 |
| `pnpm dist:win` | 打包 Windows 免安装 zip |
| `pnpm dist:mac` / `pnpm dist:linux` | 打包 dmg / AppImage |

## 打包

```bash
pnpm dist:win     # 产物：desktop/release/AI Short Video-<version>-win-portable.zip
```

体积约 200MB（含 ffmpeg/ffprobe），`compression: maximum` 会让 zip 阶段跑较久，日常迭代可临时改成 `normal`。

构建流程：前端构建 → 生成图标 → 复制 ffmpeg/ffprobe → 暂存后端并安装生产依赖 → 编译主进程 → electron-builder → 产物自检。

## 环境变量

一般用不到，排查或定制部署时有用：

| 变量 | 作用 |
| --- | --- |
| `AISV_CONFIG_FILE` | 指定 `config.json` 路径 |
| `AISV_DATA_DIR` | 数据目录（工作区 / 缓存 / 成片） |
| `AISV_OUT_DIR` | 成片输出目录 |
| `AISV_ASSETS_DIR` | prompts 等静态资源目录 |
| `AISV_BIN_DIR` | 随包 ffmpeg / ffprobe 所在目录 |
| `PORT` / `HOST` | 后端监听地址，默认 `4000` / `127.0.0.1` |
| `AISV_OPEN_SETTINGS=1` | 启动即打开设置页 |
| `AISV_OPEN_DEVTOOLS=1` | 开发态自动打开 DevTools |
| `AISV_LOG_LEVEL` | 后端日志级别，默认 `info` |

## 常见问题

**提示「未检测到 ffprobe / ffmpeg」**
开发态请安装系统 ffmpeg 并确保在 `PATH` 中；免安装包已内置，若仍报错说明解压不完整。

**改了配置没生效**
设置页点「保存并重启后端」会自动重启后端；如果直接改 `config.json`，需要重启应用（二进制探测有进程内缓存）。

**首次启动弹出设置页**
说明还没填 LLM API Key，填好保存即可，之后不会再弹。

**生成失败 / 素材一直匹配不到**
检查 `PIXABAY_API_KEY` 或 `PEXELS_API_KEY` 是否有效、网络能否访问素材站；LLM 接口超时也会导致写稿阶段失败。

**端口 4000 被占用**
Electron 会复用已在运行的后端；单独跑 `pnpm dev:server` 时可用 `PORT=4001` 换端口。

**打包后程序打不开 / 白屏**
确认 `web/dist` 已构建（`pnpm build:web`），后端日志会在 Electron 控制台以 `[server]` 前缀输出。

## 已知限制

- 单任务串行：同一时间只能跑一个任务，需要排队或等前一个结束
- 素材依赖第三方站（Pixabay / Pexels），必须联网且有可用 Key
- 字幕用系统字体渲染：Windows 走微软雅黑，macOS / Linux 由 libass 回退，字形可能有差异
- CosyVoice 与豆包需要各自平台的 Key，未配置时界面上不会出现对应引擎

## 致谢

`msedge-tts`（在线语音）、`ffmpeg-static` / `ffprobe-static`、Pixabay 与 Pexels 的免费素材 API。

## 许可

仓库暂未附带 `LICENSE` 文件；如需商用或二次分发，请先与作者确认。
