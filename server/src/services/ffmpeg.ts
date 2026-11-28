import { spawn } from "node:child_process";
import { findBinary } from "./deps.js";
import { userError } from "../errors.js";

export interface FfmpegOptions {
  signal?: AbortSignal;
  cwd?: string;
  /** 总时长 ms，用于换算进度 */
  totalMs?: number;
  onProgress?: (ratio: number) => void;
  idleTimeoutMs?: number;
}

export function ffmpegPath(): string {
  const bin = findBinary("ffmpeg");
  if (!bin) {
    throw userError("noFfmpeg", 500);
  }
  return bin;
}

/** 解析 time= 报进度，空闲超时中断，失败带 stderr 尾部 */
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
