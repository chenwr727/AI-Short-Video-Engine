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

## 预构建

```bash
npm run bundle   # 产物：build/bundle
```

`render.mjs` 的取舍规则：目录里还有 `src/index.ts`（开发态）就每次现打包，改模板立刻生效；没有源码（打进安装包里的副本）就只用 `build/bundle`，所以改完模板要重新 `npm run bundle`，否则包里还是旧界面。

暂存进包时会顺手删掉 bundle 的 sourcemap（约 23 MB）和末尾的 `sourceMappingURL` 注释——只删 map 不删注释会让渲染直接报 ENOENT。

## 被后端调用

主程序设置页把「片头 / 标题时长」设为大于 0（配置项 `TITLE_DURATION > 0`）后，合成阶段会执行：

```bash
node render.mjs @props.json
```

`props.json` 里包含 `compositionId`、`title`、`subtitle`、`label`、`accent`、`width`、`height`、`fps`、`durationInFrames`、`output`；片尾额外带 `handle`。

| compositionId | 用途 | 触发配置 |
| --- | --- | --- |
| `TitleCard` | 片头标题卡，顶替 ASS 大字标题 | `TITLE_DURATION > 0` |
| `OutroCard` | 片尾关注引导 | `OUTRO_DURATION > 0` |
| `QuoteCard` | 兜底设计卡，没检索到素材时顶替实拍 | `QUOTE_FALLBACK=1` |
| `ChapterCard` | 段落过场卡，大序号 + 本段主题 | `CHAPTER_DURATION > 0` |

版式阶段会按每张卡自己的 `compositionId` 渲染，备用模板为 `TitleHero`、`ChapterSplit`、`OutroMinimal`，清单在 `server/src/card-templates.ts`，新增模板要同时注册到 `src/Root.tsx`。

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
- 桌面版普通包不带本目录。要么用 `pnpm dist:win:remotion` 打带卡片的包（约 400 MB，自带 Chrome Headless Shell），要么用 `pnpm dist:win:remotion-slim`（约 300 MB，借用系统 Edge / Chrome），也可以把整个 `remotion/` 放到应用根目录、或设置 `AISV_REMOTION_DIR` 指向它。
- 想指定浏览器：`REMOTION_BROWSER="C:\路径\chrome.exe"`（没设且目录里没有 Chrome Shell 时，会自动在系统里找 Edge / Chrome）。
- 动画必须由 `useCurrentFrame()` 驱动，不能用 CSS transition、`Date.now()` 或无种子随机数，否则并发渲染会出现帧错乱。
