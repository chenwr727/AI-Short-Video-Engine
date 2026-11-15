import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findBinary } from "./deps.js";

const execFileAsync = promisify(execFile);

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
}

interface ProbeJson {
  streams?: { width?: number; height?: number }[];
  format?: { duration?: string };
}

async function probeWithFfprobe(bin: string, file: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(bin, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);

  const data = JSON.parse(String(stdout)) as ProbeJson;
  const stream = data.streams?.[0];
  const duration = Number(data.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);

  if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
    throw new Error(`素材文件无法解析：${file}`);
  }
  return { duration, width, height };
}

/** 没有 ffprobe 时退回 ffmpeg：从 stderr 的 Duration / Stream 行里抠出时长与分辨率 */
async function probeWithFfmpeg(file: string): Promise<VideoProbe | null> {
  const bin = findBinary("ffmpeg");
  if (!bin) return null;

  const stderr = await new Promise<string>((resolve) => {
    execFile(bin, ["-hide_banner", "-i", file], { maxBuffer: 8 * 1024 * 1024 }, (_error, _stdout, errOut) => {
      resolve(String(errOut ?? ""));
    });
  });

  const durationMatch = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const sizeMatch = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!durationMatch || !sizeMatch) return null;

  const duration =
    Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(sizeMatch[1]);
  const height = Number(sizeMatch[2]);

  if (!Number.isFinite(duration) || duration <= 0 || !width || !height) return null;
  return { duration, width, height };
}

/** 校验素材：能解析出时长与分辨率才算下载成功；ffprobe 缺失时用 ffmpeg 兜底 */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const ffprobe = findBinary("ffprobe");

  if (ffprobe) {
    try {
      return await probeWithFfprobe(ffprobe, file);
    } catch (error) {
      const fallback = await probeWithFfmpeg(file);
      if (fallback) return fallback;
      throw error;
    }
  }

  const fallback = await probeWithFfmpeg(file);
  if (fallback) return fallback;

  throw new Error(`未检测到 ffprobe，ffmpeg 也读不出素材信息：${file}`);
}
