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

// 打包时会把 bundle 预构建到这里，省掉 rspack / babel 那 85 MB 依赖
const prebuilt = path.join(here, "build", "bundle");

async function serveUrlOf() {
  // 有源码就是开发态：现打包，改了模板立刻生效；
  // 打包进包里的副本没有 src/，只能用预构建产物
  const hasSource = fs.existsSync(path.join(here, "src", "index.ts"));
  if (!hasSource && fs.existsSync(path.join(prebuilt, "index.html"))) return prebuilt;
  const { bundle } = await import("@remotion/bundler");
  return bundle({
    entryPoint: path.join(here, "src", "index.ts"),
    publicDir: null,
    onProgress: () => {},
  });
}

const serveUrl = await serveUrlOf();

const SHELL_DIR = path.join(here, "node_modules", ".remotion", "chrome-headless-shell");

/** 随包的 Chrome Shell 优先；瘦身包没带时退回系统 Edge / Chrome（同为 Chromium） */
function resolveBrowser() {
  if (process.env.REMOTION_BROWSER) return process.env.REMOTION_BROWSER;
  if (fs.existsSync(SHELL_DIR)) return undefined;

  const win = process.platform === "win32";
  const programs = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const programsX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = win
    ? [
        path.join(programsX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programs, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programs, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programsX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
  return candidates.find((file) => fs.existsSync(file));
}

const browserExecutable = resolveBrowser();

const composition = await selectComposition({ serveUrl, id: compositionId, inputProps, browserExecutable });

// 带 still 时只出一张静帧，供预览页秒开；否则渲染整段视频
if (still !== undefined) {
  await renderStill({
    composition,
    serveUrl,
    output,
    inputProps,
    browserExecutable,
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
  browserExecutable,
  crf: 18,
  pixelFormat: "yuv420p",
  concurrency: 4,
});

console.log("ok");
