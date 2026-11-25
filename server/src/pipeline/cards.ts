import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bool, cardAccentPalette, loadConfig, numberOrZero, type AppConfig } from "../config.js";
import { CARD_TEMPLATES, defaultTemplate, isTemplateFor } from "../card-templates.js";
import { ensureDir } from "../paths.js";
import { chat, extractJsonObject } from "../services/llm.js";
import { lastRenderErrorMessage, renderCard, renderCardStill } from "../services/remotion.js";
import { transcriptFingerprint } from "./tts.js";
import type {
  AudioManifest,
  CardKind,
  CardManifest,
  CardPrefs,
  CardSpec,
  MaterialManifest,
  TaskContext,
  Transcript,
} from "../types.js";

const DEFAULT_LABEL: Record<CardKind, string> = {
  intro: "AI 摘要",
  chapter: "PART",
  outro: "下期见",
  quote: "观点",
};

const MAX_TITLE = 14;
const MAX_CHAPTER = 12;

export function cardsEnabled(cfg: AppConfig = loadConfig()): boolean {
  return bool(cfg.CARDS_ENABLED, false);
}

interface CardPlan {
  introSec: number;
  chapterSec: number;
  outroSec: number;
  /** 只开了版式步骤、三个卡片开关全关：按默认出片头与章节卡 */
  auto: boolean;
}

const DEFAULT_CHAPTER_SEC = 2;

/** 章节卡总量上限：再多的段也只插这么多张，避免成片全是卡片 */
export const MAX_CHAPTER_CARDS = 6;

/** 各类卡片的时长决策，与段落数无关；版式页的展示与出片共用这一套 */
export function cardDefaults(cfg: AppConfig): CardPlan {
  const introOn = bool(cfg.INTRO_ENABLED, false);
  const chapterOn = bool(cfg.CHAPTER_CARD, false);
  const titleSec = Math.max(0, numberOrZero(cfg.TITLE_DURATION, 0));
  const chapterSec = Math.max(0, numberOrZero(cfg.CHAPTER_DURATION, DEFAULT_CHAPTER_SEC));
  const outroSec = Math.max(0, numberOrZero(cfg.OUTRO_DURATION, 0));

  // 三个开关全关：步骤开着总得有点产出，按片头/过场卡时长出一份默认清单
  if (!introOn && !chapterOn && outroSec === 0) {
    return { introSec: titleSec, chapterSec, outroSec: 0, auto: true };
  }

  return {
    introSec: introOn ? titleSec : 0,
    chapterSec: chapterOn ? chapterSec : 0,
    outroSec,
    auto: false,
  };
}

/**
 * 各类卡片的实际时长。段落不足时章节卡自动取消，其余沿用 cardDefaults。
 * overrides 是绝对取值：0 = 不出这类卡，>0 = 用这个秒数，只有 undefined 才回落到配置。
 */
export function cardPlan(
  cfg: AppConfig,
  paragraphs: number,
  overrides: {
    introDurationSec?: number;
    chapterDurationSec?: number;
    outroDurationSec?: number;
  } = {},
): CardPlan {
  const chapterLimit = Math.max(0, Math.min(paragraphs - 1, MAX_CHAPTER_CARDS));
  const base = cardDefaults(cfg);

  const pick = (manual: number | undefined, fallback: number) =>
    manual === undefined ? fallback : Math.max(0, manual);

  const plan: CardPlan = {
    introSec: pick(overrides.introDurationSec, base.introSec),
    // 章节卡插在段落之间，只有 1 段时没有位置
    chapterSec: chapterLimit > 0 ? pick(overrides.chapterDurationSec, base.chapterSec) : 0,
    outroSec: pick(overrides.outroDurationSec, base.outroSec),
    auto: base.auto,
  };

  return plan;
}

function pickAccent(value: unknown, palette: string[]): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const hit = palette.find((color) => color.toLowerCase() === raw);
  return hit ?? palette[0] ?? "#ff5a3c";
}

/** 用户手动点过的配色；没选或不在色板里返回 null，交给 AI/配置决定 */
function manualAccent(prefs: CardPrefs | null | undefined, palette: string[]): string | null {
  const raw = (prefs?.accent ?? "").trim().toLowerCase();
  if (!raw) return null;
  return palette.find((color) => color.toLowerCase() === raw) ?? null;
}

export function cleanCardText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const trimmed = Array.from(text).slice(0, max).join("");
  return trimmed.replace(/[，,。.；;：:！!？?、…\-—]+$/g, "");
}

