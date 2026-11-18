English | [简体中文](README.md)

# Desktop Shell (Electron)

Electron does exactly three things: **spawn the backend process**, **manage the data directory**, **package a portable zip**. All business logic lives in `server/`, all UI in `web/`.

```
desktop/   Electron shell: process orchestration, portable mode, custom menu, build pipeline
server/    Fastify + TS backend: fetch / script / TTS / footage / compose
web/       React + Vite frontend: served by the backend when packaged, the window just loads its URL
```

The window talks to the backend over plain HTTP + SSE. Electron never touches business data; it only orchestrates processes and handles the filesystem.

## Main Process Behavior

### Startup Sequence

```
setupPortableMode()      → portable.txt present, moves userData next to the exe
ensureConfig()           → writes a default config.json on first run
ensureBackend()          → picks a port, spawns backend, polls /api/health until ready
createMainWindow(url)    → the window merely does loadURL(backend address)
health() checks LLM key  → opens the settings page if unconfigured
```

Backend spawn: `process.execPath` + `tsx/dist/cli.mjs` + `server/src/index.ts`, with `ELECTRON_RUN_AS_NODE=1` making the Electron binary behave as plain Node. **No separate Node runtime is needed in the package.**

### Port Strategy

| Mode | Port |
| --- | --- |
| Development | Fixed `4000`; reused if already running (avoids spawning a duplicate) |
| Packaged | Dynamically allocated via `findFreePort()` |

When reusing an externally started backend, `backend.proc === null`. "Save and restart backend" cannot work in that case — the IPC handler returns `reused: true` and the UI tells the user to restart manually.

### Portable Mode

Enabled when `portable.txt` sits next to the exe; `userData` is redirected to `<exe dir>/UserData`. A write probe runs first — if the directory is not writable (e.g. installed under Program Files) it logs a warning and falls back to `%APPDATA%/aisv-desktop`.

Delete `portable.txt` to switch to installed mode; data returns to `%APPDATA%`.

### IPC and Shortcuts

The menu is drawn by the renderer (`titleBarStyle: hidden`), so the main process only keeps the window buttons via `Menu.setApplicationMenu(null)`. macOS is the exception: `appMenu` / `editMenu` are retained, otherwise system shortcuts stop working.

| Channel | Purpose |
| --- | --- |
| `settings:get` / `settings:save` | Read/write config, includes `__defaults` for the "restore defaults" button |
| `settings:test` | Forwards the **current form values** to `/api/config-test` — testable before saving |
| `settings:restart` | Stop old backend → spawn again → reload the main window |
| `app:menu` | Menu actions: settings / output dir / data dir / config file / about / docs / feedback |
| `music:pick` / `app:reveal-file` | Native file dialog, reveal the final cut in the file manager |

Shortcuts are handled in `before-input-event`: `Ctrl+,` settings, `Ctrl+O` open output dir, `Ctrl+N` new task (sends `app:new-task` to the renderer).

The window runs with `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`; the renderer reaches the main process only through `window.aisv` exposed by `preload.ts`.

## Development

```bash
# From the repo root
pnpm install                  # server + web
npm --prefix desktop install  # Electron / electron-builder / sharp

# If npm blocks the Electron binary, run the installer once manually
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node desktop/node_modules/electron/install.js

# Start: build web → generate icon → copy ffmpeg → stage backend → compile main → open window
pnpm dev
```

To work on one end only, run them separately:

```bash
pnpm dev:server   # http://127.0.0.1:4000
pnpm dev:web      # http://127.0.0.1:3000, /api proxied to 4000
```

In development Electron reuses a backend already listening on `:4000`. Use `AISV_OPEN_DEVTOOLS=1` for devtools.

## Configuration

Config access is whitelisted: the `DEFAULTS` key set in `config.ts` is the only accepted range, and `saveConfig` silently drops anything outside it.

The same keys appear in three places, and a missed update fails silently by dropping values — so `pnpm check:config` verifies all three agree:

| Location | Role |
| --- | --- |
| `server/src/config.ts` | Single source of truth |
| `desktop/src/config.ts` | Whitelist and defaults |
| `desktop/assets/settings.html` | Form fields (`data-key`) |

The config file location depends on how the app runs:

| Mode | Path |
| --- | --- |
| Portable | `<exe dir>/UserData/config.json` |
| Installed / development | `%APPDATA%/aisv-desktop/config.json` |

When the backend starts, every non-empty config value is injected as an environment variable (`buildEnv`), plus fixed `AISV_DATA_DIR`, `AISV_OUT_DIR`, `AISV_ASSETS_DIR`, `AISV_CONFIG_FILE`, `AISV_VERSION`, `PORT`, `HOST`. If `build/bin` exists it is prepended to `PATH` and `AISV_BIN_DIR` is set.

Saves use "write temp file + rename" for atomicity, with mode narrowed to `0600` on POSIX (the file holds API keys). A parse failure is backed up to `config.json.corrupt-<timestamp>` before falling back to defaults, so the next save cannot overwrite keys the user already entered.

