English | [简体中文](faq.md)

# FAQ and Known Limitations

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

**Card rendering fails / "remotion runtime not found"**
`remotion/` is a standalone npm project outside the pnpm workspace, so the root `pnpm install` does not install it — run its own install:

```bash
cd remotion && npm install
```

`remotion.ts` requires both `render.mjs` and `node_modules` in that directory; missing either raises this error. Without them cards fall back the usual way (the intro becomes the subtitle title, other cards are skipped) and the render still completes. See [remotion_EN.md](remotion_EN.md).

**Prompt edits have no effect**
Saved edits apply to the next task; already-generated tasks are untouched. If you edit files directly, make sure you changed the override under `<data dir>/prompts/` rather than the built-in file — see [prompts_EN.md](prompts_EN.md).

## Known Limitations

- One task at a time: tasks are serial, so new ones must wait for the previous task to finish
- Footage depends on third-party sites (Pixabay / Pexels): an internet connection and a valid key are required
- Subtitles are rendered with system fonts: Microsoft YaHei on Windows, libass fallback on macOS / Linux, so glyphs may differ
- CosyVoice and Doubao need keys from their respective platforms; the engines are hidden in the UI until configured
- Login walls and aggressive anti-bot pages are not scraped; the app asks you to paste the article body instead
- Intro / outro / layout cards depend on the `remotion/` project plus Chrome Headless Shell; without them card rendering is skipped and the intro falls back to the subtitle title
