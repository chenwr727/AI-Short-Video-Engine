// 按顺序执行构建步骤，失败时报告步骤与退出码
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocales } from "../../scripts/build-locales.mjs";

/*
 * 先清掉 ELECTRON_RUN_AS_NODE。
 *
 * 它的本意是让 Electron 以纯 node 模式启动，但残留在 shell 环境里时，
 * 本脚本 spawn 的任何 node 子进程都会直接 EPERM 失败 —— 报错只写
 * 「spawnSync <node.exe> EPERM」，看不出真正原因，非常难查。
 * 必须在第一次 spawn 之前删，放在循环里就晚了。
 */
delete process.env.ELECTRON_RUN_AS_NODE;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const isWin = process.platform === "win32";

/** 带 Remotion 卡片（片头 / 过场 / 版式）的包体积会多 ~460 MB；--slim 时改用系统浏览器，只多 ~160 MB */
const withRemotion = process.argv.includes("--with-remotion") || process.env.AISV_WITH_REMOTION === "1";
const slimRemotion = process.argv.includes("--slim") || process.env.AISV_REMOTION_SLIM === "1";

/** 直接用 node 跑 tsc，避免 Windows 下的 .cmd */
const tscCli = path.join(desktop, "node_modules", "typescript", "bin", "tsc");

const steps = [
  {
    name: "locales",
    // 语言包以仓库根的 locales/ 为真源，编译成 assets/locales.json 供原生页面读取。
    // 直接调用而不是起子进程：少一次 spawn，在被限制创建进程的环境里也更稳。
    run: () => {
      const problems = buildLocales();
      if (problems.length) {
        for (const p of problems) console.error(`  ${p}`);
        process.exitCode = 1;
      }
    },
  },
  {
    name: "web",
    // Windows 下需经 cmd/s 才能解析 pnpm.cmd
    cmd: isWin ? "cmd.exe" : "pnpm",
    args: isWin ? ["/d", "/s", "/c", "pnpm -C ../web run build"] : ["-C", "../web", "run", "build"],
  },
  { name: "icon", cmd: process.execPath, args: ["scripts/make-icon.mjs"] },
  { name: "ffmpeg", cmd: process.execPath, args: ["scripts/copy-ffmpeg.mjs"] },
  { name: "stage", cmd: process.execPath, args: ["scripts/stage-server.mjs"] },
  ...(withRemotion
    ? [
        {
          name: "remotion",
          cmd: process.execPath,
          args: ["scripts/stage-remotion.mjs", ...(slimRemotion ? ["--slim"] : [])],
        },
      ]
    : []),
  { name: "tsc", cmd: process.execPath, args: [tscCli, "-p", "tsconfig.json"] },
];

// 上一轮带卡片构建的暂存目录必须清掉，否则会静默打进本次的轻量包
const remotionStage = path.join(desktop, "build", "resources", "remotion-payload");
if (!withRemotion) {
  fs.rmSync(remotionStage, { recursive: true, force: true });
  // 留空目录：electron-builder 的 extraResources 指向不存在路径会报错
  fs.mkdirSync(remotionStage, { recursive: true });
  console.log("[build] 跳过 Remotion，已清理上次的暂存目录");
}

/** NTSTATUS 退出码 → 可读原因 */
const HINTS = {
  "0x80000003": "STATUS_BREAKPOINT：被断点或系统异常中断，常见于杀软干预",
  "0xC0000005": "STATUS_ACCESS_VIOLATION：内存访问违例",
  "0xC0000409": "STATUS_STACK_BUFFER_OVERRUN：进程主动快速失败",
  "0xC000013A": "被 Ctrl+C 或关窗口中断",
  "0xC0000142": "DLL 初始化失败",
};

function describe(code) {
  const unsigned = code >>> 0;
  const hex = "0x" + unsigned.toString(16).toUpperCase().padStart(8, "0");
  const hint = HINTS[hex];
  return hint ? `${code}（${hex}，${hint}）` : `${code}（${hex}）`;
}

for (const step of steps) {
  console.log(`\n[build] ▶ ${step.name}`);
  const started = Date.now();

  // 有些步骤直接在本进程里跑，不起子进程
  if (step.run) {
    try {
      step.run();
    } catch (error) {
      console.error(`\n[build] ✗ ${step.name} 失败：${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    if (process.exitCode) {
      console.error(`\n[build] ✗ ${step.name} 失败`);
      process.exit(1);
    }
    console.log(`[build] ✓ ${step.name}（${((Date.now() - started) / 1000).toFixed(1)}s）`);
    continue;
  }

  const r = spawnSync(step.cmd, step.args, {
    cwd: desktop,
    stdio: "inherit",
    shell: Boolean(step.shell),
  });
  const cost = ((Date.now() - started) / 1000).toFixed(1);

  if (r.error) {
    console.error(`[build] ✗ ${step.name} 启动失败：${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n[build] ✗ ${step.name} 失败，用时 ${cost}s，退出码 ${describe(r.status ?? -1)}`);
    process.exit(1);
  }
  console.log(`[build] ✓ ${step.name}（${cost}s）`);
}

console.log("\n[build] 全部完成");
