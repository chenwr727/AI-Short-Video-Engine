import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bool, loadConfig, num, numberOrZero } from "../config.js";
import { chat, extractJsonArray, extractJsonObject } from "../services/llm.js";
import { downloadMaterial, searchMaterials, shortenTerms } from "../services/material.js";
import { loadSearchTermsPrompt, loadVideoSelectPrompt, loadVisionSelectPrompt } from "../services/prompts.js";
import type {
  AudioManifest,
  GenerateOptions,
  MaterialInfo,
  MaterialItem,
  MaterialManifest,
  TaskContext,
  Transcript,
} from "../types.js";

const TERMS_FILE = "_terms.json";
const VIDEOS_FILE = "_videos.json";
const MAX_PAGE = 3;
/** 候选过多会干扰选片模型 */
const MAX_CANDIDATES = 60;
const MIN_CANDIDATES = 30;
const REQUEST_INTERVAL = 400;
/** 一次视觉选片最多看几张缩略图：越多越准，也越贵 */
const VISION_MAX_IMAGES = 12;
/** 新素材少于这个数就放宽到已用过的候选，避免越往后越没得选 */
const MIN_FRESH_CANDIDATES = 6;
/**
 * 一个检索词至少带来这么多新候选才算有收获。
 * 实测同段 5 个词高度重叠（第 1 个占 61%），低于这个数说明后面的词在重复劳动。
 */
const MIN_GAIN_PER_TERM = 3;

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

/**
 * 每段生成 5 个检索词，落盘 _terms.json。
 *
 * 画幅和时长必须告诉模型：图库里同一句话横屏结果远多于竖屏，
 * 不说明就会拿到一堆 3840×2160，成片只能裁掉大半画面。
 * Pixabay 把 `vertical` 当筛选词而不是普通关键词（实测带这个词的检索
 * 竖屏占比从 0% 涨到 35~70%，总结果还多 4~5 倍），所以竖屏任务要让它进词。
 */