/** 只算影响画面的字段：参数不变就命中缓存 */
export function cardFingerprint(spec: CardSpec, width: number, height: number, fps: number): string {
  const payload = [
    spec.compositionId,
    spec.title,
    spec.label,
    spec.handle ?? "",
    spec.accent,
    spec.durationSec.toFixed(3),
    `${width}x${height}@${fps}`,
  ].join("|");
  return createHash("md5").update(payload).digest("hex").slice(0, 12);
}

export function cardSignature(transcript: Transcript, width: number, height: number): string {
  return `${transcriptFingerprint(transcript)}|${width}x${height}`;
}

function normalizeSpec(spec: CardSpec, cfg: AppConfig, width: number, height: number, fps: number): CardSpec {
  const normalized: CardSpec = {
    ...spec,
    title: cleanCardText(spec.title, spec.kind === "chapter" ? MAX_CHAPTER : MAX_TITLE),
    label: (spec.label ?? "").trim() || DEFAULT_LABEL[spec.kind],
    accent: pickAccent(spec.accent, cardAccentPalette(cfg)),
  };
  normalized.fingerprint = cardFingerprint(normalized, width, height, fps);
  return normalized;
}

interface DraftCard {
  title?: string;
  template?: string;
}

interface DraftChapters {
  style?: string;
  intro?: DraftCard;
  chapters?: { paragraph?: number; title?: string; template?: string }[];
  outro?: DraftCard;
}

function templateList(kind: CardKind): string {
  return CARD_TEMPLATES[kind].map((template) => `${template.id}（${template.name}：${template.hint}）`).join(" / ");
}

function buildPrompt(transcript: Transcript, chapterLimit: number): string {
  const lines = transcript.paragraphs.map((paragraph, index) => {
    const first = paragraph.dialogues[0]?.contents[0] ?? "";
    return `第 ${index + 1} 段 · 主题：${paragraph.description || "无"} · 首句：${first}`;
  });

  return [
    `视频标题：${transcript.title}`,
    "分段信息：",
    ...lines,
    "",
    "请为这条竖屏短视频设计卡片文案和版式：",
    "1. 片头标题：不超过 10 字，要像封面钩子，不要照抄视频标题，不要带标点。",
    `2. 片头模板从这里选：${templateList("intro")}`,
    `3. 章节卡：从第 2 段开始，挑出最多 ${chapterLimit} 段各写一个 4-10 字的主题短语，要像章节名，不要照抄台词。`,
    `4. 章节模板从这里选：${templateList("chapter")}`,
    "5. 片尾标题：不超过 10 字，一句号召。",
    `6. 片尾模板从这里选：${templateList("outro")}`,
    "只输出 JSON，不要解释：",
    '{"style":"一句话风格说明","intro":{"title":"...","template":"TitleCard"},"chapters":[{"paragraph":2,"title":"...","template":"ChapterCard"}],"outro":{"title":"...","template":"OutroCard"}}',
  ].join("\n");
}

async function pickAccentByVision(
  ctx: TaskContext,
  material: MaterialManifest | null,
  palette: string[],
  cfg: AppConfig,
): Promise<string | null> {
  if (!bool(cfg.VISION_SELECT, true)) return null;

  const images = (material?.items ?? [])
    .flatMap((item) => [item.imageUrl, ...(item.shots ?? []).map((shot) => shot.imageUrl)])
    .filter((url): url is string => typeof url === "string" && url.startsWith("http"))
    .slice(0, 2);
  if (images.length === 0) return null;

  try {
    const text = await chat(
      "你是短视频视觉设计师，只输出 JSON。",
      [
        "下面是这条视频要用的素材画面。请从这些主色里挑一个和画面最搭的：",
        palette.join(" "),
        '只输出 {"accent":"#xxxxxx","reason":"不超过 12 字"}',
      ].join("\n"),
      { images, json: true, temperature: 0.4, retries: 0, signal: ctx.signal },
    );
    const json = extractJsonObject(text);
    const raw = json ? (JSON.parse(json) as { accent?: string; reason?: string }) : null;
    const wanted = typeof raw?.accent === "string" ? raw.accent.trim().toLowerCase() : "";
    const hit = palette.find((color) => color.toLowerCase() === wanted);
    if (!hit) return null;
    ctx.log(`按画面主色选配色：${hit}${raw?.reason ? `（${cleanCardText(raw.reason, 12)}）` : ""}`);
    return hit;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    ctx.log(`视觉选色失败，用默认主色：${error instanceof Error ? error.message : String(error)}`, "warn");
    return null;
  }
}

