import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const raw = process.argv[2];
if (!raw) {
  console.error("usage: node render.mjs '<json>'  |  node render.mjs @props.json");
  process.exit(2);
}

// 参数过长时后端会改传 "@props.json" 形式的文件路径
const payload = JSON.parse(raw.startsWith("@") ? fs.readFileSync(raw.slice(1), "utf8") : raw);
const { output, compositionId = "TitleCard", still, ...inputProps } = payload;

if (!output) {
  console.error("missing output");
  process.exit(2);
}

fs.mkdirSync(path.dirname(output), { recursive: true });

const serveUrl = await bundle({
  entryPoint: path.join(here, "src", "index.ts"),
  publicDir: null,
  onProgress: () => {},
});

const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });

// 带 still 时只出一张静帧，供预览页秒开；否则渲染整段视频
if (still !== undefined) {
  await renderStill({
    composition,
    serveUrl,
    output,
    inputProps,
    frame: Math.max(0, Math.min(composition.durationInFrames - 1, Number(still) || 0)),
    imageFormat: output.endsWith(".jpg") || output.endsWith(".jpeg") ? "jpeg" : "png",
    overwrite: true,
  });
  console.log("ok");
  process.exit(0);
}

await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: output,
  inputProps,
  crf: 18,
  pixelFormat: "yuv420p",
  concurrency: 4,
});

console.log("ok");
