import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { findBinary } from "./deps.js";

const execFileAsync = promisify(execFile);

/** 按 magic bytes 判断容器格式，决定落盘扩展名 */
export function detectAudioExt(buf: Buffer): "wav" | "mp3" {
  const isRiff = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF";
  const isWave = isRiff && buf.toString("ascii", 8, 12) === "WAVE";
  return isWave ? "wav" : "mp3";
}

/** 解析 WAV 头得到时长（字节数 / 字节率），避免额外调用 ffprobe */
export function wavDuration(buf: Buffer): number | null {
  if (detectAudioExt(buf) !== "wav") return null;

  let offset = 12;
  let byteRate = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt " && body + 12 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === "data") {
      if (!byteRate || byteRate <= 0) return null;
      // 部分服务端返回的 wav 会把 RIFF/data 长度写成占位值（0x7FFFFFFF），
      // 此时以文件实际剩余字节为准，否则会算出几小时的时长。
      const available = buf.length - body;
      const bytes = size > available ? available : size;
      return bytes / byteRate;
    }

    offset = body + size + (size % 2);
  }
  return null;
}

// MPEG 音频（mp3）码率表，单位 kbps，下标对应 header 里的 bitrate index - 1
const MPEG1_L1 = [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const MPEG1_L2 = [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const MPEG1_L3 = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L1 = [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const MPEG2_L23 = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

const SAMPLE_RATES = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
} as const;

interface Mp3Frame {
  frameLength: number;
  samples: number;
  sampleRate: number;
}

/** 解析一帧 MPEG 音频头；不是合法帧时返回 null */
function readMp3Frame(buf: Buffer, offset: number): Mp3Frame | null {
  if (offset + 4 > buf.length) return null;
  const b1 = buf[offset + 1] as number;
  const b2 = buf[offset + 2] as number;

  if (buf[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03; // 3=MPEG1 2=MPEG2 0=MPEG2.5 1=保留
  const layerBits = (b1 >> 1) & 0x03; // 3=Layer1 2=Layer2 1=Layer3 0=保留
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  if (version === 1 || layerBits === 0) return null;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const mpeg1 = version === 3;
  const layer = 4 - layerBits; // 1 / 2 / 3

  const table = mpeg1
    ? layer === 1
      ? MPEG1_L1
      : layer === 2
        ? MPEG1_L2
        : MPEG1_L3
    : layer === 1
      ? MPEG2_L1
      : MPEG2_L23;

  const bitrate = (table[bitrateIndex - 1] ?? 0) * 1000;
  const sampleRate = SAMPLE_RATES[version as 0 | 2 | 3][sampleRateIndex];
  if (!bitrate || !sampleRate) return null;

  // Layer3 在 MPEG2/2.5 下一帧只有 576 个采样
  const samples = layer === 1 ? 384 : layer === 2 ? 1152 : mpeg1 ? 1152 : 576;
  const frameLength =
    layer === 1
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  if (frameLength <= 4) return null;

  return { frameLength, samples, sampleRate };
}

/** 跳过文件头的 ID3v2 标签 */
function skipId3v2(buf: Buffer): number {
  if (buf.length < 10 || buf.toString("ascii", 0, 3) !== "ID3") return 0;
  const size =
    (((buf[6] as number) & 0x7f) << 21) |
    (((buf[7] as number) & 0x7f) << 14) |
    (((buf[8] as number) & 0x7f) << 7) |
    ((buf[9] as number) & 0x7f);
  return 10 + size;
}

/** 找 MPEG 音频流的起点：ID3 之后第一个「连续两帧都合法」的位置，避免误判别的数据 */
function findFirstMp3Frame(buf: Buffer): number {
  const begin = skipId3v2(buf);
  const limit = Math.min(buf.length - 8, begin + 4096);

  for (let offset = begin; offset <= limit; offset += 1) {
    const frame = readMp3Frame(buf, offset);
    if (!frame) continue;
    if (readMp3Frame(buf, offset + frame.frameLength)) return offset;
  }
  return -1;
}

/** 逐帧累加 mp3 时长：不依赖 ffprobe，CBR / VBR 都适用 */
export function mp3Duration(buf: Buffer): number | null {
  const start = findFirstMp3Frame(buf);
  if (start < 0) return null;

  let offset = start;
  let seconds = 0;
  let frames = 0;

  // 连续帧一断就停：真实 mp3 帧是挨着的，这样不会把非 mp3 数据算成时长
  while (offset + 4 <= buf.length) {
    const frame = readMp3Frame(buf, offset);
    if (!frame) break;
    seconds += frame.samples / frame.sampleRate;
    frames += 1;
    offset += frame.frameLength;
  }

  if (frames < 2 || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

async function ffprobeDuration(file: string): Promise<number> {
  const bin = findBinary("ffprobe");
  if (!bin) throw new Error("未检测到 ffprobe，无法解析音频时长");
  const { stdout } = await execFileAsync(bin, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`无法解析音频时长：${file}`);
  }
  return duration;
}

/** 没有 ffprobe 时退回 ffmpeg：不给输出文件会报错退出，但时长已经打在 stderr 上 */
async function ffmpegDuration(file: string): Promise<number | null> {
  const bin = findBinary("ffmpeg");
  if (!bin) return null;

  const stderr = await new Promise<string>((resolve) => {
    execFile(bin, ["-hide_banner", "-i", file], { maxBuffer: 4 * 1024 * 1024 }, (_error, _stdout, errOut) => {
      resolve(String(errOut ?? ""));
    });
  });

  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;

  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export async function audioDuration(file: string): Promise<number> {
  const buf = fs.readFileSync(file);

  // 1) wav 直接读头；2) mp3 逐帧累加：都不需要外部二进制
  const fromHeader = wavDuration(buf);
  if (fromHeader && fromHeader > 0) return fromHeader;

  const fromFrames = mp3Duration(buf);
  if (fromFrames && fromFrames > 0) return fromFrames;

  // 3) 兜底交给 ffprobe / ffmpeg
  if (findBinary("ffprobe")) return ffprobeDuration(file);

  const fromFfmpeg = await ffmpegDuration(file);
  if (fromFfmpeg) return fromFfmpeg;

  throw new Error(`无法解析音频时长：${file}（没找到 ffprobe，ffmpeg 也读不出来）`);
}
