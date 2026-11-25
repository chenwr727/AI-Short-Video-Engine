简体中文 | [English](configuration_EN.md)

# 配置

界面里通过 **文件 → 设置…**（`Ctrl+,`）填写，保存后自动重启后端生效。配置文件位置：

| 运行方式 | 路径 |
| --- | --- |
| 免安装版 | `<exe 同级>/UserData/config.json` |
| 安装版 / 开发态 | `%APPDATA%/aisv-desktop/config.json` |

字段说明（环境变量优先级高于文件，便于临时覆盖）：

| 分组 | 字段 | 说明 |
| --- | --- | --- |
| 大模型 | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | **必填**。任何 OpenAI 兼容接口；`LLM_API_URL` 可只填域名，自动补全接口路径 |
| 配音（默认） | — | Edge 在线语音免费、无需 Key，开箱可用 |
| 配音（DashScope） | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `DASHSCOPE_WS_URL` / `TTS_COSYVOICE_MODEL` | 填 Key 后出现 CosyVoice；WebSocket 地址留空会自动推导 |
| 配音（豆包） | `SEED_TTS_API_KEY` / `TTS_SEED_RESOURCE_ID` / `TTS_SEED_MODEL` | 填 Key 后出现豆包引擎 |
| 素材 | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | **至少填一个**，否则无法检索素材 |
| 素材 | `MATERIAL_MIN_DURATION` | 候选素材最短时长（秒），默认 10 |
| 素材 | `VISION_SELECT` | 用缩略图让模型看画面选片，默认 1；模型不支持图片输入时自动退回标签选片 |
| 素材 | `SHOTS_PER_PARAGRAPH` | 每段镜头数 1-3，默认 2；按句子边界切镜，1 = 整段只用一条素材 |
| 素材 | `QUOTE_FALLBACK` | 1 = 某段搜不到素材时改用设计卡，默认开；0 = 直接报错中断 |
| 画面 | `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `FPS` / `TTS_SPEED` | 默认 1080×1920 / 24fps / 1.1 倍速 |
| 画面 | `CAMERA_MOTION` | 运镜强度 0-10，默认 6；推近/拉远/平移按段落轮换，0 = 静止画面 |
| 画面 | `COLOR_GRADE` | 调色强度 0-10，默认 5；统一对比度/饱和/暗角/颗粒，0 = 不调色 |
| 画面 | `TRANSITION_DURATION` | 段落转场秒数，默认 0.5；设为 0 关闭转场 |
| 画面 | `TRANSITION_STYLE` | `mixed`（默认）按段落轮换转场，`fade` 统一淡入淡出 |
| 字幕 | `SUBTITLE_FONT_SIZE` | 字幕字号（px），默认 0 = 按画面宽度自动换算（1080 宽约 72px，720 宽约 48px）；标题按 1.4 倍放大 |
| 画面 | `VIDEO_FADE_IN` / `VIDEO_FADE_OUT` | 成片开头/结尾淡入淡出秒数，默认 0.5；设为 0 关闭 |
| BGM | `BGM_ENABLED` | 是否混入背景音乐，默认 1；填 0 只保留配音 |
| BGM | `BGM_VOLUME` | BGM 音量，默认 0.1（1 = 原音量） |
| BGM | `AUDIO_FADE_IN` / `AUDIO_FADE_OUT` | BGM 淡入/淡出秒数，默认 0.8 / 1.2；设为 0 关闭 |
| BGM | `AISV_MUSIC_DIR` | 自定义音乐目录，默认 `<数据目录>/music`；成片页只填文件名时按它解析 |
| 音效 | `SFX_ENABLED` / `SFX_VOLUME` | 转场与片头音效，默认开 / 0.2；音效由 ffmpeg 程序合成，可用 `AISV_SFX_DIR` 放 `whoosh.wav` / `impact.wav` 替换 |
| 片头 | `INTRO_ENABLED` | 1 = 用 Remotion 模板渲染片头（需先安装 `remotion/` 依赖），默认 0；渲染失败自动回退到字幕标题 |
| 片尾 | `OUTRO_DURATION` / `OUTRO_TITLE` / `OUTRO_HANDLE` | 片尾卡片秒数（0 = 不加）、标题文案、账号名（留空不显示） |
| 过场 | `CHAPTER_CARD` / `CHAPTER_DURATION` | 1 = 段落之间插入 Remotion 过场卡，默认关；单张时长默认 2 秒 |
| 版式 | `CARDS_ENABLED` | 1 = 素材确认后多一步「版式确认」，AI 为片头 / 章节 / 片尾选模板写文案，默认开；需要 `remotion/` 依赖。片头 / 章节卡 / 片尾三个开关都没开时，默认出片头 + 章节卡 |
| 版式 | `CARD_ACCENT` | 卡片主色，默认 `#ff5a3c`；AI 只能在这个色板（主色 + 5 个预设）里挑 |

## 成片页可按任务覆盖

以上是全局默认值。**成片预览** 页还能按任务单独改字幕字号、是否插入 BGM、BGM 音量与自定义音乐：字号框里显示的是按当前分辨率算好的具体 px（不显示 0），支持 mp3/wav/m4a/aac/ogg/flac（绝对路径，或 `AISV_MUSIC_DIR` 目录下的文件名），文件找不到时自动退回程序合成并在日志里提示。改字号会额外重渲染烧了字幕的分段片段。

音色表内置在 `server/src/voices.ts`（Edge 5 个 / CosyVoice 10 个 / 豆包 10 个），界面上按角色选择，不需要写进配置。

## 环境变量

一般用不到，排查或定制部署时有用：

| 变量 | 作用 |
| --- | --- |
| `AISV_CONFIG_FILE` | 指定 `config.json` 路径 |
| `AISV_DATA_DIR` | 数据目录（工作区 / 缓存 / 成片） |
| `AISV_OUT_DIR` | 成片输出目录 |
| `AISV_ASSETS_DIR` | prompts 等静态资源目录 |
| `AISV_USER_PROMPTS_DIR` | 提示词覆盖层目录，默认 `<数据目录>/prompts` |
| `AISV_BIN_DIR` | 随包 ffmpeg / ffprobe 所在目录 |
| `AISV_MUSIC_DIR` | 自定义音乐目录，默认 `<数据目录>/music` |
| `AISV_SFX_DIR` | 自定义音效目录（放 `whoosh.wav` / `impact.wav`），默认用程序合成的音效 |
| `AISV_REMOTION_DIR` | 指定 `remotion/` 子工程位置，打包态用 |
| `PORT` / `HOST` | 后端监听地址，默认 `4000` / `127.0.0.1` |
| `AISV_OPEN_SETTINGS=1` | 启动即打开设置页 |
| `AISV_OPEN_DEVTOOLS=1` | 开发态自动打开 DevTools |
| `AISV_LOG_LEVEL` | 后端日志级别，默认 `info` |
| `AISV_CACHE_MAX_MB` | 素材缓存上限（MB），默认 2048，超出按最久未用淘汰 |
| `AISV_SCRIPT_REVIEW=0` | 关闭剧本审稿与返修（默认开启，每条多一次模型调用） |
| `AISV_SCRIPT_REVIEW_THRESHOLD` | 审稿通过分，0~1，默认 0.82 |

提示词覆盖层机制见 [prompts.md](prompts.md)。
