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

async function searchPixabay(term: string, query: MaterialQuery): Promise<MaterialInfo[]> {
  const params = new URLSearchParams({
    key: query.apiKey,
    q: term,
    lang: PIXABAY_LANG,
    video_type: PIXABAY_VIDEO_TYPE,
    min_width: String(query.width),
    min_height: String(query.height),
    safesearch: "true",
    page: String(query.page),
    per_page: "20",
  });

  const data = (await getJson(`https://pixabay.com/api/videos/?${params.toString()}`)) as { hits?: PixabayHit[] };
  const items: MaterialInfo[] = [];

  for (const hit of data.hits ?? []) {
    if (!hit.videos || hit.duration < query.minDuration) continue;

    // 选一档宽高都不小于目标、且高度最接近的画质
    let best: PixabayVideo | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const video of Object.values(hit.videos)) {
      if (video.width < query.width || video.height < query.height) continue;
      const diff = video.height - query.height;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = video;
      }
      if (diff === 0) break;
    }
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

  const targetRatio = query.width / query.height;
  const items: MaterialInfo[] = [];

  for (const video of data.videos ?? []) {
    if (video.duration < query.minDuration) continue;

    const ratio = video.width / video.height;
    if (Math.abs(ratio - targetRatio) / targetRatio > 0.05) continue;

    let best: PexelsFile | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const file of video.video_files ?? []) {
      if (file.width < query.width || file.height < query.height) continue;
      const diff = file.width - query.width;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = file;
      }
    }
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

/** 下载到 data/cache/videos（URL md5 命名），已存在则复用并重新校验 */
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

  // 没有心跳就断开：素材站偶尔会挂起连接，只靠总超时会让任务卡死
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
    return file;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (idle) throw new Error(`素材下载超时（${idleTimeoutMs / 1000}s 无数据）：${key.slice(0, 80)}`);
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal.removeEventListener("abort", stopOnCancel);
  }
}