/** AI 失败或超时时的兜底清单 */
function fallbackManifest(
  cfg: AppConfig,
  transcript: Transcript,
  width: number,
  height: number,
  fps: number,
  prefs?: CardPrefs | null,
): CardManifest {
  const items: CardSpec[] = [];
  const palette = cardAccentPalette(cfg);
  const accent = manualAccent(prefs, palette) ?? palette[0] ?? "#ff5a3c";
  const plan = cardPlan(cfg, transcript.paragraphs.length, prefs ?? {});

  if (plan.introSec > 0) {
    items.push(
      normalizeSpec(
        {
          id: "intro",
          kind: "intro",
          compositionId: defaultTemplate("intro"),
          title: transcript.title,
          label: DEFAULT_LABEL.intro,
          accent,
          durationSec: plan.introSec,
        },
        cfg,
        width,
        height,
        fps,
      ),
    );
  }

  if (plan.chapterSec > 0) {
    transcript.paragraphs.forEach((paragraph, index) => {
      if (index === 0) return;
      const first = paragraph.dialogues[0]?.contents[0] ?? paragraph.description ?? "";
      items.push(
        normalizeSpec(
          {
            id: `chapter-${index + 1}`,
            kind: "chapter",
            compositionId: defaultTemplate("chapter"),
            paragraph: index + 1,
            title: first,
            label: `${DEFAULT_LABEL.chapter}`,
            accent,
            durationSec: plan.chapterSec,
          },
          cfg,
          width,
          height,
          fps,
        ),
      );
    });
  }

  const outroSec = plan.outroSec;
  if (outroSec > 0) {
    items.push(
      normalizeSpec(
        {
          id: "outro",
          kind: "outro",
          compositionId: defaultTemplate("outro"),
          title: (cfg.OUTRO_TITLE ?? "").trim() || "关注我，下期见",
          label: DEFAULT_LABEL.outro,
          handle: (cfg.OUTRO_HANDLE ?? "").trim() || undefined,
          accent,
          durationSec: outroSec,
        },
        cfg,
        width,
        height,
        fps,
      ),
    );
  }

  return { items, style: "内置模板", signature: cardSignature(transcript, width, height) };
}

/** 按内置模板补建指定类型（wanted 只放真正缺的类型），规则与 fallbackManifest 一致 */
export function buildCards(
  cfg: AppConfig,
  transcript: Transcript,
  wanted: Iterable<CardKind>,
  secs: Partial<Record<CardKind, number>>,
  accent: string,
  width: number,
  height: number,
  fps: number,
): CardSpec[] {
  const want = new Set(wanted);
  const items: CardSpec[] = [];
  const push = (spec: CardSpec) => items.push(normalizeSpec(spec, cfg, width, height, fps));

  if (want.has("intro")) {
    push({
      id: "intro",
      kind: "intro",
      compositionId: defaultTemplate("intro"),
      title: transcript.title,
      label: DEFAULT_LABEL.intro,
      accent,
      durationSec: secs.intro ?? 0,
    });
  }

  // 章节卡插在段落之间：第 1 段前面不放，最多 MAX_CHAPTER_CARDS 张
  if (want.has("chapter")) {
    const limit = Math.max(0, Math.min(transcript.paragraphs.length - 1, MAX_CHAPTER_CARDS));
    transcript.paragraphs.slice(1, limit + 1).forEach((paragraph, offset) => {
      const index = offset + 2;
      push({
        id: `chapter-${index}`,
        kind: "chapter",
        compositionId: defaultTemplate("chapter"),
        paragraph: index,
        title: paragraph.dialogues[0]?.contents[0] ?? paragraph.description ?? "",
        label: DEFAULT_LABEL.chapter,
        accent,
        durationSec: secs.chapter ?? 0,
      });
    });
  }

  if (want.has("outro")) {
    push({
      id: "outro",
      kind: "outro",
      compositionId: defaultTemplate("outro"),
      title: (cfg.OUTRO_TITLE ?? "").trim() || "关注我，下期见",
      label: DEFAULT_LABEL.outro,
      handle: (cfg.OUTRO_HANDLE ?? "").trim() || undefined,
      accent,
      durationSec: secs.outro ?? 0,
    });
  }

  return items;
}

