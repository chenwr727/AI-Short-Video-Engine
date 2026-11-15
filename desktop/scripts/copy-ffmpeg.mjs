// 把 ffmpeg-static / ffprobe-static 的二进制复制到 build/bin，
// 打包后由主进程并入 PATH 并透过 AISV_BIN_DIR 告知后端
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(here, "..", "build", "bin");

const isWin = process.platform === "win32";
const suffix = isWin ? ".exe" : "";

fs.mkdirSync(binDir, { recursive: true });

function copyOne(src, name) {
  if (!src || !fs.existsSync(src)) {
    console.error(`[ffmpeg] 找不到 ${name} 源文件：${src}`);
    process.exitCode = 1;
    return;
  }
  const dest = path.join(binDir, name + suffix);
  fs.copyFileSync(src, dest);
  if (!isWin) fs.chmodSync(dest, 0o755);
  console.log(`[ffmpeg] ${name} -> ${dest}`);
}

const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

copyOne(ffmpegPath, "ffmpeg");
copyOne(ffprobePath, "ffprobe");

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ffmpeg] 完成：${binDir}`);
