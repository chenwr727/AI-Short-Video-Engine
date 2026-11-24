English | [简体中文](development.md)

# Run from Source

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

## When you need the Remotion cards

`remotion/` is a standalone npm project outside the pnpm workspace, so the root `pnpm install` does not install it:

```bash
cd remotion && npm install
```

Without it card rendering fails and falls back the usual way (the intro becomes the subtitle title, other cards are skipped) instead of blocking the render. See [remotion_EN.md](remotion_EN.md).

## Project Structure

```
desktop/     Electron shell: window and custom menu, backend launcher, settings panel, packaging scripts
             src/main.ts main process · src/preload.ts renderer bridge · assets/settings.html config panel
server/      Fastify backend
             src/pipeline/  fetch & draft / split / TTS / footage / cards / composition
             src/services/  LLM, TTS (edge / cosyvoice / seed), footage sites, ffmpeg, subtitles, Remotion, SFX
             src/task/      task state machine and orchestration (three checkpoints, cards optional)
             src/card-templates.ts  card template catalog (intro / chapter / outro / fallback quote card)
             assets/prompts/  built-in prompt templates, overridable via prompts/ under the data directory
             data/          runtime artifacts: workspaces/, cache/, out/ (not committed)
web/         React + Vite frontend, served by the backend in packaged builds
remotion/    Optional Remotion project: intro / outro / layout cards (separate dependencies, not bundled)
docs/        Detailed docs, Chinese and English
```

For desktop development and packaging details, see [desktop/README_EN.md](../desktop/README_EN.md).

## Checks before committing

```bash
pnpm typecheck   # config consistency + server / web typecheck
pnpm lint        # ESLint
pnpm format:check  # Prettier (*.md is excluded in .prettierignore)
pnpm test        # backend unit tests for pure functions
```

CI runs these four in order.
