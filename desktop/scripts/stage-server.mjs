// 暂存后端到 build/resources/payload/server 并装生产依赖；
// 多套一层 payload/ 是为了绕开 electron-builder 对顶层 node_modules 的排除
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const src = path.join(repoRoot, "server");
const destRoot = path.join(here, "..", "build", "resources", "payload");
const dest = path.join(destRoot, "server");

const EXCLUDE_DIRS = ["node_modules", "data", "dist", "out"];

if (!fs.existsSync(src)) {
  console.error(`[stage] 找不到后端目录：${src}`);
  process.exit(1);
}

try {
  fs.rmSync(dest, { recursive: true, force: true });
} catch (e) {
  console.warn(`[stage] 清空旧暂存目录失败，改为覆盖写入：${e?.message ?? e}`);
  // 兜底清掉源码与资源，避免旧文件继续进包
  for (const dir of ["assets", "src"]) {
    try {
      fs.rmSync(path.join(dest, dir), { recursive: true, force: true });
    } catch (inner) {
      console.warn(`[stage] 清理 ${dir} 失败：${inner?.message ?? inner}`);
    }
  }
}
fs.mkdirSync(dest, { recursive: true });

const norm = (p) => p.split(path.sep).join("/");
let skipped = 0;

fs.cpSync(src, dest, {
  recursive: true,
  dereference: false,
  filter(source) {
    const rel = norm(path.relative(src, source));
    if (!rel) return true;
    for (const ex of EXCLUDE_DIRS) {
      if (rel === ex || rel.startsWith(ex + "/")) {
        skipped++;
        return false;
      }
    }
    return true;
  },
});
console.log(`[stage] 已复制 server（跳过 ${skipped} 个运行时产物路径）`);

// assets 随 server 一起复制，这里只做齐全性检查
const requiredAssets = ["assets/prompts"];
for (const rel of requiredAssets) {
  if (!fs.existsSync(path.join(dest, rel))) {
    console.warn(`[stage] 缺少资产：server/${rel}（打包后字幕或背景音乐可能不可用）`);
  }
}

/** 依赖指纹，一致则跳过安装 */
const stampFile = path.join(dest, "node_modules", ".aisv-stage-stamp");

function fingerprint() {
  const hash = createHash("sha256");
  for (const file of [path.join(dest, "package.json"), path.join(dest, "pnpm-lock.yaml")]) {
    try {
      hash.update(path.basename(file)).update(fs.readFileSync(file));
    } catch {
      hash.update(path.basename(file)).update("missing");
    }
  }
  return hash.digest("hex");
}

const want = fingerprint();
let stamp = "";
try {
  stamp = fs.readFileSync(stampFile, "utf-8").trim();
} catch {
  // 无标记则正常安装
}

const depsReady = stamp === want && fs.existsSync(path.join(dest, "node_modules", "fastify", "package.json"));

if (depsReady) {
  console.log("[stage] 生产依赖未变化，跳过安装");
} else {
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = ["install", "--prod", "--node-linker=hoisted", "--ignore-workspace", "--ignore-scripts"];
  console.log(`[stage] 安装生产依赖（${args.join(" ")}）`);

  const r =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [pnpmBin, ...args].join(" ")], { cwd: dest, encoding: "utf-8" })
      : spawnSync(pnpmBin, args, { cwd: dest, encoding: "utf-8" });

  if (r.status !== 0) {
    console.error(`[stage] 安装依赖失败：\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    process.exit(1);
  }

  try {
    fs.writeFileSync(stampFile, want + "\n", "utf-8");
  } catch (e) {
    console.warn(`[stage] 写入依赖缓存标记失败：${e?.message ?? e}`);
  }
}

const must = [
  "src/index.ts",
  "package.json",
  "node_modules/tsx/dist/cli.mjs",
  "node_modules/fastify/package.json",
  "node_modules/@fastify/static/package.json",
  "node_modules/msedge-tts/package.json",
];
const missing = must.filter((m) => !fs.existsSync(path.join(dest, m)));
if (missing.length) {
  console.error(`[stage] 暂存后端缺少关键文件：\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

console.log(`[stage] 自检通过 -> ${dest}`);
