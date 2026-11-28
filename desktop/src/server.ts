import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { app } from "electron";
import { binDir, repoRoot, runtimeDataDir, serverDir, webDistDir } from "./paths";
import { configFile } from "./config";

export interface Backend {
  port: number;
  baseUrl: string;
  proc: ChildProcess | null;
  stop: () => void;
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** tsx 可能被提升到仓库根，两个位置都找 */
function tsxCliPath(): string {
  const candidates = [
    path.join(serverDir(), "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "node_modules", ".pnpm"),
  ];
  for (const candidate of candidates) {
    if (candidate.endsWith(".mjs") && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`未找到 tsx。请先在仓库根目录执行 pnpm install。\n已尝试：\n${candidates.join("\n")}`);
}

function buildEnv(port: number): NodeJS.ProcessEnv {
  const dataDir = runtimeDataDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    SHORTDECK_DATA_DIR: dataDir,
    SHORTDECK_OUT_DIR: path.join(dataDir, "out"),
    // 静态资源随服务器目录
    SHORTDECK_ASSETS_DIR: path.join(serverDir(), "assets"),
    SHORTDECK_CONFIG_FILE: configFile(),
    SHORTDECK_VERSION: app.getVersion(),
    ELECTRON_RUN_AS_NODE: "1",
  };

  // 配置只从 config.json 现读，不冻进环境变量
  const dist = webDistDir();
  if (fs.existsSync(path.join(dist, "index.html"))) env.SHORTDECK_WEB_DIR = dist;

  const bin = binDir();
  if (fs.existsSync(bin)) {
    env.SHORTDECK_BIN_DIR = bin;
    env.PATH = `${bin}${path.delimiter}${env.PATH ?? ""}`;
  }

  return env;
}

export async function waitForHealth(baseUrl: string, timeoutMs: number, proc?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`后端进程已退出（code ${proc.exitCode}），请查看终端日志。`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`后端在 ${timeoutMs}ms 内未就绪${lastErr ? `：${String(lastErr)}` : ""}`);
}

export async function startBackend(port: number, onLog: (line: string) => void): Promise<Backend> {
  const dir = serverDir();
  const entry = path.join(dir, "src", "index.ts");
  if (!fs.existsSync(entry)) throw new Error(`未找到后端入口：${entry}`);

  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [tsxCliPath(), entry], {
    cwd: dir,
    env: buildEnv(port),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const pipe = (stream: NodeJS.ReadableStream | null) => {
    stream?.on("data", (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) onLog(line);
      }
    });
  };
  pipe(proc.stdout);
  pipe(proc.stderr);

  const backend: Backend = {
    port,
    baseUrl,
    proc,
    stop: () => {
      if (proc.exitCode === null && !proc.killed) proc.kill();
    },
  };

  await waitForHealth(baseUrl, 60_000, proc);
  return backend;
}