async function generateTerms(ctx: TaskContext, transcript: Transcript, audio?: AudioManifest): Promise<string[][]> {
  const file = path.join(ctx.workspace, TERMS_FILE);
  const prompt = loadSearchTermsPrompt();
  /*
   * 检索词带提示词指纹：改了 material.json 里的规则（画幅约束、时长约束）后，
   * 老工作区若还复用旧 _terms.json，新规则永远不生效 —— 用户会以为改了提示词没反应。
   * 旧格式是裸的 string[][]，没有指纹，一律当作过期重生成。
   */
  const promptStamp = termsPromptStamp();
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf-8")) as { prompt?: string; terms?: string[][] } | string[][];
      if (!Array.isArray(cached) && cached.prompt === promptStamp && Array.isArray(cached.terms)) {
        ctx.log("复用检索词（_terms.json）");
        return cached.terms;
      }
    } catch {
      // 坏文件按过期处理
    }
    ctx.log("检索词提示词有更新，重新生成检索词", "warn");
  }

  const portrait = ctx.options.height > ctx.options.width;
  const payload = transcript.paragraphs.map((paragraph, index) => ({
    id: index + 1,
    content: paragraph.dialogues.map((d) => `${d.speaker}：${d.contents.join("")}`).join("\n"),
    // 这段配音多长：词要能让模型判断「一条素材够不够铺满」
    seconds: Math.round((audio?.paragraphs[index]?.duration ?? 0) * 10) / 10,
  }));

  /** 画幅上下文的开场白，拼在提示词前面 */
  const frameBrief = portrait
    ? [
        "本次成片是【竖屏 9:16】。",
        "图库检索时 `vertical`（或 vertical video）是画幅筛选词，不是普通关键词 —— 把它放进检索词能显著提高竖屏命中率，",
        "所以每个检索词都应以 `vertical` 开头，后面再接具体画面主体。",
        "例如：`vertical press conference`、`vertical stock chart close up`、`vertical businessman walking`。",
      ].join("\n")
    : [
        "本次成片是【横屏 16:9】。",
        "图库横屏素材本来就是多数，不需要额外加画幅词，直接写具体画面即可。",
        "例如：`press conference`、`stock chart close up`、`businessman walking`。",
      ].join("\n");

  const fullPrompt = `${frameBrief}\n\n${prompt}`;

  const collected = new Map<number, string[]>();

  /*
   * 整批问一次，模型经常只回前一两段。
   *
   * 根因不是模型吝啬，是 `response_format: json_object` 在这个服务端上会把
   * 长数组截断：实测 6 段请求，json_object 模式只吐 182 字符 / 1 段
   * （completion_tokens 却是 1282），同一请求去掉 json_object 就给全了
   * 1112 字符 / 6 段。所以这里**不用 json_object**，直接让模型输出裸数组，
   * 再自己从文本里抽 JSON —— 提示词本来就要求「直接输出数组、不要代码块」。
   */
  const covered = () => payload.filter((item) => (collected.get(item.id)?.length ?? 0) >= 5).length;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (covered() >= Math.ceil(payload.length * 0.5)) break;
    const answer = await chat(fullPrompt, JSON.stringify(payload), {
      signal: ctx.signal,
      temperature: attempt === 1 ? 0.6 : 0.3,
      maxTokens: 4096,
    });
    for (const [id, terms] of parseTermsMap(answer)) {
      if ((collected.get(id)?.length ?? 0) < 5) collected.set(id, terms);
    }
    const done = covered();
    if (done < payload.length) {
      ctx.log(`检索词只覆盖 ${done}/${payload.length} 段，${attempt < 3 ? "整批重试" : "改为逐段补问"}`, "warn");
    }
  }

  // 缺的段逐段补问
  const missing = payload.filter((item) => (collected.get(item.id)?.length ?? 0) < 5);
  for (const item of missing) {
    if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
    const answer = await chat(fullPrompt, JSON.stringify([item]), {
      signal: ctx.signal,
      temperature: 0.6,
      maxTokens: 4096,
    });
    // 单段提问时 id 可能是 1，也可能是真实段号
    const parsed = parseTermsMap(answer);
    const found = parsed.get(1) ?? parsed.get(item.id);
    if (found) collected.set(item.id, found);
  }

  const terms = payload.map((item) => {
    const got = collected.get(item.id);
    if (got && got.length > 0) return fitOrientation(got.slice(0, 5), portrait);
    ctx.log(`第 ${item.id} 段拿不到英文检索词，改用台词关键词`, "warn");
    return fallbackTerms(item.content);
  });

  fs.writeFileSync(file, JSON.stringify({ prompt: promptStamp, terms }, null, 2), "utf-8");
  const sample = terms[0]?.[0] ?? "";
  ctx.log(`检索词已生成：${terms.length} 段 × ${terms[0]?.length ?? 0} 个（示例：${sample}）`);
  return terms;
}

/**
 * 兜底纠正画幅词与词长。
 *
 * 提示词已经要求模型加 `vertical` 并控制长度，但模型偶尔会漏：
 * 漏一个 `vertical` 就等于丢掉大部分竖屏候选，词太长又会把 `vertical`
 * 的筛选效果稀释掉（实测 4 词以上竖屏占比掉到 5~10%）。所以这里按画幅硬修一次。
 */
