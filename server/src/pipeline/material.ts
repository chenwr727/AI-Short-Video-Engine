import fs from "node:fs";
import path from "node:path";
import { loadConfig, num } from "../config.js";
import { chat, extractJsonArray, extractJsonObject } from "../services/llm.js";
import { downloadMaterial, searchMaterials } from "../services/material.js";
import { loadSearchTermsPrompt, loadVideoSelectPrompt } from "../services/prompts.js";
import type { AudioManifest, MaterialInfo, MaterialItem, MaterialManifest, TaskContext, Transcript } from "../types.js";

const TERMS_FILE = "_terms.json";
const VIDEOS_FILE = "_videos.json";
const MAX_PAGE = 3;
/** 候选过多会干扰选片模型 */
const MAX_CANDIDATES = 40;
const MIN_CANDIDATES = 24;
const REQUEST_INTERVAL = 400;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 收集 id → 检索词，缺的段由调用方补问 */
function parseTermsMap(answer: string): Map<number, string[]> {
  const out = new Map<number, string[]>();

  const collect = (rows: unknown[]): void => {
    rows.forEach((row, index) => {
      const item = row as Record<string, unknown> | null;
      if (!item || typeof item !== "object") return;
      const raw = item.search_terms ?? item.terms ?? item.keywords;
      if (!Array.isArray(raw)) return;
      const terms = raw.map((t) => String(t).trim()).filter(Boolean);
      if (terms.length === 0) return;

      const id = Number(item.id);
      const key = Number.isFinite(id) && id > 0 ? id : index + 1;
      if ((out.get(key)?.length ?? 0) >= 5) return;
      out.set(key, terms);
    });
  };

  const arrayText = extractJsonArray(answer);
  if (arrayText) {
    try {
      const list = JSON.parse(arrayText) as unknown;
      if (Array.isArray(list)) collect(list);
    } catch {
      // 再试对象包裹的形式
    }
  }

  const objectText = extractJsonObject(answer);
  if (objectText) {
    try {
      const data = JSON.parse(objectText) as Record<string, unknown>;
      if (Array.isArray(data.search_terms ?? data.terms)) collect([data]);
      for (const key of ["search_terms", "data", "results", "items", "paragraphs"]) {
        const value = data[key];
        if (Array.isArray(value) && value.some((row) => row && typeof row === "object")) collect(value);
      }
    } catch {
      // 解析失败视为没拿到
    }
  }

  return out;
}

