English | [简体中文](remotion.md)

# Remotion Cards: Intro / Outro / Layout (Optional)

`remotion/` is a standalone Remotion project that renders every card in the video: the intro (dark gradient background, big title popping in line by line, accent rule, bottom progress bar), the outro (follow prompt, account pill), chapter cards, and the fallback quote card. The backend shells out to it and **never installs Remotion into `server/`**.

```bash
cd remotion
npm install   # the first render also downloads Chrome Headless Shell (~131 MB)
npm run studio   # open Studio to tweak titles, colors and pacing live
```

Once installed, set **Intro / title length** (`TITLE_DURATION`) above 0 in settings (default 1.6). Composition renders the intro first, adds a silent audio track and normalizes encoding, then joins it with the body segments through the usual transitions; set it to 0 to skip the intro. A failed render falls back to the subtitle title.

The outro has its own switch: set `OUTRO_DURATION` above 0 (e.g. 3) and a follow prompt card is appended after the body, with its copy and account name controlled by `OUTRO_TITLE` and `OUTRO_HANDLE`.

The same templates also render the **fallback quote card**: when a segment has no usable footage, the task no longer fails — a card with quote mark, key sentence and takeaway is rendered instead (`QUOTE_FALLBACK=1`, on by default). If Remotion itself is unavailable, a plain gradient card is used so a video always ships.

When you want breathing room between segments, set `CHAPTER_DURATION` above 0 (default 2): each segment gets a chapter card in front of it (big index number, the segment's first line, progress dots at the bottom); 0 skips them. It is a pure insertion — body clips shift right, audio and subtitles stay inside their own clips, so the timeline model does not change.

## Card Review and Templates

Footage confirmation also generates the card manifest: one model call produces the whole manifest — intro (`TitleCard` / `TitleHero`), chapter cards (`ChapterCard` / `ChapterSplit`, from segment 2 on, at most 6) and outro (`OutroCard` / `OutroMinimal`). A vision model picks the primary color from the palette (`CARD_ACCENT` plus 5 presets); you can also pick the primary color and chapter card duration up front — once you pick, that choice wins, otherwise the model and config decide.

The step is WYSIWYG: every card is rendered with the same components as the final video, both as a still and as a frame-accurate preview, so editing title, label, duration or color redraws immediately. Switch template, rewrite copy or change color per card, or regenerate the whole set. Only cards whose parameters changed are re-rendered; the rest reuse the files under `cards/`.

If the model is unavailable or returns something invalid, the built-in templates take over (intro from the title, chapter cards from each segment's first line, outro from the follow prompt) and the pipeline keeps going.

Worth knowing:

- Cards always crossfade into and out of their neighbours (`fade`), while body-to-body transitions still rotate per `TRANSITION_STYLE`, so chapter cards never break the rhythm of the cut.
- **Any failure falls back** to the plain ASS title card instead of blocking the render; the log states the reason.
- To restyle a card, edit the matching component under `remotion/src/` (`TitleCard` / `TitleHero` / `ChapterCard` / `ChapterSplit` / `OutroCard` / `OutroMinimal` / `QuoteCard`); see [remotion/README.md](../remotion/README.md) (Chinese).
- The desktop build **does not bundle** this directory by default (`node_modules` + Chrome Shell is several hundred MB). Use the cards packaging command instead (see [packaging_EN.md](packaging_EN.md)), or drop the whole `remotion/` folder next to the app, or point `AISV_REMOTION_DIR` at it.
- A single render takes about 5–8 seconds (1080×1920, 1.6s intro); retries reuse an already rendered card.
