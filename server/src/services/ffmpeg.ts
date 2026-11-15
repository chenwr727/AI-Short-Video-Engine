import { spawn } from "node:child_process";
import { findBinary } from "./deps.js";

export interface FfmpegOptions {
  signal?: AbortSignal;
  cwd?: string;
  /** 输出总时长（毫秒），用于把 time= 换算成进度 */
  totalMs?: number;
  onProgress?: (ratio: number) => void;
  idleTimeoutMs?: number;
}

export function ffmpegPath(): string {
  const bin = findBinary("ffmpeg");
  if (!bin) {
    throw new Error("未检测到 ffmpeg，无法合成视频。请安装 ffmpeg 或使用带内置 ffmpeg 的安装包");
  }
  return bin;
}

/** 执行 ffmpeg：解析 time= 报告进度，长时间无输出则中断，失败时抛出 stderr 尾部 */
export function runFfmpeg(args: string[], opts: FfmpegOptions = {}): Promise<void> {
  const bin = ffmpegPath();
  const idleTimeoutMs = opts.idleTimeoutMs ?? 180_000;

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["-hide_banner", "-nostdin", "-y", ...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let lastOutput = Date.now();
    let killedByIdle = false;

    const watchdog = setInterval(() => {
      if (Date.now() - lastOutput > idleTimeoutMs) {
        killedByIdle = true;
        proc.kill();
      }
    }, 5000);

    proc.stderr.on("data", (buf: Buffer) => {
      lastOutput = Date.now();
      const chunk = buf.toString();
      stderr = (stderr + chunk).slice(-8000);

      const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(chunk);
      if (match && opts.totalMs && opts.onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        opts.onProgress(Math.min(1, (seconds * 1000) / opts.totalMs));
      }
    });

    const onAbort = () => proc.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    proc.on("error", (error) => {
      clearInterval(watchdog);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    proc.on("close", (code) => {
      clearInterval(watchdog);
      opts.signal?.removeEventListener("abort", onAbort);

      if (killedByIdle) {
        reject(new Error(`ffmpeg ${idleTimeoutMs / 1000}s 无输出，已中断`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg 退出码 ${code}：\n${stderr.slice(-1200)}`));
    });
  });
}
