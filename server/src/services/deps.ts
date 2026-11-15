import fs from "node:fs";
import path from "node:path";
import { binDir } from "../paths.js";

const cache = new Map<string, string | null>();

/** 按 随包 bin 目录 → PATH 的顺序查找可执行文件，返回绝对路径或 null */
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
        // 继续找
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

/** 渲染前校验：缺 ffmpeg 直接给出可操作的提示，而不是等配音跑完才失败 */
export function requireFfmpeg(): string {
  const bin = findBinary("ffmpeg");
  if (!bin) {
    throw new Error(
      "未检测到 ffmpeg，无法合成视频。请把 ffmpeg 放到下面的目录后重启应用：\n" +
        (binDir() ?? "<应用安装目录>/resources/bin"),
    );
  }
  return bin;
}