export function fitOrientation(terms: string[], portrait: boolean): string[] {
  return terms.map((term) => {
    const words = term
      .toLowerCase()
      .replace(/\bvertical\b/gi, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return term;

    if (!portrait) {
      // 横屏：去掉 vertical，最多留 4 个词
      return words.slice(0, 4).join(" ");
    }

    /*
     * 竖屏：vertical + 最多 2 个实义词 = 3 个单词。
     * 取前两个词而不是随机挑，因为提示词要求「中心词在前、修饰在后」。
     */
    return ["vertical", ...words.slice(0, 2)].join(" ");
  });
}

interface SelectOutcome {
  item: MaterialInfo | null;
  /**
   * 视觉选片**永久**不可用（模型不支持图片输入）。
   * 只有这种情况才该关掉后续所有段的看图；
   * 偶发的超时、限流、返回格式异常都只影响当前段。
   */
  visionUnsupported: boolean;
}

/**
 * 判断视觉选片失败是不是「这个模型根本看不了图」。
 *
 * 两者后果完全不同：不支持图片意味着后面每段都会白跑一次 240 秒超时的请求，
 * 必须立刻关掉；而超时、限流、返回格式错都是临时的，关掉就等于让后面所有段落
 * 都退化成标签选片 —— 而 Pexels 根本不返回标签，那样等于盲选。
 */
export function isVisionUnsupported(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    "does not support image",
    "image input",
    "vision",
    "multimodal",
    "invalid content type",
    "image_url",
    "unsupported media",
  ].some((needle) => message.includes(needle));
}

/** 旧 _videos.json 与 Pexels（无标签）都没有 relevance，按贴合处理 */
function relevanceOf(item: MaterialInfo): number {
  return item.relevance ?? 2;
}

/** 去掉零相关素材，全被滤掉时退回原列表 */
function relevantOnly(list: MaterialInfo[]): MaterialInfo[] {
  const kept = list.filter((c) => relevanceOf(c) > 0);
  return kept.length > 0 ? kept : list;
}

/** 排给视觉模型的候选顺序：相关性最重，其次画幅、时长、真实拍摄 */
function visionScore(item: MaterialInfo, targetRatio: number, audioLength: number): number {
  const ratio = item.height > 0 ? item.width / item.height : 0;
  let score = relevanceOf(item) * 4;
  if (ratio > 0 && Math.abs(ratio - targetRatio) / targetRatio <= 0.2) score += 3;
  if (item.duration >= audioLength) score += 2;
  if (!item.isAiGenerated) score += 1;
  return score;
}

/** 按模型给的顺序取第一个时长够的，否则退而取第一个可用画面 */
function takeFromOrdered(ordered: MaterialInfo[], ids: unknown[], audioLength: number): MaterialInfo | null {
  let fallback: MaterialInfo | null = null;
  for (const raw of ids) {
    const item = ordered[Number(raw) - 1];
    if (!item) continue;
    if (item.duration >= audioLength) return item;
    fallback ??= item;
  }
  return fallback;
}

/**
 * 看缩略图选片。Pexels 接口不返回 tags，纯文本选片等于盲选，这里直接让模型看画面。
 * 图片顺序与候选 id 一一对应，模型只需要回答编号。
 */
async function visionSelect(
  ctx: TaskContext,
  content: string,
  candidates: MaterialInfo[],
  audioLength: number,
): Promise<MaterialInfo | null> {
  const usable = candidates.filter((c) => Boolean(c.imageUrl));
  if (usable.length < 3) return null;

  const targetRatio = ctx.options.width / ctx.options.height;
  // 有贴合的候选时，不把看图的额度浪费在零相关素材上
  const relevant = relevantOnly(usable);
  const pool = relevant.length >= 3 ? relevant : usable;
  const ordered = [...pool]
    .sort((a, b) => visionScore(b, targetRatio, audioLength) - visionScore(a, targetRatio, audioLength))
    .slice(0, VISION_MAX_IMAGES);

  const payload = {
    content,
    target_duration: Number(audioLength.toFixed(1)),
    candidates: ordered.map((item, index) => ({
      id: index + 1,
      orientation: item.width >= item.height ? "横屏" : "竖屏",
      duration: item.duration,
      tags: item.tags.slice(0, 80),
    })),
  };

  const answer = await chat(loadVisionSelectPrompt(), JSON.stringify(payload), {
    json: true,
    signal: ctx.signal,
    temperature: 0.2,
    images: ordered.map((item) => item.imageUrl),
    timeoutMs: 240_000,
    // 模型不支持图片时重试没有意义，直接降级到标签选片
    retries: 0,
  });

  const json = extractJsonObject(answer);
  if (!json) throw new Error("视觉选片返回格式不符");

  const data = JSON.parse(json) as { selected_ids?: unknown };
  const ids = Array.isArray(data.selected_ids) ? data.selected_ids : [];
  const picked = takeFromOrdered(ordered, ids, audioLength);
  if (!picked) return null;

  ctx.log(
    `视觉选片：看 ${ordered.length} 张缩略图 → ${picked.tags || picked.id}（${picked.duration}s, ${picked.width}×${picked.height}）`,
  );
  return picked;
}

