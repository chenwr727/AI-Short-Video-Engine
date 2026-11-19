import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { cacheDir, ensureDir } from "../paths.js";
import { probeVideo } from "./probe.js";
import type { MaterialInfo, MaterialSource } from "../types.js";

export interface MaterialQuery {
  apiKey: string;
  width: number;
  height: number;
  minDuration: number;
  page: number;
}

const PIXABAY_LANG = "zh";
const PIXABAY_VIDEO_TYPE = "all";
const PEXELS_LOCALE = "zh-CN";
/** 素材缓存上限（MB），超出按最久未用淘汰 */
const CACHE_MAX_MB = Number(process.env.AISV_CACHE_MAX_MB) || 2048;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`素材接口失败（HTTP ${res.status}）：${url.split("?")[0]}`);
  }
  return res.json();
}

interface PixabayVideo {
  url: string;
  width: number;
  height: number;
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  duration: number;
  tags?: string;
  views?: number;
  isAiGenerated?: boolean;
  videos?: Record<string, PixabayVideo>;
}

/** 合成是 scale + crop，按裁后高度评估素材 */
function croppedHeight(width: number, height: number, targetRatio: number): number {
  if (width <= 0 || height <= 0) return 0;
  return width / height > targetRatio ? height : width / targetRatio;
}

/** 裁后高度下限：最多放大 1.5 倍 */
function minCroppedHeight(targetHeight: number): number {
  return Math.max(480, Math.round(targetHeight / 1.5));
}

/** 优先选裁后达标且最小的档位 */
function pickRendition<T extends { width: number; height: number }>(files: T[], query: MaterialQuery): T | null {
  const targetRatio = query.width / query.height;
  const floor = minCroppedHeight(query.height);
  let enough: T | null = null;
  let enoughHeight = Number.POSITIVE_INFINITY;
  let best: T | null = null;
  let bestHeight = 0;

  for (const file of files) {
    const height = croppedHeight(file.width, file.height, targetRatio);
    if (height < floor) continue;
    if (height >= query.height) {
      if (height < enoughHeight) {
        enoughHeight = height;
        enough = file;
      }
    } else if (height > bestHeight) {
      bestHeight = height;
      best = file;
    }
  }

  return enough ?? best;
}

async function searchPixabay(term: string, query: MaterialQuery): Promise<MaterialInfo[]> {
  // 不传 min_width/min_height，否则会误杀可裁切的横屏素材
  const params = new URLSearchParams({
    key: query.apiKey,
    q: term,
    lang: PIXABAY_LANG,
    video_type: PIXABAY_VIDEO_TYPE,
    safesearch: "true",
    page: String(query.page),
    per_page: "20",
  });

  const data = (await getJson(`https://pixabay.com/api/videos/?${params.toString()}`)) as { hits?: PixabayHit[] };
  const items: MaterialInfo[] = [];

  for (const hit of data.hits ?? []) {
    if (!hit.videos || hit.duration < query.minDuration) continue;

    const best: PixabayVideo | null = pickRendition(Object.values(hit.videos), query);
    if (!best) continue;

    items.push({
      id: hit.id,
      url: best.url,
      duration: hit.duration,
      width: best.width,
      height: best.height,
      tags: hit.tags ?? "",
      views: Number(hit.views ?? 0),
      isAiGenerated: Boolean(hit.isAiGenerated),
      imageUrl: best.thumbnail ?? "",
      videoPath: "",
    });
  }
  return items;
}

interface PexelsFile {
  link: string;
  width: number;
  height: number;
}

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  image?: string;
  is_ai_generated?: boolean;
  video_files?: PexelsFile[];
}

function orientationOf(width: number, height: number): string {
  if (height > width) return "portrait";
  if (width > height) return "landscape";
  return "square";
}

async function searchPexels(term: string, query: MaterialQuery): Promise<MaterialInfo[]> {
  const params = new URLSearchParams({
    query: term,
    orientation: orientationOf(query.width, query.height),
    page: String(query.page),
    per_page: "20",
  });
  if (PEXELS_LOCALE) params.set("locale", PEXELS_LOCALE);

  const data = (await getJson(`https://api.pexels.com/videos/search?${params.toString()}`, {
    Authorization: query.apiKey,
  })) as { videos?: PexelsVideo[] };

  const items: MaterialInfo[] = [];

  for (const video of data.videos ?? []) {
    if (video.duration < query.minDuration) continue;

    // 服务端已按 orientation 过滤，这里按裁后像素把关
    const best = pickRendition(video.video_files ?? [], query);
    if (!best) continue;

    items.push({
      id: video.id,
      url: best.link,
      duration: video.duration,
      width: best.width,
      height: best.height,
      tags: "",
      views: 0,
      isAiGenerated: Boolean(video.is_ai_generated),
      imageUrl: video.image ?? "",
      videoPath: "",
    });
  }
  return items;
}

export function searchMaterials(source: MaterialSource, term: string, query: MaterialQuery): Promise<MaterialInfo[]> {
  if (source === "pexels") return searchPexels(term, query);
  return searchPixabay(term, query);
}

/** 超出上限时按 mtime 淘汰，跳过刚下载的文件 */
function pruneCache(keep: string): void {
  try {
    const dir = path.join(cacheDir(), "videos");
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".mp4"))
      .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return { file, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files) {
      if (total <= CACHE_MAX_MB * 1024 * 1024) break;
      if (f.file === keep) continue;
      fs.rmSync(f.file, { force: true });
      total -= f.size;
    }
  } catch {
    // 缓存目录不可用时跳过
  }
}

/** 下载到 cache/videos，按 URL 哈希命名，已存在则复用 */
export async function downloadMaterial(url: string, signal: AbortSignal, idleTimeoutMs = 30_000): Promise<string> {
  const dir = ensureDir(path.join(cacheDir(), "videos"));
  const key = url.split("?")[0] ?? url;
  const hash = createHash("md5").update(key).digest("hex");
  const file = path.join(dir, `vid-${hash}.mp4`);

  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    try {
      await probeVideo(file);
      return file;
    } catch {
      fs.rmSync(file, { force: true });
    }
  }

  const temp = `${file}.part`;
  const controller = new AbortController();
  const stopOnCancel = () => controller.abort();
  signal.addEventListener("abort", stopOnCancel, { once: true });

  // 素材站可能挂起连接，仅靠总超时会让任务卡死
  let idleTimer: NodeJS.Timeout | undefined;
  let idle = false;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      controller.abort();
    }, idleTimeoutMs);
  };

  resetIdle();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
    });
    if (!res.ok || !res.body) throw new Error(`素材下载失败（HTTP ${res.status}）`);

    const stream = Readable.fromWeb(res.body as unknown as WebReadableStream);
    stream.on("data", resetIdle);
    await pipeline(stream, fs.createWriteStream(temp));

    await probeVideo(temp).catch((e: unknown) => {
      fs.rmSync(temp, { force: true });
      throw e;
    });
    fs.renameSync(temp, file);
    pruneCache(file);
    return file;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (idle) throw new Error(`素材下载超时（${idleTimeoutMs / 1000}s 无数据）：${key.slice(0, 80)}`, { cause: error });
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal.removeEventListener("abort", stopOnCancel);
  }
}