/** 一次 LLM 调用产出整份清单，失败退回内置模板，不阻塞流水线 */
export async function runCardsStage(
  ctx: TaskContext,
  transcript: Transcript,
  _audio: AudioManifest | null,
  material: MaterialManifest | null,
  prefs?: CardPrefs | null,
): Promise<CardManifest> {
  const cfg = loadConfig();
  const { width, height, fps } = ctx.options;
  const palette = cardAccentPalette(cfg);
  const paragraphs = transcript.paragraphs.length;
  const chapterLimit = Math.max(0, Math.min(paragraphs - 1, MAX_CHAPTER_CARDS));

  const plan = cardPlan(cfg, paragraphs, prefs ?? {});
  const fallback = fallbackManifest(cfg, transcript, width, height, fps, prefs);
  if (plan.introSec === 0 && plan.chapterSec === 0 && plan.outroSec === 0) {
    ctx.log("没有可用的卡片类型，跳过版式", "warn");
    return fallback;
  }

  ctx.markStage("cards", "running", "AI 设计版式");
  if (plan.auto) {
    ctx.log(
      "未单独开启片头 / 章节卡 / 片尾，按「片头时长」与「过场卡时长」出片头与章节卡；不想要卡片请在版式页把时长改成 0",
    );
  }
  ctx.log("正在让 AI 为片头 / 章节 / 片尾写文案并选模板…");

  // 手动点过配色就用它，否则交给视觉模型，再不行用色板第一个
  const manual = manualAccent(prefs, palette);
  if (manual) ctx.log(`按你的选择用主色：${manual}`);
  const accent = manual ?? (await pickAccentByVision(ctx, material, palette, cfg)) ?? palette[0] ?? "#ff5a3c";

  const system = "你是短视频内容编辑，擅长把长文提炼成封面钩子和章节标题。只输出 JSON，不要 markdown，不要解释。";

  let draft: DraftChapters | null = null;
  try {
    const text = await chat(system, buildPrompt(transcript, chapterLimit), {
      json: true,
      temperature: 0.8,
      signal: ctx.signal,
    });
    const json = extractJsonObject(text);
    draft = json ? (JSON.parse(json) as DraftChapters) : null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    ctx.log(`AI 设计版式失败，改用内置模板：${error instanceof Error ? error.message : String(error)}`, "warn");
  }

  if (!draft) return fallback;

  const items: CardSpec[] = [];
  const introSec = plan.introSec;
  if (introSec > 0) {
    items.push(
      normalizeSpec(
        {
          id: "intro",
          kind: "intro",
          compositionId: isTemplateFor("intro", draft.intro?.template)
            ? draft.intro.template
            : defaultTemplate("intro"),
          title: draft.intro?.title || transcript.title,
          label: DEFAULT_LABEL.intro,
          accent,
          durationSec: introSec,
        },
        cfg,
        width,
        height,
        fps,
      ),
    );
  }

  const chapterSec = plan.chapterSec;
  if (chapterSec > 0) {
    const seen = new Set<number>();
    const drafts = (draft.chapters ?? []).slice(0, chapterLimit);
    for (const entry of drafts) {
      const paragraph = Number(entry?.paragraph);
      if (!Number.isFinite(paragraph) || paragraph < 2 || paragraph > paragraphs) continue;
      if (seen.has(paragraph)) continue;
      const title = cleanCardText(entry?.title, MAX_CHAPTER);
      if (!title) continue;
      seen.add(paragraph);
      items.push(
        normalizeSpec(
          {
            id: `chapter-${paragraph}`,
            kind: "chapter",
            compositionId: isTemplateFor("chapter", entry?.template) ? entry.template : defaultTemplate("chapter"),
            paragraph,
            title,
            label: DEFAULT_LABEL.chapter,
            accent,
            durationSec: chapterSec,
          },
          cfg,
          width,
          height,
          fps,
        ),
      );
    }

    // AI 一张都没选出来时退回每段一张，避免空清单
    if (items.every((item) => item.kind !== "chapter")) {
      for (const item of fallback.items) {
        if (item.kind === "chapter") items.push(item);
      }
    }
  }

  const outroSec = plan.outroSec;
  if (outroSec > 0) {
    items.push(
      normalizeSpec(
        {
          id: "outro",
          kind: "outro",
          compositionId: isTemplateFor("outro", draft.outro?.template)
            ? draft.outro.template
            : defaultTemplate("outro"),
          title: (cfg.OUTRO_TITLE ?? "").trim() || draft.outro?.title || "关注我，下期见",
          label: DEFAULT_LABEL.outro,
          handle: (cfg.OUTRO_HANDLE ?? "").trim() || undefined,
          accent,
          durationSec: outroSec,
        },
        cfg,
        width,
        height,
        fps,
      ),
    );
  }

  const style = cleanCardText(draft.style, 24) || "AI 定制";
  ctx.log(`版式已生成：${items.length} 张卡 · 风格 ${style}`);
  for (const item of items) {
    const where = item.paragraph ? `第 ${item.paragraph} 段` : item.kind === "intro" ? "片头" : "片尾";
    ctx.log(`  ${where}：${item.title}（${item.durationSec}s · ${item.compositionId}）`);
  }

  return { items, style, signature: cardSignature(transcript, width, height) };
}

