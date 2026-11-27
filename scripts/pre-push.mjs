// 推之前跑一遍与 CI 相同的静态检查，省一次「推上去等 CI 报红」的往返。
// 不用 shell 写：Windows 上 git 调起的 POSIX sh 会 fork 失败。
// 测试故意不放进来：tsx 启动子进程在本机偶发 EPERM，会无故挡住推送。
import { spawnSync } from "node:child_process";

/** pnpm 在 Windows 上只有 .cmd，必须经 shell 才能解析 */
const isWin = process.platform === "win32";

/** 一步失败就让整条 hook 失败，并把退出码原样交回 git */
const STEPS = [
  { name: "lint", args: ["lint"] },
  { name: "typecheck", args: ["typecheck"] },
  { name: "format:check", args: ["format:check"] },
];

function runPnpm(args) {
  if (isWin) {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", ["pnpm", ...args].join(" ")], { stdio: "inherit" });
  }
  return spawnSync("pnpm", args, { stdio: "inherit" });
}

for (const step of STEPS) {
  console.log(`\n[pre-push] ${step.name}`);
  const r = runPnpm(step.args);

  if (r.error) {
    // 没装 pnpm 时放行：hook 不该让换机器的人直接推不动
    console.warn(`[pre-push] 无法执行 pnpm（${r.error.message}），跳过检查`);
    process.exit(0);
  }
  if (r.status !== 0) {
    console.error(`\n[pre-push] ${step.name} 未通过，已阻止推送。修好后重推，或 git push --no-verify 跳过。`);
    process.exit(r.status ?? 1);
  }
}

console.log("\n[pre-push] 检查通过");
