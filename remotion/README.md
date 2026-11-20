# Remotion 卡片模板

独立的 Remotion 子工程，负责渲染片头、片尾、段落过场卡与兜底设计卡。后端通过子进程调用 `render.mjs`，不把 Remotion 依赖装进 `server/`。

## 安装

```bash
cd remotion
npm install
```

首次渲染会额外下载 Chrome Headless Shell（约 131 MB），之后复用。

## 预览

```bash
npm run studio
```

打开 Studio 后可以实时改标题、配色、时长，确认效果再回到主程序出片。

## 被后端调用

主程序设置页打开「用 Remotion 模板渲染片头」后（配置项 `INTRO_ENABLED=1`），合成阶段会执行：

```bash
node render.mjs @props.json
```

`props.json` 里包含 `compositionId`、`title`、`subtitle`、`label`、`accent`、`width`、`height`、`fps`、`durationInFrames`、`output`；片尾额外带 `handle`。

| compositionId | 用途 | 触发配置 |
| --- | --- | --- |
| `TitleCard` | 片头标题卡，顶替 ASS 大字标题 | `INTRO_ENABLED=1` |
| `OutroCard` | 片尾关注引导 | `OUTRO_DURATION > 0` |
| `QuoteCard` | 兜底设计卡，没检索到素材时顶替实拍 | `QUOTE_FALLBACK=1` |
| `ChapterCard` | 段落过场卡，大序号 + 本段主题 | `CHAPTER_CARD=1` |

渲染完成后后端会用 ffmpeg 补一条静音轨并统一编码参数，让卡片能和正文片段一起走转场拼接。

任何一步失败都会回退（片头回退到 ASS 大字标题，片尾直接不加），不会中断出片。

## 自定义

改 `src/TitleCard.tsx` 或 `src/OutroCard.tsx` 即可，常用位置：

| 想改什么 | 位置 |
| --- | --- |
| 字号 | `fontSize = width * 0.092` / `0.1` |
| 每行字数 / 断行 | `src/text.ts` 的 `wrapTitle()` |
| 背景色与光晕 | 三个 `AbsoluteFill` 的 `background` |
| 强调色 | 配置项默认 `#ff5a3c`，或直接改 `accent` 默认值 |
| 进场节奏 | `spring()` 的 `delay` 与 `config` |
| 片头收束 | `scale` 的 `interpolate` 区间 |
| 片尾账号胶囊 | `OutroCard` 里 `handle` 那段 `border` 样式 |

## 注意

- 所有 `@remotion/*` 包必须**版本完全一致**，升级时四个包一起改。
- 桌面版默认不打包本目录（`node_modules` + Chrome Shell 约几百 MB）。需要时把整个 `remotion/`（含 `node_modules`）放到应用根目录，或设置环境变量 `AISV_REMOTION_DIR` 指向它。
- 动画必须由 `useCurrentFrame()` 驱动，不能用 CSS transition、`Date.now()` 或无种子随机数，否则并发渲染会出现帧错乱。