Field descriptions live in the [main README's configuration table](../README_EN.md#configuration).

## Packaging

```bash
pnpm dist:win     # build → electron-builder → artifact self-check
```

Artifact: `desktop/release/AI Short Video-<version>-win-portable.zip` — currently about 214 MB / 2719 entries at `0.1.0`. `compression: maximum` makes the zip stage very slow; switch to `normal` temporarily during day-to-day iteration.

Unzip and run; data lands in the sibling `UserData/`:

```
UserData/config.json   # generated on first run, needs API keys
UserData/data/         # working dirs, final cuts, footage cache
```

### Pipeline

```
web build → generate icon → copy ffmpeg/ffprobe → stage backend and install prod deps
         → tsc compile main process → electron-builder → verify-pack self-check
```

`scripts/build.mjs` runs each step via `spawnSync` rather than a chained `&&`: on Windows a child killed by the system yields an NTSTATUS exit code such as `0x80000003`, and a chained command only reports one ELIFECYCLE line with no clue which step died. Now the failing step is named and the exit code translated.

### Non-Negotiable Details

**Backend gets an extra `payload/` level**
It is staged at `build/resources/payload/server` and mapped wholesale to `resources/`. Putting `node_modules` at the top level gets dropped by electron-builder's default exclusion rules.

**Dependencies reinstalled with `--node-linker=hoisted`**
pnpm's default symlink layout breaks after packaging, so dependencies must be reinstalled flat. The install adds `--ignore-scripts` to avoid triggering native module compilation inside the staging directory.

**Dependency cache stamp**
A content hash of `package.json` + `pnpm-lock.yaml` is written to `node_modules/.aisv-stage-stamp`; when it matches, `pnpm install` is skipped. Content hash rather than mtime — `cpSync` does not preserve timestamps.

**ffmpeg pinned to the essentials build**
Fetched from gyan.dev as `ffmpeg-release-essentials.zip`, version locked in `ESSENTIALS_VERSION`, cached in `build/.cache`. Rationale: `ffmpeg-static` and `ffprobe-static` are two major versions apart, and an ffprobe that cannot parse newer containers makes duration probing fail **silently**; the full build on the system PATH is 217 MB each, adding ~230 MB of unused weight. The essentials build keeps `libx264` + `aac` + `libass`, exactly what final rendering needs.

**Trimmed Electron locales**
The default 55 locale packs total 48 MB; only `zh-CN` / `zh-TW` / `en-US` are kept. `en-US` is Chromium's fallback locale — removing it breaks the UI.

**Files Node never reads are excluded**
About 12 MB of dependencies are sourcemaps, READMEs, type declarations and test suites. Node only loads the `.js` referenced by `package.json`'s `main` / `exports`, so these are never read; they are excluded in `extraResources.filter`.

## Script Reference

| Script | Purpose |
| --- | --- |
| `scripts/build.mjs` | Runs all build steps in order, reports step name and exit code on failure |
| `scripts/make-icon.mjs` | Generates a 1024px icon from `web/public/favicon.svg` (one copy each in `build/` and `assets/`) |
| `scripts/copy-ffmpeg.mjs` | Copies ffmpeg/ffprobe to `build/bin`, skips when already current |
| `scripts/stage-server.mjs` | Stages the backend + installs prod deps + verifies critical files |
| `scripts/verify-pack.mjs` | Artifact self-check: missing critical file fails; missing `win-unpacked` parts only warn |

Inside `desktop/`, `npm run icon` / `ffmpeg` / `stage` / `verify` can each be run alone for troubleshooting.

## Troubleshooting

**Blank window**
If `web/dist/index.html` is missing the backend serves no frontend. Run `pnpm build:web` first.

**Backend won't start**
Logs appear in the Electron console with a `[server]` prefix. Common causes: `tsx` not installed (the error lists the paths it tried), port in use, `server/src/index.ts` missing.

**"Save and restart backend" does nothing**
The backend was started externally (`pnpm dev:server` was already running). The main process cannot stop it — restart it manually.

**Files missing after packaging**
Run `npm run verify` inside `desktop/`. It checks `build/bin`, `build/resources/payload`, `web/dist`, `dist/main.js` item by item, then the actual artifacts under `release/win-unpacked/resources`.

**Shortcuts dead on macOS**
Confirm `buildMenu()` takes the `appMenu` / `editMenu` branch — setting it to `null` disables all system-level shortcuts.

## Platform Differences

| Item | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Title bar | `hidden` + `titleBarOverlay` | `hiddenInset` + traffic light offset | `hidden` + overlay |
| App menu | Empty, drawn by renderer | Keeps `appMenu` / `editMenu` | Empty |
| Package target | zip (x64) | dmg (min 11.0) | AppImage |
| Subtitle font | Microsoft YaHei | System font | libass fallback, glyphs may differ |
