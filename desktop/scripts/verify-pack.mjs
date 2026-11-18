// 打包产物自检：缺任何一项关键文件即判定失败
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repoRoot = path.resolve(desktop, "..");
const unpacked = path.join(desktop, "release", "win-unpacked");
const isWin = process.platform === "win32";
const exe = isWin ? ".exe" : "";

const checks = [
  ["portable.txt", path.join(desktop, "portable.txt")],
  ["ffmpeg", path.join(desktop, "build", "bin", "ffmpeg" + exe)],
  ["前端产物", path.join(repoRoot, "web", "dist", "index.html")],
  ["后端入口", path.join(desktop, "build", "resources", "payload", "server", "src", "index.ts")],
  [
    "后端依赖 tsx",
    path.join(desktop, "build", "resources", "payload", "server", "node_modules", "tsx", "dist", "cli.mjs"),
  ],
  ["主进程产物", path.join(desktop, "dist", "main.js")],
];

const softChecks = [
  ["app.asar", path.join(unpacked, "resources", "app.asar")],
  ["打包内 ffmpeg", path.join(unpacked, "resources", "bin", "ffmpeg" + exe)],
  ["打包内后端", path.join(unpacked, "resources", "server", "src", "index.ts")],
  ["打包内前端", path.join(unpacked, "resources", "web", "index.html")],
];

/** 不该进包的文件，防止误分发本地凭据 */
const forbidden = [
  ["后端本地配置", path.join(unpacked, "resources", "server", "data", "config.json")],
  ["打包暂存配置", path.join(desktop, "build", "resources", "payload", "server", "data", "config.json")],
  ["免安装用户数据", path.join(unpacked, "UserData")],
  ["用户数据 config", path.join(unpacked, "UserData", "config.json")],
];

let failed = 0;
for (const [label, file] of checks) {
  if (fs.existsSync(file)) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label} -> ${file}`);
    failed++;
  }
}

for (const [label, file] of softChecks) {
  if (fs.existsSync(file)) console.log(`  ✓ ${label}`);
  else console.warn(`  - ${label} 不存在（仅在已执行 electron-builder 后检查）：${file}`);
}

for (const [label, file] of forbidden) {
  if (fs.existsSync(file)) {
    console.error(`  ✗ ${label} 不该出现在打包产物里 -> ${file}`);
    failed++;
  } else {
    console.log(`  ✓ ${label} 未入包`);
  }
}

if (failed) {
  console.error(`\n自检失败：${failed} 项异常`);
  process.exit(1);
}
console.log("\n自检通过");
