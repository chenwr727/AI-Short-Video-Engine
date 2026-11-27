English | [简体中文](configuration.md)

# Configuration

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
| Video | `FPS` / `TTS_SPEED` | Defaults: 24 fps / 1.1× speed. Resolution is not configured here — pick it from the resolution dropdown on the Material page (1080×1920 / 720×1280) |
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
| Cards | `CARDS_ENABLED` | 1 = add a **Card review** step after footage confirmation, where the AI picks templates and writes copy for intro / chapter / outro cards, default on; needs `remotion/` dependencies. If none of the intro / chapter / outro switches is on, it defaults to intro + chapter cards |
| Cards | `CARD_ACCENT` | Primary card color, default `#ff5a3c`; the AI may only pick from this palette (primary + 5 presets) |

## Per-task overrides

These are global defaults. The **Final Preview** page also lets you override subtitle size, BGM on/off, BGM volume, and custom music per task: the size field shows the concrete px value computed for the current resolution (never 0), and mp3/wav/m4a/aac/ogg/flac files are accepted (absolute path, or a filename inside `AISV_MUSIC_DIR`). If the file is missing, the app falls back to generated music and logs a warning. Changing the subtitle size additionally re-renders the segments with burned-in subtitles.

The voice list lives in `server/src/voices.ts` (5 Edge / 10 CosyVoice / 10 Doubao) and is selected per role in the UI — nothing to add to the config file.

## Environment Variables

Usually unnecessary; useful for troubleshooting or custom deployments:

| Variable | Purpose |
| --- | --- |
| `AISV_CONFIG_FILE` | Path to `config.json` |
| `AISV_DATA_DIR` | Data directory (workspaces / cache / output) |
| `AISV_OUT_DIR` | Final video output directory |
| `AISV_ASSETS_DIR` | Static assets such as prompts |
| `AISV_USER_PROMPTS_DIR` | Prompt override directory, defaults to `<data dir>/prompts` |
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

How the prompt override layer works is covered in [prompts_EN.md](prompts_EN.md).