/**
 * 让模型挑选语义最贴合的候选：先看图，看图不可用时退回标签文本。
 *
 * `visionUnsupported` 只在「模型不支持图片」时为真 —— 那是模型能力问题，
 * 后面每段再试都是白等一次 240 秒超时。临时错误（超时/限流/格式）不关，
 * 下一段继续尝试，避免一次抖动就让整条视频退化成盲选。
 */
async function aiSelect(
  ctx: TaskContext,
  content: string,
  candidates: MaterialInfo[],
  audioLength: number,
  allowVision: boolean,
): Promise<SelectOutcome> {
  if (candidates.length === 0) return { item: null, visionUnsupported: false };

  if (allowVision) {
    try {
      const picked = await visionSelect(ctx, content, candidates, audioLength);
      if (picked) return { item: picked, visionUnsupported: false };
      ctx.log("视觉选片没有给出可用画面，回退到标签选片", "warn");
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      const unsupported = isVisionUnsupported(error);
      const reason = error instanceof Error ? error.message : String(error);
      ctx.log(
        unsupported
          ? `模型不支持图片输入，本次任务改用标签选片：${reason}`
          : `本段视觉选片失败，先退回标签选片，下一段继续尝试看图：${reason}`,
        "warn",
      );
      return { item: null, visionUnsupported: unsupported };
    }
  }

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
        // 0 表示标签与检索词完全不沾边，多为图库的模糊匹配结果
        relevance: relevanceOf(c),
      })),
    };
    const answer = await chat(prompt, JSON.stringify(payload), { json: true, signal: ctx.signal, temperature: 0.3 });
    const json = extractJsonObject(answer);
    if (!json) return { item: null, visionUnsupported: false };

    const data = JSON.parse(json) as { selected_ids?: unknown };
    const ids = Array.isArray(data.selected_ids) ? data.selected_ids : [];
    const picked = takeFromOrdered(candidates, ids, audioLength);
    if (picked) return { item: picked, visionUnsupported: false };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log(`AI 选片失败，改用时长匹配：${error instanceof Error ? error.message : String(error)}`, "warn");
  }
  return { item: null, visionUnsupported: false };
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

