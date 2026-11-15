English | [简体中文](README.md)

# AI Short Video Engine

Turn a web article, a piece of copy, or just a URL into a vertical short video with multi-voice narration and burned-in subtitles.

An Electron desktop app, TypeScript end to end (Electron + Fastify + React), with ffmpeg bundled — on Windows, just unzip and run.

```
Script or URL → Script generation → Voice synthesis → Material review → Final preview
```

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2f6fed)

## Contents

- [Features](#features)
- [Sample Showcase](#sample-showcase)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Workflow](#workflow)
- [Task Artifacts and Resuming](#task-artifacts-and-resuming)
- [Project Structure](#project-structure)
- [Common Commands](#common-commands)
- [Packaging](#packaging)
- [Environment Variables](#environment-variables)
- [FAQ](#faq)
- [Known Limitations](#known-limitations)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

- **One pipeline end to end**: fetch the article body (including 36kr decryption) → LLM draft → rewrite into a structured script → split into sentences → TTS → retrieve footage → compose the subtitled video
- **Two human checkpoints**: pause after script generation to edit any line; pause after material matching to preview each segment and swap clips — no more "wrong script discovered after dubbing" or mismatched footage
- **Multiple TTS engines**: Edge online voices (free, default) / CosyVoice (DashScope) / Doubao Seed-TTS (Volcengine), with a fixed voice per role
- **Semantic footage matching**: Pixabay / Pexels search, portrait-first, with a duration-based fallback when AI selection fails
- **Subtitles and transitions**: ASS + libass rendering (auto line wrap with system fonts), `xfade` / `acrossfade` transitions, procedurally generated BGM
- **Resumable at any point**: every stage persists its artifacts (`_terms.json`, audio files, `_videos.json`, `_output.mp4`), so a rerun only fills in what is missing
- **Desktop experience**: custom title-bar menu (File / Help), settings dialog on first launch, graphical config panel, portable mode

## Sample Showcase

> The sample videos are edited and compressed to show partial effects only. Use the same source article with a different script style to reproduce them, or generate a full video with this app.

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

These map to the script styles in the app: **Podcast** (two speakers, information-dense), **Crosstalk** (Chinese comic duo, fast-paced banter), and **Stand-up** (solo narration, only the host name is needed).

## Quick Start

### Option 1: Portable build (Windows)

Download `AI Short Video-x.y.z-win-portable.zip` from [Releases](https://github.com/chenwr727/AI-Short-Video-Engine/releases), unzip it, and double-click `AI Short Video.exe`.

ffmpeg / ffprobe are bundled — no Node, Python, or any other runtime is needed. The settings dialog opens on first launch; add your API keys and you are ready to go.

Data lives in `UserData/` next to the exe:

```
UserData/config.json   # generated on first launch
UserData/data/         # workspaces, rendered videos, footage cache
```

### Option 2: Run from source

Requires Node.js 20+ (22 LTS recommended) and pnpm. `main` is the default branch:

```bash
# Clone the main branch
git clone -b main https://github.com/chenwr727/AI-Short-Video-Engine.git
cd AI-Short-Video-Engine

# For an existing clone: switch back to main and update
git checkout main && git pull --ff-only

# Dependencies: pnpm for server + web, npm for desktop
pnpm install
npm --prefix desktop install

# Start (builds web → compiles the main process → launches the backend → opens the window)
pnpm dev
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

## Configuration

Fill in the fields via **File → Settings…** (`Ctrl+,`); saving automatically restarts the backend. Config file location:

| Mode | Path |
| --- | --- |
| Portable | `<next to exe>/UserData/config.json` |
| Installed / dev | `%APPDATA%/aisv-desktop/config.json` |

**Minimal setup**: `LLM_API_KEY` (plus `LLM_API_URL` / `LLM_MODEL` where required) and either `PIXABAY_API_KEY` or `PEXELS_API_KEY`. TTS defaults to the free Edge online voices, so no extra key is needed.

Field reference (environment variables take precedence over the file, which is handy for temporary overrides):

| Group | Field | Description |
| --- | --- | --- |
| LLM | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | **Required**. Any OpenAI-compatible endpoint; `LLM_API_URL` may be just the domain — the API path is appended automatically |
| TTS (pick one) | — | Edge online voices are free, need no key, and work by default |
| TTS (DashScope) | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `DASHSCOPE_WS_URL` / `TTS_COSYVOICE_MODEL` | CosyVoice appears once a key is set; leave the WebSocket URL empty to derive it automatically |
| TTS (Doubao) | `SEED_TTS_API_KEY` / `TTS_SEED_RESOURCE_ID` / `TTS_SEED_MODEL` | The Doubao engine appears once a key is set |
| Footage | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | **At least one is required**, otherwise footage search is unavailable |
| Footage | `MATERIAL_MIN_DURATION` | Minimum candidate clip length in seconds, default 10 |
| Video | `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `FPS` / `TTS_SPEED` | Defaults: 1080×1920 / 24 fps / 1.1× speed |
| Video | `TRANSITION_DURATION` | Transition length in seconds, default 0.5; set 0 to disable |
| Subtitles | `SUBTITLE_FONT_SIZE` | Font size in px, default 0 = computed from video width (~72px at 1080, ~48px at 720); titles are 1.4× larger |
| Video | `VIDEO_FADE_IN` / `VIDEO_FADE_OUT` | Fade in/out at the start/end, default 0.5; set 0 to disable |
| BGM | `BGM_ENABLED` | Mix in background music, default 1; set 0 to keep narration only |
| BGM | `BGM_VOLUME` | BGM volume, default 0.1 (1 = original level) |
| BGM | `AUDIO_FADE_IN` / `AUDIO_FADE_OUT` | BGM fade in/out in seconds, defaults 0.8 / 1.2; set 0 to disable |
| BGM | `AISV_MUSIC_DIR` | Custom music directory, default `<data dir>/music`; bare filenames on the preview page resolve here |

These are global defaults. The **Final Preview** page also lets you override subtitle size, BGM on/off, BGM volume, and custom music per task: the size field shows the concrete px value computed for the current resolution (never 0), and mp3/wav/m4a/aac/ogg/flac files are accepted (absolute path, or a filename inside `AISV_MUSIC_DIR`). If the file is missing, the app falls back to generated music and logs a warning. Clicking **Regenerate** reruns only composition and reuses all audio and footage; changing the subtitle size additionally re-renders the segments with burned-in subtitles.

The voice list lives in `server/src/voices.ts` and is selected per role in the UI — nothing to add to the config file.

## Workflow

1. **Script input**: paste a URL or article text, pick a script style, and click **Start**
2. **Script generation**: the AI fetches and drafts the script, then pauses for your review; the title and every line are editable
3. **Voice synthesis**: choose a voice for each role, plus the TTS engine and speed (default 1.1×, configurable via `TTS_SPEED`), then start dubbing
4. **Material review**: choose a footage source (Pixabay / Pexels) and output resolution, then click **Match materials**; preview each clip and use **Replace** to search for another candidate; confirm and click **Next: final preview** (this does **not** auto-render)
5. **Final preview**: set subtitle size, BGM on/off, BGM volume, and custom music, then click **Render video**; afterwards you can tweak these and click **Regenerate**. On desktop, **Show in folder** opens the file location (in a browser it downloads the file)

The step bar at the top lets you revisit completed steps; snapshots come from backend SSE events.

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
  _bgm.wav           # mixed background music
  _output.mp4        # final video
```

A rerun after an interruption reuses what is already on disk and only fills in the missing parts; clicking **Regenerate** on the preview page deletes `_output.mp4` and `clips/` and reruns composition, keeping all audio and footage.

## Project Structure

```
desktop/          Electron shell (window and custom menu, backend launcher, settings panel, packaging scripts)
  src/main.ts       Main process: window, IPC, menu actions, shortcuts
  src/preload.ts    Minimal bridge exposed to the renderer (window menu / settings I/O)
  assets/settings.html  Graphical config panel
server/           Fastify + TypeScript backend
  src/pipeline/     Fetch & draft / split / TTS / footage / composition
  src/services/     LLM, TTS (edge / cosyvoice / seed), footage sites, ffmpeg, subtitles
  src/task/         Task state machine and pipeline orchestration (two human checkpoints)
  assets/prompts/   Prompt templates (podcast / crosstalk / stand-up styles)
  data/             Runtime artifacts: workspaces/, cache/, out/ (not committed)
web/              React + Vite frontend (served by the backend in packaged builds)
```

For desktop development and packaging details, see [desktop/README.md](desktop/README.md).

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop app (builds web and the main process first) |
| `pnpm dev:server` | Backend only |
| `pnpm dev:web` | Frontend only (Vite) |
| `pnpm build:web` | Build frontend output into `web/dist` |
| `pnpm typecheck` | Typecheck server + web |
| `pnpm dist:win` | Build the Windows portable zip |
| `pnpm dist:mac` / `pnpm dist:linux` | Build dmg / AppImage |

## Packaging

```bash
pnpm dist:win     # output: desktop/release/AI Short Video-<version>-win-portable.zip
```

The archive is about 200MB (ffmpeg/ffprobe included). `compression: maximum` makes the zip step slow, so switch to `normal` for day-to-day iteration.

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
| `PORT` / `HOST` | Backend listen address, defaults `4000` / `127.0.0.1` |
| `AISV_OPEN_SETTINGS=1` | Open the settings page on startup |
| `AISV_OPEN_DEVTOOLS=1` | Auto-open DevTools in dev mode |
| `AISV_LOG_LEVEL` | Backend log level, default `info` |

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

## Acknowledgements

`msedge-tts` (online voices), `ffmpeg-static` / `ffprobe-static`, and the free footage APIs from Pixabay and Pexels.

## License

This repository does not currently include a `LICENSE` file; please contact the author before commercial use or redistribution.
