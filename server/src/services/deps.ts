import fs from "node:fs";
import path from "node:path";
import { binDir } from "../paths.js";

const cache = new Map<string, string | null>();

/** 按 bin 目录 → PATH 查找，结果缓存 */
export function findBinary(name: string): string | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs: string[] = [];
  const bin = binDir();
  if (bin) dirs.push(bin);
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (d.trim()) dirs.push(d);
  }

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) {
          cache.set(name, candidate);
          return candidate;
        }
      } catch {
        // 不存在则跳过
      }
    }
  }

  cache.set(name, null);
  return null;
}

export interface DepsInfo {
  ffmpeg: string | null;
  ffprobe: string | null;
}

export function probeDeps(): DepsInfo {
  return { ffmpeg: findBinary("ffmpeg"), ffprobe: findBinary("ffprobe") };
}