/** 先按画幅接近挑，挑不到再放宽；两种情况都优先避开零相关素材 */
function chooseMaterial(
  preferred: MaterialInfo[],
  fallback: MaterialInfo[],
  audioLength: number,
  used: Set<string>,
): PickedMaterial | null {
  return (
    pickForSegment(relevantOnly(preferred), audioLength, used) ??
    pickForSegment(relevantOnly(fallback), audioLength, used)
  );
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

/** 检索词提示词指纹：改了 material.json 里的规则，旧素材清单必须作废 */
function termsPromptStamp(): string {
  return createHash("sha1").update(loadSearchTermsPrompt()).digest("hex").slice(0, 12);
}

/** 来源、画幅、时长门槛、选片方式、镜头数、检索词规则任一变化都要重新匹配 */
function materialSignature(
  options: GenerateOptions,
  minDuration: number,
  vision: boolean,
  shots: number,
  termsStamp: string,
): string {
  return JSON.stringify([
    options.materialSource,
    options.width,
    options.height,
    minDuration,
    vision,
    shots,
    termsStamp,
  ]);
}

/** 没素材的占位项，合成阶段会换成设计卡 */
function fallbackItem(paragraph: number, searchTerms: string[]): MaterialItem {
  return {
    id: 0,
    url: "",
    duration: 0,
    width: 0,
    height: 0,
    tags: "",
    views: 0,
    isAiGenerated: false,
    imageUrl: "",
    videoPath: "",
    paragraph,
    searchTerms,
    fallback: true,
  };
}

/** 素材清单落盘 */
export function saveMaterialManifest(workspace: string, manifest: MaterialManifest): void {
  fs.writeFileSync(path.join(workspace, VIDEOS_FILE), JSON.stringify(manifest, null, 2), "utf-8");
}

/** 按检索词抓候选素材 */
export async function searchCandidates(
  ctx: TaskContext,
  terms: string[],
  used: Set<string> = new Set(),
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
  const requested = new Set<string>();

  /** 返回本次真正新增的候选数，用来判断这次检索有没有收获 */
  const fetchPage = async (term: string, page: number): Promise<number> => {
    const key = `${term}#${page}`;
    if (requested.has(key)) return 0;
    requested.add(key);

    const found = await searchMaterials(source, term, {
      apiKey,
      width: ctx.options.width,
      height: ctx.options.height,
      minDuration: num(cfg.MATERIAL_MIN_DURATION, 10),
      page,
    });

    const before = candidates.length;
    for (const item of found) {
      if (seen.has(item.url) || used.has(item.url)) continue;
      seen.add(item.url);
      candidates.push(item);
    }
    return candidates.length - before;
  };

  /**
   * 没有贴切结果时用更短的两词短语重搜。判据是「有没有 2 分候选」而不是
   * 「有没有结果」：后者会返回 10 条只命中 room 的猫和壁炉，等于没搜到。
   */
  const searchTerm = async (term: string): Promise<void> => {
    const before = candidates.length;
    await fetchPage(term, 1);
    const got = candidates.slice(before);
    if (got.some((c) => relevanceOf(c) === 2)) return;

    for (const short of shortenTerms(term)) {
      ctx.log(`「${term}」没有贴切素材，改用「${short}」重搜`, "warn");
      if ((await fetchPage(short, 1)) === 0) continue;

      // 有收获时清掉这批低分候选，别让猫和壁炉挤占候选池
      const weak = new Set(got.filter((c) => relevanceOf(c) < 2).map((c) => c.url));
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (weak.has(candidates[i]!.url)) candidates.splice(i, 1);
      }
      return;
    }
  };

  // 截断前按贴合度重排，别让后搜到的贴切素材被前一批挤掉
  const take = (): MaterialInfo[] =>
    [...candidates].sort((a, b) => relevanceOf(b) - relevanceOf(a)).slice(0, MAX_CANDIDATES);

  /*
   * 逐个词搜，按新增候选数决定要不要继续。
   *
   * 同一段的 5 个词高度重叠（`vertical stock chart` 与 `vertical trading floor`
   * 结果重合 9/20），连续两个词没带来新候选就说明这组词到头了 ——
   * 继续翻页也是重复劳动，把剩下的词留给用户点「换一个」时用。
   */
  let barren = 0;
  for (const term of terms) {
    if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
    if (candidates.length >= MAX_CANDIDATES) return take();

    const before = candidates.length;
    await searchTerm(term);
    const gained = candidates.length - before;

    barren = gained < MIN_GAIN_PER_TERM ? barren + 1 : 0;
    if (barren >= 2) {
      ctx.log(`连续两个检索词几乎没带来新素材（当前 ${candidates.length} 个），停止继续检索`, "warn");
      break;
    }

    await sleep(REQUEST_INTERVAL, ctx.signal);
  }

  // 第二轮：数量不足时翻页补足
  for (let page = 2; page <= MAX_PAGE && candidates.length < MIN_CANDIDATES; page++) {
    for (const term of terms) {
      if (ctx.signal.aborted) throw new DOMException("已取消", "AbortError");
      if (candidates.length >= MAX_CANDIDATES) break;
      if ((await fetchPage(term, page)) > 0) await sleep(REQUEST_INTERVAL, ctx.signal);
    }
  }

  return take();
}

