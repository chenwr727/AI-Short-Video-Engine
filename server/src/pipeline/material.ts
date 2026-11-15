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
const MAX_CANDIDATES = 12;
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

function parseTermsAnswer(answer: string, expected: number): string[][] | null {
  const arrayText = extractJsonArray(answer);
  if (arrayText) {
    try {
      const list = JSON.parse(arrayText) as { id?: number; search_terms?: unknown }[];
      const mapped = list
        .filter((item) => Array.isArray(item.search_terms))
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
        .map((item) => (item.search_terms as unknown[]).map((t) => String(t).trim()).filter(Boolean));
      if (mapped.length === expected && mapped.every((terms) => terms.length >= 5)) return mapped;
    } catch {
      // 继续尝试对象包裹的形式
    }
  }

  const objectText = extractJsonObject(answer);
  if (objectText) {
    try {
      const data = JSON.parse(objectText) as Record<string, unknown>;
      for (const key of ["search_terms", "data", "results", "items"]) {
        const value = data[key];
        if (Array.isArray(value) && value.length === expected) {
          const mapped = value.map((row) => {
            const item = row as Record<string, unknown>;
            const terms = item.search_terms ?? item.terms;
            return Array.isArray(terms) ? terms.map((t) => String(t).trim()).filter(Boolean) : [];
          });
          if (mapped.every((terms) => terms.length >= 5)) return mapped;
        }
      }
    } catch {
      // 忽略
    }
  }
  return null;
}

/** 每段对话 → 5 个英文检索词，结果落盘 _terms.json */
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

  for (let attempt = 1; attempt <= 3; attempt++) {
    const answer = await chat(prompt, JSON.stringify(payload), {
      json: true,
      signal: ctx.signal,
      temperature: 0.6,
    });
    const terms = parseTermsAnswer(answer, payload.length);
    if (terms) {
      fs.writeFileSync(file, JSON.stringify(terms, null, 2), "utf-8");
      ctx.log(`检索词已生成：${terms.length} 段 × ${terms[0]?.length ?? 0} 个`);
      return terms;
    }
    ctx.log(`检索词格式不符，重试 ${attempt}/3`, "warn");
  }

  throw new Error("检索词生成失败：模型没有返回符合要求的结果");
}

/** 让模型从候选里挑语义最贴合的，失败时回落到时长规则 */
async function aiSelect(
  ctx: TaskContext,
  content: string,
  candidates: MaterialInfo[],
  audioLength: number,
): Promise<MaterialInfo | null> {
  try {
    const prompt = loadVideoSelectPrompt();
    const payload = {
      content,
      // Pixabay 的 tags 是超长逗号串，截断后语义噪声更少
      candidates: candidates.map((c, index) => ({
        id: index + 1,
        tags: c.tags.slice(0, 120),
        duration: c.duration,
        views: c.views,
        is_ai_generated: c.isAiGenerated,
      })),
    };
    const answer = await chat(prompt, JSON.stringify(payload), { json: true, signal: ctx.signal, temperature: 0.3 });
    const json = extractJsonObject(answer);
    if (!json) return null;

    const data = JSON.parse(json) as { selected_ids?: unknown };
    const ids = Array.isArray(data.selected_ids) ? data.selected_ids : [];
    for (const raw of ids) {
      const item = candidates[Number(raw) - 1];
      if (item && item.duration >= audioLength) return item;
    }
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log(`AI 选片失败，改用时长匹配：${error instanceof Error ? error.message : String(error)}`, "warn");
  }
  return null;
}

interface PickedMaterial {
  item: MaterialInfo;
  /** 素材本身短于配音，合成时会被循环铺满 */
  loop: boolean;
}

/**
 * 规则兜底：优先「够长且最短」（避免素材拖长成片）；
 * 一条都不够长时取最长的那条，交给合成阶段 -stream_loop 循环铺满，
 * 总比整段匹配失败要强。
 */
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

/** 先在自己画幅的候选里挑，挑不到再放宽到全部候选 */
function chooseMaterial(
  candidates: MaterialInfo[],
  pool: MaterialInfo[],
  audioLength: number,
  used: Set<string>,
): PickedMaterial | null {
  return pickForSegment(pool, audioLength, used) ?? pickForSegment(candidates, audioLength, used);
}

/** 竖屏成片优先用竖屏素材，避免下载 4K 横屏再大幅裁切 */
function isAspectClose(item: MaterialInfo, width: number, height: number): boolean {
  const target = width / height;
  const ratio = item.width / item.height;
  return Math.abs(ratio - target) / target <= 0.35;
}

/** 素材清单落盘：手动换素材后也写回这里，重跑与合成阶段都读它 */
export function saveMaterialManifest(workspace: string, manifest: MaterialManifest): void {
  fs.writeFileSync(path.join(workspace, VIDEOS_FILE), JSON.stringify(manifest, null, 2), "utf-8");
}

/** 按检索词抓候选素材（跳过已用过的），首轮匹配与手动换素材共用 */
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

  search: for (const term of terms) {
    for (let page = 1; page <= MAX_PAGE; page++) {
      if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
      if (candidates.filter((c) => !used.has(c.url)).length >= MAX_CANDIDATES) break search;

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
      if (found.length === 0) break;
      await sleep(REQUEST_INTERVAL, ctx.signal);
    }
  }

  return candidates;
}

export async function runMaterialStage(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
): Promise<MaterialManifest> {
  const manifestFile = path.join(ctx.workspace, VIDEOS_FILE);
  if (fs.existsSync(manifestFile)) {
    ctx.log("复用已匹配的素材（_videos.json）");
    ctx.markStage("material", "skipped", "命中缓存");
    return JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as MaterialManifest;
  }

  const source = ctx.options.materialSource;
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
    const aspectFit = candidates.filter((c) => isAspectClose(c, ctx.options.width, ctx.options.height));
    const pool = aspectFit.length > 0 ? aspectFit : candidates;

    const aiPick = await aiSelect(ctx, content, pool, audioLength);
    let picked: PickedMaterial | null = aiPick
      ? { item: aiPick, loop: false }
      : chooseMaterial(candidates, pool, audioLength, used);
    if (!picked) {
      throw new Error(`第 ${pi + 1} 段没有可用素材`);
    }
    if (picked.loop) {
      ctx.log(
        `第 ${pi + 1} 段没有 ${audioLength.toFixed(1)}s 以上的整条素材，用 ${picked.item.duration}s 的素材循环铺满`,
        "warn",
      );
    }

    // 下载失败（链接失效 / 连接挂起）时顺延到下一个候选
    let videoPath: string | null = null;
    let failedCount = 0;
    while (picked) {
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
        picked = chooseMaterial(candidates, pool, audioLength, used);
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
  ctx.markStage("material", "done", `${items.length} 段`);
  return manifest;
}