export async function rewriteCardTitle(
  ctx: TaskContext,
  transcript: Transcript,
  spec: CardSpec,
  used: string[],
): Promise<string | null> {
  const paragraph = spec.paragraph ? transcript.paragraphs[spec.paragraph - 1] : undefined;
  const context = paragraph
    ? `这一段主题：${paragraph.description || "无"}\n这一段首句：${paragraph.dialogues[0]?.contents[0] ?? ""}`
    : `视频标题：${transcript.title}`;

  const system = "你是短视频文案，只输出 JSON，不要解释。";
  const user = [
    context,
    `现在这张${spec.kind === "chapter" ? "章节卡" : spec.kind === "intro" ? "片头" : "片尾"}标题是：${spec.title}`,
    used.length > 0 ? `已经用过的标题（必须避开）：${used.join(" / ")}` : "",
    `换一个完全不同的写法，${
      spec.kind === "chapter" ? "4-10 字的章节名" : "不超过 10 字的钩子"
    }，不要照抄台词，不要标点。`,
    '只输出 {"title":"..."}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text = await chat(system, user, {
      json: true,
      temperature: 1,
      signal: ctx.signal,
      retries: 1,
    });
    const json = extractJsonObject(text);
    const title = cleanCardText(json ? (JSON.parse(json) as { title?: string }).title : "", MAX_CHAPTER);
    if (title && !used.includes(title)) {
      ctx.log(`换文案：${title}`);
      return title;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    ctx.log(`换文案失败：${error instanceof Error ? error.message : String(error)}`, "warn");
  }

  return null;
}

export function nextAccent(spec: CardSpec, cfg: AppConfig = loadConfig()): string {
  const palette = cardAccentPalette(cfg);
  const index = palette.indexOf(spec.accent);
  return palette[(index + 1) % palette.length] ?? palette[0] ?? "#ff5a3c";
}

export function normalizeCard(spec: CardSpec, cfg: AppConfig, width: number, height: number, fps: number): CardSpec {
  return normalizeSpec(spec, cfg, width, height, fps);
}

/** 文件名带指纹：改了参数就不会复用旧产物 */
export function cardFiles(workspace: string, spec: CardSpec): { video: string; still: string } {
  const dir = path.join(workspace, "cards");
  const base = `${spec.id}-${spec.fingerprint ?? "raw"}`;
  return { video: path.join(dir, `${base}.mp4`), still: path.join(dir, `${base}.png`) };
}

function chapterTotal(spec: CardSpec, total: number): number {
  return spec.kind === "chapter" ? Math.max(total, spec.paragraph ?? 1) : total;
}

export async function ensureCardVideo(ctx: TaskContext, spec: CardSpec, total: number): Promise<string | null> {
  const { video } = cardFiles(ctx.workspace, spec);
  if (fs.existsSync(video) && fs.statSync(video).size > 0) {
    spec.videoPath = video;
    return video;
  }

  ensureDir(path.dirname(video));
  const ok = await renderCard({
    compositionId: spec.compositionId,
    title: spec.title,
    label: spec.label,
    handle: spec.handle,
    accent: spec.accent,
    index: spec.paragraph ?? 1,
    total: chapterTotal(spec, total),
    width: ctx.options.width,
    height: ctx.options.height,
    fps: ctx.options.fps,
    durationSec: spec.durationSec,
    output: video,
    signal: ctx.signal,
  });

  if (!ok) {
    ctx.log(`「${spec.title}」卡片渲染失败：${lastRenderErrorMessage() || "未知原因"}`, "error");
    return null;
  }
  spec.videoPath = video;
  return video;
}

export async function ensureCardStill(ctx: TaskContext, spec: CardSpec, total: number): Promise<string | null> {
  const { still } = cardFiles(ctx.workspace, spec);
  if (fs.existsSync(still) && fs.statSync(still).size > 0) {
    spec.stillPath = still;
    return still;
  }

  ensureDir(path.dirname(still));
  const ok = await renderCardStill({
    compositionId: spec.compositionId,
    title: spec.title,
    label: spec.label,
    handle: spec.handle,
    accent: spec.accent,
    index: spec.paragraph ?? 1,
    total: chapterTotal(spec, total),
    width: ctx.options.width,
    height: ctx.options.height,
    fps: ctx.options.fps,
    durationSec: spec.durationSec,
    output: still,
    signal: ctx.signal,
  });

  if (!ok) {
    ctx.log(`卡片静帧渲染失败：${lastRenderErrorMessage() || "未知原因"}`, "warn");
    return null;
  }
  spec.stillPath = still;
  return still;
}
