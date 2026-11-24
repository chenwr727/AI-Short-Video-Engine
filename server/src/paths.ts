import fs from "node:fs";
import path from "node:path";

/** 打包态由主进程传 AISV_DATA_DIR，开发态为仓库 data/ */
export function dataDir(): string {
  return process.env.AISV_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function outDir(): string {
  return process.env.AISV_OUT_DIR ?? path.join(dataDir(), "out");
}

export function workspacesDir(): string {
  return path.join(dataDir(), "workspaces");
}

/** 素材缓存，按 URL 哈希存放 */
export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

export function assetsDir(): string {
  return process.env.AISV_ASSETS_DIR ?? path.join(process.cwd(), "assets");
}

/** 随包内置的提示词，打包后在 resources 里，用户改不到 */
export function promptsDir(): string {
  return path.join(assetsDir(), "prompts");
}

/** 用户覆盖层：同名的写在 data/prompts 下，优先于内置 */
export function userPromptsDir(): string {
  return process.env.AISV_USER_PROMPTS_DIR ?? path.join(dataDir(), "prompts");
}

/** 自定义 BGM 目录 */
export function musicDir(): string {
  return process.env.AISV_MUSIC_DIR ?? path.join(dataDir(), "music");
}

/** 随包携带的 ffmpeg 目录 */
export function binDir(): string | null {
  const dir = process.env.AISV_BIN_DIR;
  return dir && fs.existsSync(dir) ? dir : null;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 新建带时间戳的工作目录，重名追加序号 */
export function newWorkspace(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  for (let suffix = 1; suffix < 100; suffix++) {
    const dir = path.join(workspacesDir(), suffix === 1 ? stamp : `${stamp}-${suffix}`);
    if (!fs.existsSync(dir)) return ensureDir(dir);
  }
  return ensureDir(path.join(workspacesDir(), `${stamp}-${Date.now()}`));
}
