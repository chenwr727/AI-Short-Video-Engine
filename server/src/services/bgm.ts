import fs from "node:fs";
import path from "node:path";
import { musicDir } from "../paths.js";

const SR = 44100;
const MASTER = 0.25;
/** A 小调琶音音高 */
const ARP = [261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 329.63, 261.63];
const NOTESEC = 0.33;
const CHUNK_SAMPLES = Math.floor(SR * 0.5);

/** 合成琶音 + 低音，输出 44.1kHz 立体声 WAV */
async function synthBgmWav(durationSec: number): Promise<Buffer> {
  const n = Math.floor(SR * durationSec);
  const samples = new Float64Array(n);
  let peak = 0;

  const fill = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const t = i / SR;
      const k = Math.floor(t / NOTESEC) % ARP.length;
      const local = t - Math.floor(t / NOTESEC) * NOTESEC;
      const env = Math.exp(-local * 7.0);
      const arp = Math.sin(2 * Math.PI * (ARP[k] ?? 261.63) * t) * env;
      const bassF = Math.floor(t / 2) % 2 === 0 ? 130.81 : 98.0;
      const bass = Math.sin(2 * Math.PI * bassF * t) * 0.3;
      const v = arp * 0.85 + bass * 0.15;
      samples[i] = v;
      if (v > peak) peak = v;
      else if (-v > peak) peak = -v;
    }
  };

  for (let start = 0; start < n; start += CHUNK_SAMPLES) {
    fill(start, Math.min(n, start + CHUNK_SAMPLES));
    await new Promise((resolve) => setImmediate(resolve));
  }

  const scale = peak === 0 ? 1.0 : 0.35 / peak;

  const bytesPerSample = 2;
  const numChannels = 2;
  const dataSize = n * numChannels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let start = 0; start < n; start += CHUNK_SAMPLES) {
    let offset = 44 + start * numChannels * bytesPerSample;
    const end = Math.min(n, start + CHUNK_SAMPLES);
    for (let i = start; i < end; i++) {
      let v = (samples[i] as number) * scale * MASTER;
      v = Math.max(-1, Math.min(1, v));
      const s = Math.round(v * 32767);
      buf.writeInt16LE(s, offset);
      offset += 2;
      buf.writeInt16LE(s, offset);
      offset += 2;
    }
    if (end < n) await new Promise((resolve) => setImmediate(resolve));
  }

  return buf;
}

/** 失败返回 null */
export async function generateBgm(file: string, durationSec: number): Promise<string | null> {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await synthBgmWav(Math.max(3, durationSec)));
    return file;
  } catch (error) {
    console.error(`[bgm] 生成失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 只做粗筛，能否解码交给 ffmpeg */
const MUSIC_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus", ".wma"]);

/** 绝对路径直接用，否则先找 musicDir 再找 cwd */
export function resolveMusicFile(ref: string): { file: string | null; reason?: string } {
  const text = (ref ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text) return { file: null };

  const candidates = path.isAbsolute(text) ? [text] : [path.join(musicDir(), text), path.resolve(process.cwd(), text)];

  const hit = candidates.find((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });

  if (!hit) return { file: null, reason: `找不到自定义音乐：${text}` };
  if (!MUSIC_EXT.has(path.extname(hit).toLowerCase())) {
    return { file: null, reason: `自定义音乐格式不支持：${path.basename(hit)}` };
  }
  return { file: hit };
}

export interface BgmPlan {
  file: string;
  /** true = 用户指定，false = 程序合成 */
  custom: boolean;
}

export interface PrepareBgmOptions {
  output: string;
  durationSec: number;
  /** 留空则程序合成 */
  ref?: string;
}

/** 优先用自定义音乐，找不到则退回程序合成 */
export async function prepareBgm(options: PrepareBgmOptions): Promise<{ plan: BgmPlan | null; reason?: string }> {
  const resolved = resolveMusicFile(options.ref ?? "");
  if (resolved.file) return { plan: { file: resolved.file, custom: true } };

  const synth = await generateBgm(options.output, options.durationSec);
  const plan = synth ? { file: synth, custom: false } : null;
  return resolved.reason ? { plan, reason: `${resolved.reason}，改用程序合成 BGM` } : { plan };
}