/**
 * 匹配素材，阶段收尾由调用方负责。
 *
 * `onItem` 在每段素材下载完成后立刻回调，让上层能「完成一段就露一段」，
 * 而不是等整条跑完 1 分多钟才见到第一段。回调里的异常不会中断匹配 ——
 * 它只是进度通知，不该拖垮主流程。
 */
export async function runMaterialStage(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
  onItem?: (item: MaterialItem, done: number, total: number) => void | Promise<void>,
): Promise<MaterialManifest> {
  const source = ctx.options.materialSource;
  const cfg = loadConfig();
  /** 每段画面数，0/1 都按单镜头处理 */
  const shotsPerParagraph = Math.min(3, Math.max(1, Math.floor(numberOrZero(cfg.SHOTS_PER_PARAGRAPH, 2)) || 1));
  /** 没素材时是否改用设计卡，关掉则维持原来的中断行为 */
  const quoteFallback = bool(cfg.QUOTE_FALLBACK, true);
  const signature = materialSignature(
    ctx.options,
    num(cfg.MATERIAL_MIN_DURATION, 10),
    bool(cfg.VISION_SELECT, true),
    shotsPerParagraph,
    termsPromptStamp(),
  );
  const manifestFile = path.join(ctx.workspace, VIDEOS_FILE);
  if (fs.existsSync(manifestFile)) {
    const cached = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as MaterialManifest;
    if (cached.signature === signature && Array.isArray(cached.items) && cached.items.length > 0) {
      ctx.log("复用已匹配的素材（_videos.json）");
      return cached;
    }
    ctx.log(`素材来源、画幅或时长门槛变了，重新匹配素材（${source}）`, "warn");
    fs.rmSync(manifestFile, { force: true });
  }

  ctx.markStage("material", "running");
  const terms = await generateTerms(ctx, transcript, audio);
  const used = new Set<string>();
  const items: MaterialItem[] = [];
  // 模型不支持图片输入时只失败一次，后续段落不再重试
  let allowVision = bool(cfg.VISION_SELECT, true);

  /** 上报一段的成果；通知失败不算匹配失败 */
  const report = async (item: MaterialItem): Promise<void> => {
    if (!onItem) return;
    try {
      await onItem(item, items.length, transcript.paragraphs.length);
    } catch {
      // 进度通知与素材无关，吞掉
    }
  };

  for (let pi = 0; pi < transcript.paragraphs.length; pi++) {
    const paragraph = transcript.paragraphs[pi];
    if (!paragraph) continue;

    const paragraphTerms = terms[pi] ?? [];
    const audioLength = audio.paragraphs[pi]?.duration ?? 0;
    ctx.markStage("material", "running", `第 ${pi + 1}/${transcript.paragraphs.length} 段`);
    ctx.log(`第 ${pi + 1} 段匹配素材（需 ${audioLength.toFixed(1)}s）：${paragraphTerms.join(" / ")}`);

    const candidates = await searchCandidates(ctx, paragraphTerms);

    if (candidates.length === 0) {
      if (quoteFallback) {
        ctx.log(`第 ${pi + 1} 段没有检索到素材，改用设计卡`, "warn");
        const placeholder = fallbackItem(pi + 1, paragraphTerms);
        items.push(placeholder);
        await report(placeholder);
        continue;
      }
      throw new Error(`第 ${pi + 1} 段没有检索到可用素材（关键词没搜到，或时长/画幅不达标）`);
    }

    // 已用过的素材尽量避开，但后面段落不能因此没得选，否则越往后画面越差
    const fresh = candidates.filter((c) => !used.has(c.url));
    const pool = fresh.length >= MIN_FRESH_CANDIDATES ? fresh : candidates;
    if (fresh.length < MIN_FRESH_CANDIDATES) {
      ctx.log(`第 ${pi + 1} 段新素材只有 ${fresh.length} 个，放宽到已用过的候选（共 ${candidates.length} 个）`, "warn");
    }

    const content = paragraph.dialogues.map((d) => `${d.speaker}：${d.contents.join("")}`).join("\n");
    const preferred = pool.filter((c) => isAspectClose(c, ctx.options.width, ctx.options.height));

    /*
     * 视觉选片优先。只有「模型不支持图片」才把后续段落的看图关掉；
     * 临时失败（超时/限流/格式错）不影响下一段继续尝试。
     */
    const selection = await aiSelect(ctx, content, pool, audioLength, allowVision);
    if (selection.visionUnsupported) allowVision = false;
    let picked: PickedMaterial | null = selection.item ? fromAiPick(selection.item, audioLength, used) : null;
    picked ??= chooseMaterial(preferred, pool, audioLength, used);
    // 全都用过时允许复用，画面重复好过中断流程
    picked ??= chooseMaterial(preferred, pool, audioLength, new Set());
    if (!picked) {
      if (quoteFallback) {
        ctx.log(`第 ${pi + 1} 段没有可选素材，改用设计卡`, "warn");
        const placeholder = fallbackItem(pi + 1, paragraphTerms);
        items.push(placeholder);
        await report(placeholder);
        continue;
      }
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
        picked =
          chooseMaterial(preferred, pool, audioLength, used) ?? chooseMaterial(preferred, pool, audioLength, new Set());
      }
    }

    if (!picked || !videoPath) {
      if (quoteFallback) {
        ctx.log(`第 ${pi + 1} 段素材下载全部失败（已试 ${failedCount} 个），改用设计卡`, "warn");
        const placeholder = fallbackItem(pi + 1, paragraphTerms);
        items.push(placeholder);
        await report(placeholder);
        continue;
      }
      throw new Error(`第 ${pi + 1} 段素材下载失败（已尝试 ${failedCount} 个候选）`);
    }

    const item = picked.item;
    used.add(item.url);
    ctx.log(`第 ${pi + 1} 段 → ${item.tags || item.id}（${item.duration}s, ${item.width}×${item.height}）`);

    // 段内补充镜头：一条素材撑满整段最容易显得呆板
    const shots: MaterialInfo[] = [];
    for (let k = 1; k < shotsPerParagraph; k++) {
      const excluded = new Set([item.url, ...shots.map((s) => s.url)]);
      const extra = chooseMaterial(
        preferred.filter((c) => !excluded.has(c.url)),
        pool.filter((c) => !excluded.has(c.url)),
        Math.max(1, audioLength / shotsPerParagraph),
        used,
      );
      if (!extra) break;

      try {
        const shotPath = await downloadMaterial(extra.item.url, ctx.signal);
        shots.push({ ...extra.item, videoPath: shotPath });
        used.add(extra.item.url);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        // 补充画面下载失败不阻塞主流程
        break;
      }
    }

    const finished: MaterialItem = {
      ...item,
      videoPath,
      paragraph: pi + 1,
      searchTerms: paragraphTerms,
      shots: shots.length > 0 ? shots : undefined,
    };
    items.push(finished);
    if (shots.length > 0) {
      ctx.log(`第 ${pi + 1} 段共 ${shots.length + 1} 个镜头`);
    }
    // 这一段素材落地了，立刻让上层露出来，不必等整条跑完
    await report(finished);
  }

  const manifest: MaterialManifest = { source, signature, items };
  saveMaterialManifest(ctx.workspace, manifest);
  return manifest;
}
