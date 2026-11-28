简体中文 | [English](remotion_EN.md)

# Remotion 片头 / 片尾 / 版式卡（可选）

`remotion/` 是一个独立的 Remotion 子工程，负责两张卡片：片头（深色渐变背景、逐行弹入的大标题、强调线、底部进度条）与片尾（关注引导、账号胶囊）。后端通过子进程调用它，**不会把 Remotion 依赖装进 `server/`**。

```bash
cd remotion
npm install   # 首次渲染还会下载 Chrome Headless Shell（约 131 MB）
npm run studio   # 打开 Studio 实时调标题、配色与节奏
```

装好后在设置页把「片头 / 标题时长」（`TITLE_DURATION`）设为大于 0（默认 1.6），合成时会先渲染片头，再用 ffmpeg 补静音轨、统一编码参数，最后跟正文片段一起走转场拼接；设为 0 则不出片头。渲染失败自动回退到字幕标题。

片尾独立开关：把 `OUTRO_DURATION` 设成大于 0（如 3），就会在正文后追加一张关注引导卡，文案与账号名分别由 `OUTRO_TITLE`、`OUTRO_HANDLE` 控制。

同一套模板还负责**兜底设计卡**：某段素材搜不到或全部下载失败时，不再中断任务，而是渲染一张「引号 + 核心句 + 观点」的排版卡顶上（`QUOTE_FALLBACK=1`，默认开）。Remotion 也不可用时再退到纯色渐变底，保证一定出片。

需要段落之间有呼吸感时，把 `CHAPTER_DURATION` 设为大于 0（默认 2）：每段开头先插一张过场卡（大序号 + 本段第一句 + 底部段落进度点）；设为 0 则不出。它是纯增量插入，正文片段整体右移，音频与字幕都在各自片段内部，不需要改时间轴。

## 版式确认与卡片模板

素材确认时会一并生成版式清单：一次模型调用产出整份清单——片头（`TitleCard` / `TitleHero`）、章节卡（`ChapterCard` / `ChapterSplit`，从第 2 段起，最多 6 张）、片尾（`OutroCard` / `OutroMinimal`）。主色由视觉模型在色板里挑（`CARD_ACCENT` + 5 个预设）；生成前也可以先手动指定主色与章节卡时长，手动选过就以选择为准，没选才跟随模型与配置。

这一步是所见即所得：每张卡都用最终渲染的同一套组件出静帧和逐帧预览，改标题、角标、时长、配色立刻重绘；可以单张换模板 / 换文案 / 换配色，不满意就整份「换一批」。改过的卡按参数指纹重渲，没动的复用 `cards/` 里的旧文件。

模型不可用或返回不合法时回退到内置模板（片头取标题、章节卡取每段首句、片尾取关注引导），不阻塞流水线。

需要知道的：

- 卡片与前后片段之间固定走 `fade`，正片之间的转场仍按 `TRANSITION_STYLE` 轮换，观感不会被章节卡打断。
- **任一步失败都会回退**到原来的 ASS 大字标题，不会中断出片；日志里会写明原因。
- 想改样式直接编辑 `remotion/src/` 下对应的组件（`TitleCard` / `TitleHero` / `ChapterCard` / `ChapterSplit` / `OutroCard` / `OutroMinimal` / `QuoteCard`），详见 [remotion/README.md](../remotion/README.md)。
- 桌面版**默认不打包**这个目录（`node_modules` + Chrome Shell 约几百 MB）。要用的话改用带卡片的打包命令（见 [packaging.md](packaging.md)），或把整个 `remotion/` 放到应用根目录、或设置 `SHORTDECK_REMOTION_DIR` 指向它。
- 单次渲染约 5~8 秒（1080×1920，1.6 秒片头）；同一任务重试会复用已渲染的 `intro.mp4`。
