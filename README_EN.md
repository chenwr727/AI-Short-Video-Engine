English | [简体中文](README.md)

<h1 align="center">AI Short Video Engine</h1>

<p align="center"><b>Drop in a link, get a vertical short video ready to post.</b></p>

<p align="center">Fetch article → AI script → per-line dubbing → footage matching → title cards → subtitled final cut<br />Fully automatic, pausing only at the moments that matter</p>

<p align="center">
  <a href="https://github.com/chenwr727/AI-Short-Video-Engine/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/chenwr727/AI-Short-Video-Engine?color=2f6fed"></a>
  <a href="https://github.com/chenwr727/AI-Short-Video-Engine/releases"><img alt="Downloads" src="https://img.shields.io/badge/download-Windows%20portable-2f6fed"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2f6fed">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white">
</p>

<p align="center">Portable on Windows · ffmpeg bundled · no GPU required · free TTS out of the box</p>

<p align="center">
  <a href="#sample-showcase">Samples</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#workflow">Workflow</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#faq">FAQ</a>
</p>

## Sample Showcase

One 36kr article, one script style swap, a completely different video. Samples are trimmed and compressed to show partial effects only:

📄 **Original article**: [36kr article](https://36kr.com/p/3286128054051718)

<table>
  <thead>
    <tr>
      <th align="center">▶️ Podcast</th>
      <th align="center">▶️ Crosstalk</th>
      <th align="center">▶️ Stand-up</th>
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

- **Podcast**: two speakers, information-dense, great for knowledge content
- **Crosstalk**: fast banter between a comic duo, turning business logic into everyday jokes
- **Stand-up**: solo narration, only the host name is required

## Why This One

The hard part of "one-click AI video" was never generation — it is discovering, after the render, that the tone is off or the footage does not fit, and having to run the whole thing again.

So this pipeline inserts a human checkpoint at **the most expensive moments**:

- **Script review**: the AI drafts and stops. Edit the title and any line, then confirm to proceed to dubbing — no waiting three minutes to hear that the opening is wrong.
- **Footage review**: preview each clip, hit **Replace** to search for another candidate, and the pick swaps in immediately.
- **Card review** (optional, `CARDS_ENABLED=1`): once the footage is locked in, the AI picks a template and writes copy for the intro, chapter and outro cards. Preview each card and confirm only when it reads right.

Everything else stays out of your way:

- **Resumable**: every stage writes its artifacts to disk, so a rerun only fills in what is missing instead of refetching the article.
- **Zero-cost TTS**: Edge online voices by default — render a video without entering a single key. Switch to CosyVoice or Doubao when you want richer voices.
- **Semantic footage matching**: Pixabay / Pexels search with portrait-first ranking, plus a duration-based fallback so AI selection failures never stall the run.
- **Tunable after render**: change subtitle size, BGM on/off or volume and hit **Regenerate** — only composition reruns, all audio and footage are reused.
- **Runs out of the box**: the Windows portable build bundles ffmpeg / ffprobe, no Node, Python, or any other runtime needed.

## Quick Start

### 1. Get the app

Download `AI Short Video-x.y.z-win-portable.zip` from [Releases](https://github.com/chenwr727/AI-Short-Video-Engine/releases), unzip it, and double-click `AI Short Video.exe`. About 200 MB, everything included.

Data lives in `UserData/` next to the exe — delete that folder for a clean uninstall:

```
UserData/config.json   # generated on first launch
UserData/data/         # workspaces, rendered videos, footage cache
```

### 2. Add keys

The settings dialog opens on first launch; afterwards use `Ctrl+,`. Only two things matter:

| Need | Required | Notes |
| --- | --- | --- |
| LLM | **Yes** | Any OpenAI-compatible endpoint: key + domain + model name |
| Footage | **At least one** | Pixabay or Pexels — free keys on signup |
| TTS | Not needed | Edge online voices are free by default; add CosyVoice / Doubao keys for more voices |

Saving restarts the backend automatically — no need to relaunch the app.

### 3. Run one

Paste a URL or article text → pick a script style → click **Start**. Each step tells you exactly what comes next.

### Run from source

Requires Node.js 20+ (22 LTS recommended) and pnpm:

```bash
git clone -b main https://github.com/chenwr727/AI-Short-Video-Engine.git
cd AI-Short-Video-Engine

pnpm install                  # server + web
npm --prefix desktop install  # desktop

pnpm dev                      # build web → compile main process → start backend → open window
```

If the Electron binary download fails, run the installer once manually:

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

To work on the backend or frontend only, run them separately:

```bash
pnpm dev:server   # Fastify at http://127.0.0.1:4000
pnpm dev:web      # Vite at http://127.0.0.1:3000 (/api proxied to 4000)
```

In dev mode Electron reuses an already running backend on `:4000` instead of starting a second one.

## Workflow

```mermaid
flowchart LR
    A([URL or text]) --> B[Fetch body]
    B --> C[LLM draft]
    C --> D[Structured script]
    D --> E{{Script review}}
    E --> F[Split and TTS]
    F --> G[Footage search]
    G --> H{{Footage review}}
    H --> HC{{Card review (optional)}}
    HC --> I[Subtitles transitions BGM]
    I --> J([Final mp4])
```

The UI mirrors this in six steps (card review only appears with `CARDS_ENABLED=1`); the step bar at the top lets you revisit completed steps at any time:

1. **Script input**: paste a URL or article text, pick a script style, click **Start**
2. **Script generation**: the AI fetches and drafts, then pauses for review; the title and every line are editable
3. **Voice synthesis**: choose a voice per role, plus the TTS engine and speed (default 1.1×, configurable via `TTS_SPEED`)
4. **Material review**: choose a footage source and output resolution, click **Match materials**; preview each clip and use **Replace** for another candidate. Confirming moves on (it does **not** auto-render)
5. **Card review**: preview the generated intro, chapter and outro cards; edit copy and duration, switch templates, delete cards, or regenerate the whole set. Confirm as-is and the final cut keeps the body segments only
6. **Final preview**: set subtitle size, BGM on/off and volume, click **Render video**; tweak and click **Regenerate** afterwards

On desktop, **Show in folder** opens the file location (in a browser it downloads the file).

## Task Artifacts and Resuming

Each task keeps a full set of intermediate files under `<data dir>/workspaces/<timestamp>/` (`server/data/workspaces/` when running from source, `UserData/data/workspaces/` for the portable build):

```
20261115-214501/
  _html.txt          # fetched article
  _transcript.txt    # LLM draft
  _transcript.json   # confirmed structured script
  _terms.json        # search terms per segment
  *.mp3              # per-sentence audio, named segment_sentence_part
  _durations.json    # audio durations
  _videos.json       # footage manifest
  clips/ subs/       # segment videos and ASS subtitles
  cards/             # card videos and stills, fingerprinted by their parameters
  _task.json         # task state snapshot (includes the card manifest) for resuming
  _bgm.wav           # mixed background music
  _output.mp4        # final video
```

A rerun after an interruption reuses what is already on disk and only fills in the missing parts; clicking **Regenerate** on the preview page deletes `_output.mp4` and `clips/` and reruns composition, keeping all audio and footage.

## Configuration

Fill in the fields via **File → Settings…** (`Ctrl+,`); saving restarts the backend automatically. Config file location:

| Mode | Path |
| --- | --- |
| Portable | `<next to exe>/UserData/config.json` |
| Installed / dev | `%APPDATA%/aisv-desktop/config.json` |

Field reference (environment variables take precedence over the file, which is handy for temporary overrides):

| Group | Field | Description |
| --- | --- | --- |
| LLM | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | **Required**. Any OpenAI-compatible endpoint; `LLM_API_URL` may be just the domain — the API path is appended automatically |
| TTS (default) | — | Edge online voices are free, need no key, and work out of the box |
| TTS (DashScope) | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `DASHSCOPE_WS_URL` / `TTS_COSYVOICE_MODEL` | CosyVoice appears once a key is set; leave the WebSocket URL empty to derive it automatically |
| TTS (Doubao) | `SEED_TTS_API_KEY` / `TTS_SEED_RESOURCE_ID` / `TTS_SEED_MODEL` | The Doubao engine appears once a key is set |
| Footage | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | **At least one is required**, otherwise footage search is unavailable |
| Footage | `MATERIAL_MIN_DURATION` | Minimum candidate clip length in seconds, default 10 |
| Footage | `VISION_SELECT` | Let the model pick clips from thumbnails, default 1; falls back to text-only selection when the model cannot take images |
| Footage | `SHOTS_PER_PARAGRAPH` | Shots per segment, 1–3, default 2; cuts land on sentence boundaries, 1 = one clip for the whole segment |
| Footage | `QUOTE_FALLBACK` | 1 = fall back to a quote card when a segment has no usable footage (default); 0 = fail the task instead |
| Video | `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `FPS` / `TTS_SPEED` | Defaults: 1080×1920 / 24 fps / 1.1× speed |
| Video | `CAMERA_MOTION` | Camera move strength 0–10, default 6; push-in / pull-out / pan rotate per segment, 0 = static frame |
| Video | `COLOR_GRADE` | Grade strength 0–10, default 5; unifies contrast / saturation / vignette / grain, 0 = no grading |
| Video | `TRANSITION_DURATION` | Transition length in seconds, default 0.5; set 0 to disable |
| Video | `TRANSITION_STYLE` | `mixed` (default) rotates styles per segment, `fade` uses crossfade everywhere |
| Subtitles | `SUBTITLE_FONT_SIZE` | Font size in px, default 0 = computed from video width (~72px at 1080, ~48px at 720); titles are 1.4× larger |
| Video | `VIDEO_FADE_IN` / `VIDEO_FADE_OUT` | Fade in/out at the start/end, default 0.5; set 0 to disable |
| BGM | `BGM_ENABLED` | Mix in background music, default 1; set 0 to keep narration only |
| BGM | `BGM_VOLUME` | BGM volume, default 0.1 (1 = original level) |
| BGM | `AUDIO_FADE_IN` / `AUDIO_FADE_OUT` | BGM fade in/out in seconds, defaults 0.8 / 1.2; set 0 to disable |
| BGM | `AISV_MUSIC_DIR` | Custom music directory, default `<data dir>/music`; bare filenames on the preview page resolve here |
| SFX | `SFX_ENABLED` / `SFX_VOLUME` | Transition and intro sound effects, default on / 0.2; the files are synthesized by ffmpeg, drop `whoosh.wav` / `impact.wav` into `AISV_SFX_DIR` to replace them |
| Intro | `INTRO_ENABLED` | 1 = render the intro with the Remotion template (needs `remotion/` dependencies), default 0; falls back to the subtitle title on failure |
| Outro | `OUTRO_DURATION` / `OUTRO_TITLE` / `OUTRO_HANDLE` | Outro card length in seconds (0 = no outro), title copy, account name (hidden when empty) |
| Chapters | `CHAPTER_CARD` / `CHAPTER_DURATION` | 1 = insert a Remotion chapter card between segments, default off; card length defaults to 2s |
| Cards | `CARDS_ENABLED` | 1 = add a **Card review** step after footage confirmation, where the AI picks templates and writes copy for intro / chapter / outro cards, default off; needs `remotion/` dependencies |
| Cards | `CARD_ACCENT` | Primary card color, default `#ff5a3c`; the AI may only pick from this palette (primary + 5 presets) |

These are global defaults. The **Final Preview** page also lets you override subtitle size, BGM on/off, BGM volume, and custom music per task: the size field shows the concrete px value computed for the current resolution (never 0), and mp3/wav/m4a/aac/ogg/flac files are accepted (absolute path, or a filename inside `AISV_MUSIC_DIR`). If the file is missing, the app falls back to generated music and logs a warning. Changing the subtitle size additionally re-renders the segments with burned-in subtitles.

The voice list lives in `server/src/voices.ts` (5 Edge / 10 CosyVoice / 10 Doubao) and is selected per role in the UI — nothing to add to the config file.

## Project Structure

```
desktop/          Electron shell (window and custom menu, backend launcher, settings panel, packaging scripts)
  src/main.ts       Main process: window, IPC, menu actions, shortcuts
  src/preload.ts    Minimal bridge exposed to the renderer (window menu / settings I/O)
  assets/settings.html  Graphical config panel
server/           Fastify + TypeScript backend
  src/pipeline/     Fetch & draft / split / TTS / footage / cards / composition
  src/services/     LLM, TTS (edge / cosyvoice / seed), footage sites, ffmpeg, subtitles, Remotion, SFX
  src/card-templates.ts  Card template catalog (intro / chapter / outro / fallback quote card)
  src/task/         Task state machine and pipeline orchestration (three human checkpoints, cards optional)
  assets/prompts/   Prompt templates (podcast / crosstalk / stand-up)
  data/             Runtime artifacts: workspaces/, cache/, out/ (not committed)
web/              React + Vite frontend (served by the backend in packaged builds)
remotion/         Optional Remotion project: intro / outro / layout cards (separate dependencies, not bundled)
```

For desktop development and packaging details, see [desktop/README_EN.md](desktop/README_EN.md).

## Remotion Cards: Intro / Outro / Layout (Optional)

`remotion/` is a standalone Remotion project that renders every card in the video: the intro (dark gradient background, big title popping in line by line, accent rule, bottom progress bar), the outro (follow prompt, account pill), chapter cards, and the fallback quote card. The backend shells out to it and **never installs Remotion into `server/`**.

```bash
cd remotion
npm install   # the first render also downloads Chrome Headless Shell (~131 MB)
npm run studio   # open Studio to tweak titles, colors and pacing live
```

Once installed, tick **Render intro with the Remotion template** in settings (or set `INTRO_ENABLED=1`). Composition renders the intro first, adds a silent audio track and normalizes encoding, then joins it with the body segments through the usual transitions. Intro length comes from `TITLE_DURATION`.

The outro has its own switch: set `OUTRO_DURATION` above 0 (e.g. 3) and a follow prompt card is appended after the body, with its copy and account name controlled by `OUTRO_TITLE` and `OUTRO_HANDLE`.

The same templates also render the **fallback quote card**: when a segment has no usable footage, the task no longer fails — a card with quote mark, key sentence and takeaway is rendered instead (`QUOTE_FALLBACK=1`, on by default). If Remotion itself is unavailable, a plain gradient card is used so a video always ships.

When you want breathing room between segments, turn on `CHAPTER_CARD=1`: each segment gets a chapter card in front of it (big index number, the segment's first line, progress dots at the bottom). It is a pure insertion — body clips shift right, audio and subtitles stay inside their own clips, so the timeline model does not change.

### Card Review and Templates (Optional)

With `CARDS_ENABLED=1` a **Card review** step appears after footage confirmation: one model call produces the whole manifest — intro (`TitleCard` / `TitleHero`), chapter cards (`ChapterCard` / `ChapterSplit`, from segment 2 on, at most 6) and outro (`OutroCard` / `OutroMinimal`). A vision model picks the primary color from the palette (`CARD_ACCENT` plus 5 presets).

The step is WYSIWYG: every card is rendered with the same components as the final video, both as a still and as a frame-accurate preview, so editing title, label, duration or color redraws immediately. Switch template, rewrite copy or change color per card, batch **Switch all templates**, or regenerate the whole set. Only cards whose parameters changed are re-rendered; the rest reuse the files under `cards/`.

If the model is unavailable or returns something invalid, the built-in templates take over (intro from the title, chapter cards from each segment's first line, outro from the follow prompt) and the pipeline keeps going.

Worth knowing:

- Cards always crossfade into and out of their neighbours (`fade`), while body-to-body transitions still rotate per `TRANSITION_STYLE`, so chapter cards never break the rhythm of the cut.
- **Any failure falls back** to the plain ASS title card instead of blocking the render; the log states the reason.
- To restyle a card, edit the matching component under `remotion/src/` (`TitleCard` / `TitleHero` / `ChapterCard` / `ChapterSplit` / `OutroCard` / `OutroMinimal` / `QuoteCard`); see [remotion/README.md](remotion/README.md).
- The desktop build **does not bundle** this directory by default (`node_modules` + Chrome Shell is several hundred MB). To use it, drop the whole `remotion/` folder next to the app or point `AISV_REMOTION_DIR` at it.
- A single render takes about 5–8 seconds (1080×1920, 1.6s intro); retries reuse an already rendered card.

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop app (builds web and the main process first) |
| `pnpm dev:server` | Backend only |
| `pnpm dev:web` | Frontend only (Vite) |
| `pnpm build:web` | Build frontend output into `web/dist` |
| `pnpm typecheck` | Config consistency check + server / web typecheck |
| `pnpm test` | Run backend unit tests for pure functions |
| `pnpm lint` / `pnpm format` | ESLint check / Prettier formatting |
| `pnpm dist:win` | Build the Windows portable zip |
| `pnpm dist:mac` / `pnpm dist:linux` | Build dmg / AppImage |

## Packaging

```bash
pnpm dist:win     # output: desktop/release/AI Short Video-<version>-win-portable.zip
```

The archive is about 200 MB (ffmpeg/ffprobe included). `compression: maximum` makes the zip step slow, so switch to `normal` for day-to-day iteration.

Build flow: frontend build → icon generation → copy ffmpeg/ffprobe → stage the backend and install production dependencies → compile the main process → electron-builder → artifact self-check.

## Environment Variables

Usually unnecessary; useful for troubleshooting or custom deployments:

| Variable | Purpose |
| --- | --- |
| `AISV_CONFIG_FILE` | Path to `config.json` |
| `AISV_DATA_DIR` | Data directory (workspaces / cache / output) |
| `AISV_OUT_DIR` | Final video output directory |
| `AISV_ASSETS_DIR` | Static assets such as prompts |
| `AISV_BIN_DIR` | Directory of the bundled ffmpeg / ffprobe |
| `AISV_MUSIC_DIR` | Custom music directory, default `<data dir>/music` |
| `AISV_SFX_DIR` | Custom SFX directory (`whoosh.wav` / `impact.wav`), default is the synthesized set |
| `AISV_REMOTION_DIR` | Point at the `remotion/` project, used by packaged builds |
| `PORT` / `HOST` | Backend listen address, defaults `4000` / `127.0.0.1` |
| `AISV_OPEN_SETTINGS=1` | Open the settings page on startup |
| `AISV_OPEN_DEVTOOLS=1` | Auto-open DevTools in dev mode |
| `AISV_LOG_LEVEL` | Backend log level, default `info` |
| `AISV_CACHE_MAX_MB` | Footage cache limit in MB, default 2048; least recently used files are evicted |
| `AISV_SCRIPT_REVIEW=0` | Disable script review and revision (on by default, one extra model call per task) |
| `AISV_SCRIPT_REVIEW_THRESHOLD` | Review pass score, 0~1, default 0.82 |

## FAQ

**"ffprobe / ffmpeg not detected"**
In dev mode, install system ffmpeg and make sure it is on `PATH`. The portable build bundles them; if the error persists, the extraction was incomplete.

**Config changes have no effect**
Click **Save and restart backend** in the settings dialog to restart the backend automatically. If you edit `config.json` directly, restart the app (binary detection is cached in-process).

**Settings dialog pops up on first launch**
It means no LLM API key has been set yet. Fill it in, save, and it will not appear again.

**Generation fails / footage never matches**
Check that `PIXABAY_API_KEY` or `PEXELS_API_KEY` is valid and that the footage sites are reachable. LLM timeouts can also fail the drafting stage.

**Port 4000 is taken**
Electron reuses an already running backend; when running `pnpm dev:server` alone, use `PORT=4001` to change the port.

**Packaged app will not start / white screen**
Make sure `web/dist` has been built (`pnpm build:web`). Backend logs appear in the Electron console with the `[server]` prefix.

## Known Limitations

- One task at a time: tasks are serial, so new ones must wait for the previous task to finish
- Footage depends on third-party sites (Pixabay / Pexels): an internet connection and a valid key are required
- Subtitles are rendered with system fonts: Microsoft YaHei on Windows, libass fallback on macOS / Linux, so glyphs may differ
- CosyVoice and Doubao need keys from their respective platforms; the engines are hidden in the UI until configured
- Login walls and aggressive anti-bot pages are not scraped; the app asks you to paste the article body instead
- Intro / outro / layout cards depend on the `remotion/` project plus Chrome Headless Shell; without them card rendering is skipped and the intro falls back to the subtitle title

## Acknowledgements

`msedge-tts` (online voices), `ffmpeg-static` / `ffprobe-static`, and the free footage APIs from Pixabay and Pexels.

## License

This repository does not currently include a `LICENSE` file; please contact the author before commercial use or redistribution.
