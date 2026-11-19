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
  streams?: { width?: number; height?: number; disposition?: { attached_pic?: number } }[];
  format?: { duration?: string };
}

async function probeWithFfprobe(bin: string, file: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(bin, [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height:stream_disposition=attached_pic",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);

  const data = JSON.parse(String(stdout)) as ProbeJson;
  const duration = Number(data.format?.duration);

  // 跳过封面图，取面积最大的视频流
  let width = 0;
  let height = 0;
  for (const s of data.streams ?? []) {
    if (s.disposition?.attached_pic) continue;
    const w = Number(s.width);
    const h = Number(s.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w * h > width * height) {
      width = w;
      height = h;
    }
  }

  if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
    throw new Error(`素材文件无法解析：${file}`);
  }
  return { duration, width, height };
}

/** 无 ffprobe 时从 stderr 解析 */
async function probeWithFfmpeg(file: string): Promise<VideoProbe | null> {
  const bin = findBinary("ffmpeg");
  if (!bin) return null;

  const stderr = await new Promise<string>((resolve) => {
    execFile(bin, ["-hide_banner", "-i", file], { maxBuffer: 8 * 1024 * 1024 }, (_error, _stdout, errOut) => {
      resolve(String(errOut ?? ""));
    });
  });

  const durationMatch = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!durationMatch) return null;

  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  // MKV 常带封面附加流，取面积最大的一条
  let width = 0;
  let height = 0;
  for (const line of stderr.split("\n")) {
    if (!line.includes("Video:")) continue;
    const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(line);
    if (!size) continue;
    const w = Number(size[1]);
    const h = Number(size[2]);
    if (w * h > width * height) {
      width = w;
      height = h;
    }
  }

  if (!width || !height) return null;
  return { duration, width, height };
}

/** 优先 ffprobe，缺失时用 ffmpeg */
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
