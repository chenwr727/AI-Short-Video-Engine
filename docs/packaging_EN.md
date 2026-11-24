English | [简体中文](packaging.md)

# Packaging

```bash
pnpm dist:win     # output: desktop/release/AI Short Video-<version>-win-portable.zip
```

The archive is about 200 MB (ffmpeg/ffprobe included). `compression: maximum` makes the zip step slow, so switch to `normal` for day-to-day iteration.

To ship the Remotion cards (intro / chapters / layout) inside the package there are two variants:

| Command | Card runtime | Size |
| --- | --- | --- |
| `pnpm dist:win` | not included, card rendering is skipped | ~200 MB |
| `pnpm dist:win:remotion` | bundles Chrome Headless Shell, works offline | ~400 MB |
| `pnpm dist:win:remotion-slim` | borrows the system Edge / Chrome (Edge ships with Windows 10+) | ~300 MB |

Only the render path is staged: the prebuilt bundle, `@remotion/renderer` and the compositor (plus Chrome Headless Shell in the full variant). The 266 MB webpack cache inside `remotion/node_modules`, typescript, rspack / babel, mediabunny, react and the bundle's sourcemaps (23 MB) are all dropped while staging.

The slim variant needs Edge or Chrome on the machine; without either, card rendering fails and falls back the usual way (the intro becomes the subtitle title, other cards are skipped) rather than blocking the render. `REMOTION_BROWSER` can point at a specific executable. A normal build actively clears the previous staging directory so the card runtime never leaks into the light package.

Build flow: frontend build → icon generation → copy ffmpeg/ffprobe → stage the backend and install production dependencies → (optional) stage Remotion → compile the main process → electron-builder → artifact self-check.

macOS / Linux and the remaining `dist:*` commands are listed in the [Common Commands](../README_EN.md#common-commands) table on the home page; desktop details live in [desktop/README_EN.md](../desktop/README_EN.md).
