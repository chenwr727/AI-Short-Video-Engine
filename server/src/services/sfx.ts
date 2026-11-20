import fs from "node:fs";
import path from "node:path";
import { cacheDir, ensureDir } from "../paths.js";
import { runFfmpeg } from "./ffmpeg.js";

export type SfxKind = "whoosh" | "impact";

/** AISV_SFX_DIR 下放同名 wav 即可替换成自己的音效 */
function customFile(kind: SfxKind): string | null {
  const dir = process.env.AISV_SFX_DIR;
  if (!dir) return null;
  const file = path.join(dir, `${kind}.wav`);
  return fs.existsSync(file) && fs.statSync(file).size > 0 ? file : null;
}

/**
 * 程序合成的基础音效：不依赖外部素材包，音量压得很低，
 * 只为在转场和片头给一个听觉落点。
 */
const RECIPES: Record<SfxKind, string> = {
  // 转场：粉噪声快速扫过
  whoosh:
    "anoisesrc=color=pink:duration=0.5:sample_rate=44100," +
    "highpass=f=450,lowpass=f=5200," +
    "afade=t=in:st=0:d=0.12,afade=t=out:st=0.18:d=0.3,volume=0.9",
  // 片头：低频落点
  impact:
    "sine=frequency=78:duration=0.42:sample_rate=44100," +
    "afade=t=in:st=0:d=0.005,afade=t=out:st=0.06:d=0.34,volume=1.4",
};

/** 生成并缓存音效，失败返回 null（不影响出片） */
export async function ensureSfx(kind: SfxKind): Promise<string | null> {
  const custom = customFile(kind);
  if (custom) return custom;

  const dir = ensureDir(path.join(cacheDir(), "sfx"));
  const file = path.join(dir, `${kind}.wav`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;

  try {
    await runFfmpeg(["-f", "lavfi", "-i", RECIPES[kind], "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2", file]);
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}
