// 装依赖时把 git hooks 指到仓库内的 .githooks，无需额外依赖
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// CI、打包暂存目录里没有 .git，也不是开发者机器，跳过
if (!fs.existsSync(path.join(repoRoot, ".git"))) process.exit(0);
if (process.env.CI === "true" || process.env.CI === "1") process.exit(0);

const r = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: repoRoot,
  encoding: "utf-8",
});

if (r.status !== 0) {
  console.warn(`[setup-hooks] 设置 core.hooksPath 失败：${r.stderr?.trim() || r.error?.message || "未知原因"}`);
  process.exit(0);
}
console.log("[setup-hooks] 已启用 .githooks");
