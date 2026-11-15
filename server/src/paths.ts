import fs from "node:fs";
import path from "node:path";

/** 数据目录：Electron 打包态由主进程传 AISV_DATA_DIR，开发态落在仓库 data/ 下 */
export function dataDir(): string {
  return process.env.AISV_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function outDir(): string {
  return process.env.AISV_OUT_DIR ?? path.join(dataDir(), "out");
}

export function workspacesDir(): string {
  return path.join(dataDir(), "workspaces");
}

/** 素材缓存（按 URL 哈希），跨任务复用 */
export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

/** prompts 等静态资源 */
export function assetsDir(): string {
  return process.env.AISV_ASSETS_DIR ?? path.join(process.cwd(), "assets");
}

export function promptsDir(): string {
  return path.join(assetsDir(), "prompts");
}

/** 自定义 BGM 目录（用户自己的音乐放这里）：配置里只写文件名时按它解析 */
export function musicDir(): string {
  return process.env.AISV_MUSIC_DIR ?? path.join(dataDir(), "music");
}

/** 随包携带的 ffmpeg/ffprobe 目录（打包态为 resources/bin） */
export function binDir(): string | null {
  const dir = process.env.AISV_BIN_DIR;
  return dir && fs.existsSync(dir) ? dir : null;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 新建一个工作目录：data/workspaces/<yyyyMMdd-HHmmss> */
export function newWorkspace(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const dir = path.join(workspacesDir(), stamp);
  return ensureDir(dir);
}

export function timestamp(): string {
  return new Date().toISOString();
}