/** 兜底：从台词取几个短语 */
function fallbackTerms(content: string): string[] {
  const phrases = content
    .replace(/[A-Za-z0-9]+/g, " ")
    .split(/[，。！？；：、\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
  return phrases.length > 0 ? phrases : [content.slice(0, 12) || "video"];
}

/** 每段生成 5 个检索词，落盘 _terms.json */
async function generateTerms(ctx: TaskContext, transcript: Transcript): Promise<string[][]> {
  const file = path.join(ctx.workspace, TERMS_FILE);
  if (fs.existsSync(file)) {
    ctx.log("复用检索词（_terms.json）");
    return JSON.parse(fs.readFileSync(file, "utf-8")) as string[][];
  }

  const prompt = loadSearchTermsPrompt();
  const payload = transcript.paragraphs.map((paragraph, index) => ({
    id: index + 1,
    content: paragraph.dialogues.map((d) => `${d.speaker}：${d.contents.join("")}`).join("\n"),
  }));

  const collected = new Map<number, string[]>();

  // 整批问一次，模型可能只回一部分
  for (let attempt = 1; attempt <= 2 && collected.size === 0; attempt++) {
    const answer = await chat(prompt, JSON.stringify(payload), {
      json: true,
      signal: ctx.signal,
      temperature: 0.6,
    });
    for (const [id, terms] of parseTermsMap(answer)) collected.set(id, terms);
    if (collected.size === 0) ctx.log(`检索词格式不符，重试 ${attempt}/2`, "warn");
  }

  // 缺的段逐段补问
  const missing = payload.filter((item) => (collected.get(item.id)?.length ?? 0) < 5);
  for (const item of missing) {
    if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
    const answer = await chat(prompt, JSON.stringify([item]), {
      json: true,
      signal: ctx.signal,
      temperature: 0.6,
    });
    // 单段提问时 id 可能是 1，也可能是真实段号
    const parsed = parseTermsMap(answer);
    const found = parsed.get(1) ?? parsed.get(item.id);
    if (found) collected.set(item.id, found);
  }

  const terms = payload.map((item) => {
    const got = collected.get(item.id);
    if (got && got.length > 0) return got.slice(0, 5);
    ctx.log(`第 ${item.id} 段拿不到英文检索词，改用台词关键词`, "warn");
    return fallbackTerms(item.content);
  });

  fs.writeFileSync(file, JSON.stringify(terms, null, 2), "utf-8");
  ctx.log(`检索词已生成：${terms.length} 段 × ${terms[0]?.length ?? 0} 个`);
  return terms;
}

/** 让模型挑选语义最贴合的候选 */
async function aiSelect(
  ctx: TaskContext,
  content: string,
  candidates: MaterialInfo[],
  audioLength: number,
): Promise<MaterialInfo | null> {
  if (candidates.length === 0) return null;

  try {
    const prompt = loadVideoSelectPrompt();
    const targetRatio = ctx.options.width / ctx.options.height;
    const payload = {
      content,
      candidates: candidates.map((c, index) => ({
        id: index + 1,
        tags: c.tags.slice(0, 120),
        duration: c.duration,
        views: c.views,
        is_ai_generated: c.isAiGenerated,
        orientation: Math.abs(c.width / c.height - targetRatio) / targetRatio <= 0.35 ? "竖屏" : "横屏",
      })),
    };
    const answer = await chat(prompt, JSON.stringify(payload), { json: true, signal: ctx.signal, temperature: 0.3 });
    const json = extractJsonObject(answer);
    if (!json) return null;

    const data = JSON.parse(json) as { selected_ids?: unknown };
    const ids = Array.isArray(data.selected_ids) ? data.selected_ids : [];
    // 优先取够长的，否则取第一条循环铺满
    let fallback: MaterialInfo | null = null;
    for (const raw of ids) {
      const item = candidates[Number(raw) - 1];
      if (!item) continue;
      if (item.duration >= audioLength) return item;
      fallback ??= item;
    }
    if (fallback) return fallback;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log(`AI 选片失败，改用时长匹配：${error instanceof Error ? error.message : String(error)}`, "warn");
  }
  return null;
}

interface PickedMaterial {
  item: MaterialInfo;
  /** 素材短于配音，合成时循环铺满 */
  loop: boolean;
}

/** 优先够长且最短的，否则取最长的 */
function pickForSegment(candidates: MaterialInfo[], audioLength: number, used: Set<string>): PickedMaterial | null {
  const fresh = candidates.filter((c) => !used.has(c.url));
  if (fresh.length === 0) return null;

  const enough = fresh.filter((c) => c.duration >= audioLength);
  if (enough.length > 0) {
    return { item: enough.reduce((best, current) => (current.duration < best.duration ? current : best)), loop: false };
  }

  const longest = fresh.reduce((best, current) => (current.duration > best.duration ? current : best));
  return { item: longest, loop: true };
}

/** 先按画幅接近挑，挑不到再放宽 */
function chooseMaterial(
  preferred: MaterialInfo[],
  fallback: MaterialInfo[],
  audioLength: number,
  used: Set<string>,
): PickedMaterial | null {
  return pickForSegment(preferred, audioLength, used) ?? pickForSegment(fallback, audioLength, used);
}

/** 排除已用过的素材 */
function fromAiPick(item: MaterialInfo, audioLength: number, used: Set<string>): PickedMaterial | null {
  if (used.has(item.url)) return null;
  return { item, loop: item.duration < audioLength };
}

/** 画幅与成片接近，避免大幅裁切 */
function isAspectClose(item: MaterialInfo, width: number, height: number): boolean {
  const target = width / height;
  const ratio = item.width / item.height;
  return Math.abs(ratio - target) / target <= 0.35;
}

/** 素材清单落盘 */
export function saveMaterialManifest(workspace: string, manifest: MaterialManifest): void {
  fs.writeFileSync(path.join(workspace, VIDEOS_FILE), JSON.stringify(manifest, null, 2), "utf-8");
}

/** 按检索词抓候选素材 */
export async function searchCandidates(
  ctx: TaskContext,
  terms: string[],
  used: Set<string>,
): Promise<MaterialInfo[]> {
  const cfg = loadConfig();
  const source = ctx.options.materialSource;
  const apiKey = source === "pexels" ? cfg.PEXELS_API_KEY : cfg.PIXABAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      `未配置 ${source === "pexels" ? "PEXELS_API_KEY" : "PIXABAY_API_KEY"}，无法检索素材。请编辑 config.json 后重启应用`,
    );
  }

  const candidates: MaterialInfo[] = [];
  const seen = new Set<string>();

  const fetchPage = async (term: string, page: number): Promise<number> => {
    const found = await searchMaterials(source, term, {
      apiKey,
      width: ctx.options.width,
      height: ctx.options.height,
      minDuration: num(cfg.MATERIAL_MIN_DURATION, 10),
      page,
    });

    for (const item of found) {
      if (seen.has(item.url) || used.has(item.url)) continue;
      seen.add(item.url);
      candidates.push(item);
    }
    return found.length;
  };

  // 第一轮每个词搜一遍，避免候选集中
  for (const term of terms) {
    if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
    if (candidates.length >= MAX_CANDIDATES) return candidates.slice(0, MAX_CANDIDATES);
    await fetchPage(term, 1);
    await sleep(REQUEST_INTERVAL, ctx.signal);
  }

  // 第二轮：数量不足时翻页补足
  for (let page = 2; page <= MAX_PAGE && candidates.length < MIN_CANDIDATES; page++) {
    for (const term of terms) {
      if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
      if (candidates.length >= MAX_CANDIDATES) break;
      const count = await fetchPage(term, page);
      if (count === 0) continue;
      await sleep(REQUEST_INTERVAL, ctx.signal);
    }
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

/** 匹配素材，阶段收尾由调用方负责 */
export async function runMaterialStage(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
): Promise<MaterialManifest> {
  const source = ctx.options.materialSource;
  const manifestFile = path.join(ctx.workspace, VIDEOS_FILE);
  if (fs.existsSync(manifestFile)) {
    const cached = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as MaterialManifest;
    if (cached.source === source && Array.isArray(cached.items) && cached.items.length > 0) {
      ctx.log("复用已匹配的素材（_videos.json）");
      return cached;
    }
    ctx.log(`素材来源已改为 ${source}，重新匹配素材`, "warn");
    fs.rmSync(manifestFile, { force: true });
  }

  ctx.markStage("material", "running");
  const terms = await generateTerms(ctx, transcript);
  const used = new Set<string>();
  const items: MaterialItem[] = [];

  for (let pi = 0; pi < transcript.paragraphs.length; pi++) {
    const paragraph = transcript.paragraphs[pi];
    if (!paragraph) continue;

    const paragraphTerms = terms[pi] ?? [];
    const audioLength = audio.paragraphs[pi]?.duration ?? 0;
    ctx.markStage("material", "running", `第 ${pi + 1}/${transcript.paragraphs.length} 段`);
    ctx.log(`第 ${pi + 1} 段匹配素材（需 ${audioLength.toFixed(1)}s）：${paragraphTerms.join(" / ")}`);

    const candidates = await searchCandidates(ctx, paragraphTerms, used);

    if (candidates.length === 0) {
      throw new Error(`第 ${pi + 1} 段没有检索到可用素材（关键词没搜到，或时长/画幅不达标）`);
    }

    const content = paragraph.dialogues.map((d) => `${d.speaker}：${d.contents.join("")}`).join("\n");
    const preferred = candidates.filter((c) => isAspectClose(c, ctx.options.width, ctx.options.height));

    // AI 选片给全量候选，语义优先
    const aiPick = await aiSelect(ctx, content, candidates, audioLength);
    let picked: PickedMaterial | null = aiPick ? fromAiPick(aiPick, audioLength, used) : null;
    picked ??= chooseMaterial(preferred, candidates, audioLength, used);
    if (!picked) {
      throw new Error(`第 ${pi + 1} 段没有可用素材`);
    }

    // 下载失败则顺延到下一个候选
    let videoPath: string | null = null;
    let failedCount = 0;
    while (picked) {
      if (picked.loop) {
        ctx.log(
          `第 ${pi + 1} 段没有 ${audioLength.toFixed(1)}s 以上的整条素材，用 ${picked.item.duration}s 的素材循环铺满`,
          "warn",
        );
      }
      try {
        videoPath = await downloadMaterial(picked.item.url, ctx.signal);
        break;
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        failedCount++;
        used.add(picked.item.url);
        ctx.log(
          `第 ${pi + 1} 段下载失败，换下一个候选：${error instanceof Error ? error.message : String(error)}`,
          "warn",
        );
        picked = chooseMaterial(preferred, candidates, audioLength, used);
      }
    }

    if (!picked || !videoPath) {
      throw new Error(`第 ${pi + 1} 段素材下载失败（已尝试 ${failedCount} 个候选）`);
    }

    const item = picked.item;
    used.add(item.url);
    ctx.log(`第 ${pi + 1} 段 → ${item.tags || item.id}（${item.duration}s, ${item.width}×${item.height}）`);

    items.push({ ...item, videoPath, paragraph: pi + 1, searchTerms: paragraphTerms });
  }

  const manifest: MaterialManifest = { source, items };
  saveMaterialManifest(ctx.workspace, manifest);
  return manifest;
}
