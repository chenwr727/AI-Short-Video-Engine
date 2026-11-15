// 从 web/public/favicon.svg 生成桌面端图标：
//   build/icon.png  —— electron-builder 打包用（自行转 ico/icns）
//   assets/icon.png —— 运行时窗口/任务栏图标
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const svg = path.join(repoRoot, "web", "public", "favicon.svg");
const desktop = path.join(here, "..");
const SIZE = 1024;

if (!fs.existsSync(svg)) {
  console.error(`[icon] 找不到图标源文件：${svg}`);
  process.exit(1);
}

const outputs = [path.join(desktop, "build", "icon.png"), path.join(desktop, "assets", "icon.png")];
const image = await sharp(svg, { density: SIZE }).resize(SIZE, SIZE).png();

for (const out of outputs) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await image.clone().toFile(out);
  console.log(`[icon] 已生成 ${out}`);
}
