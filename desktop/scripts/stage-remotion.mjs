// 把 remotion 子工程瘦身后暂存到 build/resources/remotion，供带卡片版打进包。
// 只保留渲染链路：预构建 bundle + @remotion/renderer + compositor + Chrome Headless Shell。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const src = path.join(repoRoot, "remotion");
// 套一层 remotion-payload 再映射到 resources 根，绕开 electron-builder 对顶层 node_modules 的排除
const destRoot = path.join(here, "..", "build", "resources", "remotion-payload");
const dest = path.join(destRoot, "remotion");

/** 顶层文件：渲染只认这两个 + 预构建产物 */
const KEEP_FILES = ["render.mjs", "package.json"];

/** 瘦身模式：不带 Chrome Headless Shell（303 MB），改用系统 Edge / Chrome 渲染 */
const slim = process.argv.includes("--slim") || process.env.SHORTDECK_REMOTION_SLIM === "1";

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

/**
 * bundle 的 sourcemap 约 22 MB。renderer 是通过 js 末尾的 sourceMappingURL 注释去找它的，
 * 把注释一起删掉就不会再去找；只留着注释会让渲染直接报 ENOENT。
 */
function stripBundleMaps(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += stripBundleMaps(full);
      continue;
    }
    if (entry.name.endsWith(".map")) {
      fs.rmSync(full);
      removed++;
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const text = fs.readFileSync(full, "utf-8");
    const stripped = text.replace(/\n\/\/# sourceMappingURL=.*$/gm, "\n");
    if (stripped !== text) fs.writeFileSync(full, stripped);
  }
  return removed;
}

function sizeMb(dir) {
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return Math.round((total / 1024 / 1024) * 10) / 10;
}

if (!fs.existsSync(src)) {
  console.error(`[remotion] 找不到子工程目录：${src}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(src, "build", "bundle", "index.html"))) {
  console.error("[remotion] 缺少预构建 bundle，先执行：npm --prefix remotion run bundle");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const file of KEEP_FILES) {
  const from = path.join(src, file);
  if (!fs.existsSync(from)) {
    console.error(`[remotion] 缺少文件：remotion/${file}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dest, file));
}

copyDir(path.join(src, "build", "bundle"), path.join(dest, "build", "bundle"));
const droppedMaps = stripBundleMaps(path.join(dest, "build", "bundle"));

// pnpm 的 node_modules 全是符号链接，Windows 无开发者模式时不能直接复制；
// 按渲染入口的最小依赖以 hoisted 方式重装，得到无链接的真实文件树
const runtimePkg = {
  name: "shortdeck-remotion-runtime",
  private: true,
  type: "module",
  dependencies: { "@remotion/renderer": "4.0.545" },
};
fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify(runtimePkg, null, 2) + "\n");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = [
  "install",
  "--prod",
  "--node-linker=hoisted",
  "--ignore-workspace",
  "--ignore-scripts",
  "--no-frozen-lockfile",
];
console.log(`[remotion] 安装运行时依赖（${args.join(" ")}）`);
const r =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", [pnpmBin, ...args].join(" ")], { cwd: dest, encoding: "utf-8" })
    : spawnSync(pnpmBin, args, { cwd: dest, encoding: "utf-8" });
if (r.status !== 0) {
  console.error(`[remotion] 安装依赖失败：\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  process.exit(1);
}
fs.copyFileSync(path.join(src, "package.json"), path.join(dest, "package.json"));

const required = ["render.mjs", "build/bundle/index.html", "node_modules/@remotion/renderer/package.json"];
if (!slim) required.push("node_modules/.remotion/chrome-headless-shell");
const missing = required.filter((rel) => !fs.existsSync(path.join(dest, rel)));
if (missing.length) {
  console.error(`[remotion] 暂存结果缺少关键文件：\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

console.log(
  `[remotion] 已暂存 -> ${dest}（${sizeMb(dest)} MB${slim ? "，瘦身模式：用系统 Edge / Chrome 渲染" : ""}，剔除 ${droppedMaps} 个 sourcemap）`,
);
