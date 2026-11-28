import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bool, cardAccentPalette, loadConfig, numberOrZero, type AppConfig } from "../config.js";
import { CARD_TEMPLATES, defaultTemplate, isTemplateFor } from "../card-templates.js";
import { ensureDir } from "../paths.js";
import { chat, extractJsonObject } from "../services/llm.js";
import { lastRenderErrorMessage, renderCard, renderCardLayer, renderCardStill } from "../services/remotion.js";
import { runFfmpeg } from "../services/ffmpeg.js";
import { transcriptFingerprint } from "./tts.js";
import type {
  AudioManifest,
  CardBeat,
  CardKind,
  CardManifest,
  CardPrefs,
  CardSpec,
  MaterialManifest,
  TaskContext,
  Transcript,
} from "../types.js";
import { stageText, UNKNOWN_REASON } from "../errors.js";
import { logText } from "../logs.js";

const DEFAULT_LABEL: Record<CardKind, string> = {
  intro: "AI 摘要",
  chapter: "PART",
  outro: "下期见",
  quote: "观点",
  info: "详解",
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

/**
 * 对比卡右栏的对照色：从色板里挑一个冷暖倾向跟左栏相反的。
 * 左栏通常是暖色主色，右栏必须是冷色，否则左右看起来是同一种态度；
 * 但也不能硬编码蓝色 —— 用户可能把主色设成绿色。
 */
function contrastAccent(palette: string[], base: string): string {
  const hueOf = (hex: string): number | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1] as string, 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  };

  const baseHue = hueOf(base);
  // 灰色（无有效色相）就当作中性，优先找一个有彩色相的
  const others = palette.filter((color) => color.toLowerCase() !== base.toLowerCase());
  if (baseHue === null) return others[0] ?? base;

  const isCool = (h: number): boolean => h >= 170 && h <= 300;
  const wantCool = !isCool(baseHue);
  const match = others.find((color) => {
    const h = hueOf(color);
    if (h === null) return false;
    return wantCool ? isCool(h) : !isCool(h);
  });
  return match ?? others[0] ?? "#3b82f6";
}

/** 用户手动点过的配色；没选或不在色板里返回 null，交给 AI/配置决定 */
function manualAccent(prefs: CardPrefs | null | undefined, palette: string[]): string | null {
  const raw = (prefs?.accent ?? "").trim().toLowerCase();
  if (!raw) return null;
  return palette.find((color) => color.toLowerCase() === raw) ?? null;
}

/**
 * 清理卡片文案并限制长度。
 *
 * 直接按字数硬切会把句子拦腰砍断——实测出现过「贝森特 vs 鲁比奥：改口与」
 * 「还让万斯、卢特尼」这种半句话，卡片上读起来像是出了故障。
 *
 * 断点分强弱：
 *   强（。！？：；）本身就是一个语义单元，可以断得很早，留 25% 即可；
 *   弱（，、）只是句内停顿，断太早会丢信息，要求至少 45%。
 */
export function cleanCardText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";

  const chars = Array.from(text);
  if (chars.length <= max) return stripTailPunct(text);

  const cut = chars.slice(0, max);
  const strong = /[。.！!？?；;：:…—]/;
  const weak = /[，,、]/;

  // 先找强断点：允许断到上限的 25%
  for (let i = cut.length - 1; i >= Math.max(3, Math.floor(max * 0.25)); i--) {
    if (strong.test(cut[i] as string)) return stripTailPunct(cut.slice(0, i + 1).join(""));
  }
  // 再找弱断点：要求断到上限的 45%
  for (let i = cut.length - 1; i >= Math.max(4, Math.floor(max * 0.45)); i--) {
    if (weak.test(cut[i] as string)) return stripTailPunct(cut.slice(0, i + 1).join(""));
  }

  // 没有标点可断：按字数切，并补一个省略号提示下文还有。
  // 省略号本身占一个字，所以正文只切 max-1，否则结果会超出调用方给的上限。
  return `${stripTailPunct(cut.slice(0, Math.max(1, max - 1)).join(""))}…`;
}

function stripTailPunct(text: string): string {
  return text.replace(/[，,。.；;：:！!？?、…\-—]+$/g, "");
}

/** 只留字：去掉标点与空白，用于把「台词片段」对到具体某一句 */
function normalizeLine(text: string): string {
  return text.replace(/[\s，,。.！!？?；;：:、“”‘’"'（）()《》〈〉【】…—\-·~]/g, "");
}

/** 合成阶段拿到的分句时间，只用到文案与起点 */
export interface BeatSentence {
  text: string;
  start: number;
}

/**
 * 把台词片段对齐到分句，返回那一句的起始秒数。
 *
 * 片段对不上（模型改述了、或者写错字）就返回 null ——
 * 宁可这条要点不出现，也不能让它挂在错的时间上，那比静止更难看。
 */
export function resolveQuote(quote: string | undefined, sentences: BeatSentence[]): number | null {
  const needle = normalizeLine(quote ?? "");
  if (needle.length < 2) return null;
  for (const sentence of sentences) {
    if (normalizeLine(sentence.text).includes(needle)) return sentence.start;
  }
  return null;
}

/**
 * 把要点解析成「什么时候出现 + 写什么」，按时间排序。
 * 少于两条就整组丢掉：一条要点单独出现，等于把静态卡片延迟了一秒。
 */
export function resolveBeats(
  beats: CardBeat[] | undefined,
  sentences: BeatSentence[],
): { text: string; at: number }[] | undefined {
  if (!beats || beats.length === 0 || sentences.length === 0) return undefined;
  const out: { text: string; at: number }[] = [];
  for (const beat of beats) {
    const at = resolveQuote(beat.quote, sentences);
    if (at === null) continue;
    out.push({ text: beat.text, at: Math.round(at * 100) / 100 });
  }
  if (out.length < 2) return undefined;
  return out.sort((a, b) => a.at - b.at);
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
    /*
     * 卡片上的文案也必须进指纹。
     * 早先只有标题和时长，于是「重新生成这张卡、换个说法」会命中旧产物，
     * 表现是改了文案画面却一点没变。信息卡字段全部收进来。
     */
    JSON.stringify([
      spec.avatar ?? "",
      spec.role ?? "",
      spec.line ?? "",
      spec.compare ?? null,
      spec.timeline ?? null,
      spec.stat ?? null,
      spec.beats ?? null,
    ]),
  ].join("|");
  return createHash("md5").update(payload).digest("hex").slice(0, 12);
}

export function cardSignature(transcript: Transcript, width: number, height: number): string {
  return `${transcriptFingerprint(transcript)}|${width}x${height}`;
}

function normalizeSpec(spec: CardSpec, cfg: AppConfig, width: number, height: number, fps: number): CardSpec {
  const palette = cardAccentPalette(cfg);
  const normalized: CardSpec = {
    ...spec,
    title: cleanCardText(spec.title, spec.kind === "chapter" ? MAX_CHAPTER : MAX_TITLE),
    label: (spec.label ?? "").trim() || DEFAULT_LABEL[spec.kind],
    /*
     * 主色只在色板内挑。
     *
     * 右栏对照色不走这条：它是按主色算出来的冷/暖对照色，用户把主色设成冷色时
     * 算出来可能落在色板外。硬换回 palette[0] 会让左右两栏变成同一个颜色，
     * 对比卡就不再是对比了 —— 这里保留原值，只在格式明显非法时兜底。
     */
    accent: pickAccent(spec.accent, palette),
    ...(spec.rightAccent !== undefined
      ? { rightAccent: /^#[0-9a-f]{6}$/i.test(spec.rightAccent) ? spec.rightAccent : (palette[1] ?? "#3b82f6") }
      : {}),
  };
  normalized.fingerprint = cardFingerprint(normalized, width, height, fps);
  return normalized;
}

interface DraftCard {
  title?: string;
  template?: string;
}

/**
 * 立场文案上限。
 * 模型给的立场常在 20-30 字（「权力完全依附于川普，因此立刻改口」），
 * 截到 10 字会把语义拦腰砍断，卡片上反而看不出对立关系。
 * 卡片本身按栏宽折行，这里只防极端超长。
 */
const MAX_STANCE = 24;
const MAX_NOTE = 18;
/**
 * 对比卡标题要容得下「贝森特 vs 鲁比奥：改口与沉默」这种对照结构，
 * 14 字会断在「改口与」这种地方，等于把对照关系砍掉一半。
 */
const MAX_COMPARE_TITLE = 20;
/** 人物身份常带修饰语（「美国总统·幕后头号推手」），18 字不够 */
const MAX_ROLE = 22;
const MAX_COMPARE_NAME = 8;
const MAX_TIMELINE_NODES = 4;
const MAX_TIMELINE_TEXT = 16;
/** 数据卡最多画 4 根柱子，再多柱宽就挤成一条线；超出的合并成「其他」 */
const STAT_MAX_BARS = 4;
/** 一页卡最多三条要点：再多就不叫要点，等于把字幕搬到画面上 */
const MAX_BEATS = 3;
const MAX_BEAT_TEXT = 12;
/** 定位用的台词片段上限，够长才好对上，太长说明模型在复述整句 */
const MAX_QUOTE = 24;

/** 模型给的要点：text 是画面上那一行，quote 用来定位它在第几句被讲到 */
function parseBeats(draft: DraftInfoCard): CardBeat[] | undefined {
  const list = (draft.beats ?? [])
    .slice(0, MAX_BEATS)
    .map((beat) => ({
      text: cleanCardText(beat?.text, MAX_BEAT_TEXT),
      quote: (beat?.quote ?? "").trim().slice(0, MAX_QUOTE),
    }))
    // 片段太短会匹配到别的句子，宁缺勿错
    .filter((beat) => beat.text && normalizeLine(beat.quote).length >= 3);
  return list.length >= 2 ? list : undefined;
}

function sideQuote(value: string | undefined): string | undefined {
  const quote = (value ?? "").trim().slice(0, MAX_QUOTE);
  return normalizeLine(quote).length >= 3 ? quote : undefined;
}

/**
 * 头像位上的字：只接受 1 个汉字。
 *
 * 为什么这么严：模型很容易把「川普」的首字「川」当头像，
 * 但音译名没有姓氏，这等于在卡片上写出一个错的身份。
 * 除了长度，还要求是 CJK 汉字 —— 拒绝「A」「1」「？」这类占位符。
 */
export function avatarChar(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const chars = Array.from(text);
  if (chars.length !== 1) return "";
  return /[\u4e00-\u9fa5]/.test(chars[0] as string) ? (chars[0] as string) : "";
}

/**
 * 变体映射到基类：字段校验按基类走，只有 compositionId 保留变体 id。
 * 新增变体只需在这里加一行，不用动校验分支。
 */
const VARIANT_BASE: Record<string, string> = {
  PersonCardHero: "PersonCard",
  PersonCardCompact: "PersonCard",
  CompareCardStacked: "CompareCard",
  StatCardSplit: "StatCard",
};

/** 变体 id → 组件认的 variant 名（基类没有 variant，走组件默认值） */
const VARIANT_NAME: Record<string, string> = {
  PersonCardHero: "hero",
  PersonCardCompact: "compact",
  CompareCardStacked: "stacked",
  StatCardSplit: "split",
};

/**
 * 把模型给的信息卡草稿转成 CardSpec。
 *
 * 模型输出一律按不可信处理：模板不在 info 白名单、必备字段缺失或超长，
 * 这张卡就整张丢掉，不猜、不补齐 —— 半张信息卡比没有更糟。
 */
export function draftInfoToSpec(
  draft: DraftInfoCard,
  accent: string,
  durationSec: number,
  paragraph: number,
  /** 色板：对比卡右栏要从里面取一个冷色，跟左栏形成对照 */
  palette: string[] = [],
): CardSpec | null {
  const template = typeof draft.template === "string" ? draft.template : "";
  if (!isTemplateFor("info", template)) return null;

  /*
   * 变体只是同一套字段换排版，字段校验完全共用。
   * 这里把 「PersonCardHero」还原成基类 「PersonCard」 再走后面的分支，
   * 不用为每个变体复制一遍校验逻辑 —— 复制出来的两份迟早会不一致。
   */
  const baseTemplate = VARIANT_BASE[template] ?? template;

  const base = {
    id: `info-${paragraph}-${template}`,
    kind: "info" as const,
    compositionId: template,
    paragraph,
    title: cleanCardText(draft.title, MAX_TITLE) || "",
    label: DEFAULT_LABEL.info,
    accent,
    durationSec,
  };

  if (baseTemplate === "PersonCard") {
    const name = cleanCardText(draft.title, MAX_COMPARE_NAME);
    if (!name) return null;
    const role = cleanCardText(draft.role, MAX_ROLE);
    // 判断句要能讲完整：截到 14 字会把「…是幕后推手」砍成「…是幕后」。
    // 卡片按栏宽折行，这里只防极端超长。
    const line = cleanCardText(draft.line, MAX_STANCE);
    if (!role && !line) return null;
    // 头像字：只接受单个汉字，其余一律留空（音译名本来就不该有字）
    const avatar = avatarChar(draft.avatar);
    // 有要点就逐条上屏代替整句判断；没有就退回静态的一句
    return {
      ...base,
      title: name,
      avatar: avatar || undefined,
      role: role || undefined,
      line: line || undefined,
      beats: parseBeats(draft),
    };
  }

  if (baseTemplate === "CompareCard") {
    const leftName = cleanCardText(draft.left?.name, MAX_COMPARE_NAME);
    const leftStance = cleanCardText(draft.left?.stance, MAX_STANCE);
    const rightName = cleanCardText(draft.right?.name, MAX_COMPARE_NAME);
    const rightStance = cleanCardText(draft.right?.stance, MAX_STANCE);
    // 对比卡必须两边都成对，缺一边就不是对比
    if (!leftName || !leftStance || !rightName || !rightStance) return null;

    /*
     * 标题不能复述左右栏的人名。
     * 模型爱写「贝森特 vs 鲁比奥」当标题，而下面两栏已经各有一个同样的名字，
     * 卡片上就出现三次，看着像排版出了错。重复时直接换成概括性的说法。
     */
    const rawTitle = cleanCardText(draft.title, MAX_COMPARE_TITLE);
    const repeats = rawTitle.includes(leftName) || rawTitle.includes(rightName);
    const title = !rawTitle || repeats ? "两种反应" : rawTitle;

    return {
      ...base,
      title,
      // 右栏取与左栏相反的冷暖色，左右才是两种态度
      rightAccent: contrastAccent(palette.length > 0 ? palette : [accent], accent),
      compare: {
        left: {
          name: leftName,
          stance: leftStance,
          note: cleanCardText(draft.left?.note, MAX_NOTE) || undefined,
          quote: sideQuote(draft.left?.quote),
        },
        right: {
          name: rightName,
          stance: rightStance,
          note: cleanCardText(draft.right?.note, MAX_NOTE) || undefined,
          quote: sideQuote(draft.right?.quote),
        },
      },
    };
  }

  if (baseTemplate === "TimelineCard") {
    const nodes = (draft.timeline ?? [])
      .slice(0, MAX_TIMELINE_NODES)
      .map((node) => ({
        time: cleanCardText(node?.time, 8),
        text: cleanCardText(node?.text, MAX_TIMELINE_TEXT),
      }))
      .filter((node) => node.time && node.text);
    // 少于两个节点就构不成「先后」，退回实拍更有意义
    if (nodes.length < 2) return null;
    return { ...base, timeline: nodes };
  }

  if (baseTemplate === "StatCard") {
    const value = cleanCardText(draft.stat?.value, 10);
    if (!value) return null;

    const cleaned = (draft.stat?.bars ?? [])
      .map((bar) => {
        const n = Number(bar?.value);
        return {
          label: cleanCardText(bar?.label, MAX_NOTE),
          value: Number.isFinite(n) ? n : 0,
          hint: cleanCardText(bar?.hint, 10) || undefined,
        };
      })
      .filter((bar) => bar.label && bar.value > 0);

    /*
     * 最多画 STAT_MAX_BARS 根柱子。超出的不是直接丢掉 —— 那样旁白念了 6 个数、
     * 画面只有 4 根，剩下两项既没画出来也没交代去哪了，数据卡的可信度就没了。
     *
     * 留前 3 根明细，第 4 根放合并后的「其他」：尾部各项之和。
     * 不把第 4 根本身也算进「其他」，否则那根真实数据会莫名消失。
     */
    const detailCount = STAT_MAX_BARS - 1;
    const kept = cleaned.slice(0, detailCount);
    const rest = cleaned.slice(detailCount);
    if (rest.length > 0) {
      const sum = rest.reduce((acc, bar) => acc + bar.value, 0);
      kept.push({
        label: rest.length === 1 ? (rest[0]?.label ?? "其他") : "其他",
        value: sum,
        hint: rest.length === 1 ? rest[0]?.hint : `${rest.length} 项合计`,
      });
    }

    return {
      ...base,
      title: cleanCardText(draft.title, MAX_TITLE) || value,
      stat: {
        value,
        caption: cleanCardText(draft.stat?.caption, MAX_NOTE) || undefined,
        note: cleanCardText(draft.stat?.note, MAX_TITLE) || undefined,
        bars: kept.length > 0 ? kept : undefined,
      },
      beats: parseBeats(draft),
    };
  }

  return null;
}

interface DraftChapters {
  style?: string;
  intro?: DraftCard;
  chapters?: { paragraph?: number; title?: string; template?: string }[];
  outro?: DraftCard;
  /** 信息卡：模型自己判断哪段配哪张 */
  infoCards?: DraftInfoCard[];
}

/** 模型给出的信息卡草稿，字段全是 unknown，落库前统一校验 */
export interface DraftInfoCard {
  paragraph?: number;
  template?: string;
  title?: string;
  /** PersonCard：头像位上的 1 个汉字，音译名留空 */
  avatar?: string;
  role?: string;
  line?: string;
  left?: { name?: string; stance?: string; note?: string; quote?: string };
  right?: { name?: string; stance?: string; note?: string; quote?: string };
  timeline?: { time?: string; text?: string }[];
  /** 逐条上屏的要点：text 上屏，quote 定位它在第几句被讲到 */
  beats?: { text?: string; quote?: string }[];
  stat?: {
    value?: string;
    caption?: string;
    note?: string;
    bars?: { label?: string; value?: number; hint?: string }[];
  };
}

function templateList(kind: CardKind): string {
  return CARD_TEMPLATES[kind].map((template) => `${template.id}（${template.name}：${template.hint}）`).join(" / ");
}

/**
 * 取一段的台词正文。
 *
 * transcript 有两套结构：内存里的 Dialogue 用 contents: string[]，
 * 而 _transcript.json 落盘时是 content: string。写盘格式与类型不一致是既有问题，
 * 这里两种都兼容 —— 否则提示词里的「内容」整段为空，模型只能靠段落描述瞎猜。
 */
function dialogueText(dialogue: { contents?: string[]; content?: string }): string {
  if (Array.isArray(dialogue.contents)) return dialogue.contents.join("");
  return typeof dialogue.content === "string" ? dialogue.content : "";
}

function buildPrompt(transcript: Transcript, chapterLimit: number): string {
  const lines = transcript.paragraphs.map((paragraph, index) => {
    const first = dialogueText(paragraph.dialogues[0] ?? {});
    return `第 ${index + 1} 段 · 主题：${paragraph.description || "无"} · 首句：${first}`;
  });

  const base = [
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
  ];

  const shape: Record<string, unknown> = {
    style: "一句话风格说明",
    intro: { title: "...", template: "TitleCard" },
    chapters: [{ paragraph: 2, title: "...", template: "ChapterCard" }],
    outro: { title: "...", template: "OutroCard" },
  };

  base.push("只输出 JSON，不要解释：", JSON.stringify(shape));
  return base.join("\n");
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
    ctx.log(
      logText("accentFromFrame", {
        accent: hit,
        note: raw?.reason
          ? { zh: `（${cleanCardText(raw.reason, 12)}）`, en: ` (${cleanCardText(raw.reason, 12)})` }
          : "",
      }),
    );
    return hit;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    ctx.log(logText("accentVisionFailed", { reason: error instanceof Error ? error.message : String(error) }), "warn");
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
    ctx.log(logText("noCardTypes"), "warn");
    return fallback;
  }

  ctx.markStage("cards", "running", stageText("designingCards"));
  if (plan.auto) {
    ctx.log(logText("cardTypesHint"));
  }
  ctx.log(logText("aiDrafting"));

  // 手动点过配色就用它，否则交给视觉模型，再不行用色板第一个
  const manual = manualAccent(prefs, palette);
  if (manual) ctx.log(logText("accentManual", { accent: manual }));
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
    ctx.log(logText("aiDraftFailed", { reason: error instanceof Error ? error.message : String(error) }), "warn");
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

  // 信息卡不在这里生成：它和实拍一样是「素材」，由用户在素材页逐段指定，
  // 结果挂在 material.items[].infoCard 上。版式阶段只管片头/章节/片尾。

  const style = cleanCardText(draft.style, 24) || "AI 定制";
  ctx.log(logText("cardsGenerated", { n: items.length, style }));
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
      ctx.log(logText("rewriteTitle", { title }));
      return title;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    ctx.log(logText("rewriteFailed", { reason: error instanceof Error ? error.message : String(error) }), "warn");
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

/** 信息卡专属字段的渲染参数，视频与静帧共用 */
interface InfoCardProps {
  avatar?: string;
  role?: string;
  line?: string;
  rightAccent?: string;
  compare?: unknown;
  timeline?: unknown;
  stat?: unknown;
  bgImage?: string;
  /** 排版变体；从 compositionId 推导，组件只认 variant */
  variant?: string;
}

/**
 * 把 CardSpec 上的信息卡专属字段摊平成渲染参数。
 * 视频与静帧共用这一份，避免两处各自扩展导致字段漂移。
 */
function infoCardProps(spec: CardSpec): InfoCardProps {
  const out: InfoCardProps = {};
  // compositionId 是白名单里的变体 id，组件需要的是 variant 名
  const variant = VARIANT_NAME[spec.compositionId];
  if (variant) out.variant = variant;
  if (spec.avatar !== undefined) out.avatar = spec.avatar;
  if (spec.role !== undefined) out.role = spec.role;
  if (spec.line !== undefined) out.line = spec.line;
  if (spec.rightAccent !== undefined) out.rightAccent = spec.rightAccent;
  if (spec.compare !== undefined) out.compare = spec.compare;
  if (spec.timeline !== undefined) out.timeline = spec.timeline;
  if (spec.stat !== undefined) out.stat = spec.stat;
  if (spec.bgImage !== undefined) out.bgImage = spec.bgImage;
  return out;
}

/** 对比卡两栏各自的出现时刻；只对上一栏时另一栏错开 0.4 秒，别同时砸出来 */
export function compareTimes(
  compare: CardSpec["compare"],
  sentences: BeatSentence[],
): { left: number; right: number } | undefined {
  if (!compare || sentences.length === 0) return undefined;
  const left = resolveQuote(compare.left.quote, sentences);
  const right = resolveQuote(compare.right.quote, sentences);
  if (left === null && right === null) return undefined;

  /*
   * 左栏必须不晚于右栏：模型经常把两栏的 quote 写反，照搬会让右栏先出现，
   * 卡片讲的是「A 却 B」，视觉上却先亮 B，读起来是反的。两栏都对齐上时取小的当左。
   */
  const both = left !== null && right !== null;
  const leftAt = both ? Math.min(left, right) : (left ?? Math.max(0, (right ?? 0) - 0.4));
  const rightAt = both ? Math.max(left, right) : (right ?? leftAt + 0.4);
  return { left: Math.round(leftAt * 100) / 100, right: Math.round(rightAt * 100) / 100 };
}

/**
 * 时间点也要进指纹：同一句话的配音时长变了，
 * 要点出现的秒数就变了，产物必须重渲。
 */
function timingSuffix(beats: { text: string; at: number }[] | undefined, compareAt: unknown): string {
  if (!beats && !compareAt) return "";
  const hash = createHash("md5")
    .update(JSON.stringify([beats ?? null, compareAt ?? null]))
    .digest("hex")
    .slice(0, 8);
  return `-t${hash}`;
}

/**
 * 渲染一张卡并缓存。
 *
 * durationSec 覆盖 spec 里的时长：信息卡要撑满整段旁白，而版式阶段拿不到段落时长，
 * 只能由合成阶段传进来。否则 3 秒的卡会在 27 秒的段落里循环重播，观众只看得到入场动画。
 */
export async function ensureCardVideo(
  ctx: TaskContext,
  spec: CardSpec,
  total: number,
  durationSec?: number,
  sentences?: BeatSentence[],
): Promise<string | null> {
  const finalSec = durationSec && durationSec > 0 ? durationSec : spec.durationSec;
  const beats = resolveBeats(spec.beats, sentences ?? []);
  const compareAt = compareTimes(spec.compare, sentences ?? []);
  // 时长变了产物就不一样：把它并进指纹，避免命中旧的短卡
  const renderSpec: CardSpec = {
    ...spec,
    durationSec: finalSec,
    fingerprint: durationSec
      ? `${spec.fingerprint ?? "raw"}-d${Math.round(finalSec * 10)}${timingSuffix(beats, compareAt)}`
      : spec.fingerprint,
  };
  const { video } = cardFiles(ctx.workspace, renderSpec);
  if (fs.existsSync(video) && fs.statSync(video).size > 0) {
    spec.videoPath = video;
    return video;
  }

  ensureDir(path.dirname(video));
  const ok = await renderCard({
    compositionId: renderSpec.compositionId,
    title: renderSpec.title,
    label: renderSpec.label,
    handle: renderSpec.handle,
    accent: spec.accent,
    index: spec.paragraph ?? 1,
    total: chapterTotal(spec, total),
    ...infoCardProps(spec),
    beats,
    compareAt,
    width: ctx.options.width,
    height: ctx.options.height,
    fps: ctx.options.fps,
    durationSec: finalSec,
    output: video,
    signal: ctx.signal,
  });

  if (!ok) {
    ctx.log(
      logText("cardRenderFailed", { title: spec.title, reason: lastRenderErrorMessage() || UNKNOWN_REASON }),
      "error",
    );
    return null;
  }
  spec.videoPath = video;
  return video;
}

/**
 * 静帧渲染排队。
 *
 * 素材页一进来就会同时请求 6 张卡，每张都要拉起一个 headless Chrome。
 * 实测并发时互相抢 CPU，单张从 6 秒涨到远超前端耐心；串行后每张稳定在 6 秒左右。
 * 排的是这个进程内的所有静帧任务，不只是同一张卡。
 */
let stillChain: Promise<unknown> = Promise.resolve();

export function ensureCardStill(ctx: TaskContext, spec: CardSpec, total: number): Promise<string | null> {
  const job = stillChain.then(() => renderCardStillNow(ctx, spec, total));
  // 前一张失败不能卡住后面所有卡，所以吞掉链上的异常，只把异常留给 job 本身
  stillChain = job.catch(() => undefined);
  return job;
}

async function renderCardStillNow(ctx: TaskContext, spec: CardSpec, total: number): Promise<string | null> {
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
    ...infoCardProps(spec),
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
    ctx.log(logText("stillRenderFailed", { reason: lastRenderErrorMessage() || UNKNOWN_REASON }), "warn");
    return null;
  }
  spec.stillPath = still;
  return still;
}

/**
 * 为单段生成信息卡：AI 读这一段台词，判断该用哪种卡并填好字段。
 *
 * 与版式阶段的区别：版式阶段一次读全篇、决定「哪几段配卡」；
 * 这里是用户在素材页针对某一段点「换成信息卡」时才调用，
 * 只关心这一段怎么讲得最清楚，不受其它段落影响。
 */
export async function generateInfoCardForParagraph(
  ctx: TaskContext,
  paragraph: number,
  total: number,
  durationSec: number,
  accent: string,
  /** 指定模板时跳过模型判断，直接按该模板生成 */
  forceTemplate?: string,
  /**
   * 一键配置时已用过的主题（人名/对立标题）。
   * 逐段独立判断会让相邻段落抽到同一个主角（第 1 段和第 6 段都出「黄仁勋」），
   * 把这些传进去让模型避开，相邻重复比缺一张卡更难看。
   */
  usedTopics?: string[],
): Promise<CardSpec | null> {
  // 从工作区读剧本：TaskContext 不带 state，这条路径由素材页按需调用
  let para: { description?: string; dialogues: { contents?: string[]; content?: string }[] } | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ctx.workspace, "_transcript.json"), "utf-8")) as Transcript;
    para = raw.paragraphs[paragraph - 1];
  } catch {
    return null;
  }
  if (!para) return null;

  const body = para.dialogues.map(dialogueText).filter(Boolean).join(" ");
  const cfg = loadConfig();

  // 指定模板时把它固定下来，其余交给模型判断
  const fixed = forceTemplate && isTemplateFor("info", forceTemplate) ? forceTemplate : undefined;
  const spec = await askInfoCard(
    ctx,
    paragraph,
    para.description ?? "",
    body,
    fixed,
    accent,
    durationSec,
    cardAccentPalette(cfg),
    usedTopics,
  );

  if (!spec) {
    ctx.log(logText("notFitCard", { n: paragraph }), "warn");
    return null;
  }

  // 一键配置时，同一主题已经出现在别的段落就别再出一张 —— 两张同名卡比没有更难看
  if (usedTopics && usedTopics.length > 0 && usedTopics.includes(spec.title)) {
    ctx.log(logText("titleUsed", { n: paragraph, title: spec.title }), "warn");
    return null;
  }

  return normalizeSpec(spec, cfg, ctx.options.width, ctx.options.height, ctx.options.fps);
}

/** 让模型为一段内容挑卡并填字段，失败返回 null */
async function askInfoCard(
  ctx: TaskContext,
  paragraph: number,
  description: string,
  body: string,
  fixedTemplate: string | undefined,
  accent: string,
  durationSec: number,
  palette: string[],
  /** 别的段落已经用过的主题，提示模型避开 */
  usedTopics?: string[],
): Promise<CardSpec | null> {
  const prompt = [
    `这一段的内容：${description || body}`,
    `台词：${body}`,
    "",
    "把它做成一页短视频信息卡。从下面选一种最合适的（只能选一种）：",
    "   PersonCard        讲一个人物的立场或行动 → title 必须是具体人名，role 是身份，line 是一句判断，不要再给卡片加标题",
    "   PersonCardHero    同 PersonCard，但全屏大字。适合开篇人物、或整段都在讲这一个人",
    "   PersonCardCompact 同 PersonCard，但只占右下角。适合人物只是配角、画面重点是素材本身",
    "   CompareCard       两个人物或观点对立 → left / right 各含 name 与 stance（不超过 20 字），可选 note；title 是概括这场对立的短语，不要重复左右两人的人名",
    "   CompareCardStacked 同 CompareCard，但上下叠放。立场说法较长、左右分栏放不下时用它",
    "   TimelineCard      事件的先后顺序 → timeline 需要 2-4 个节点，各含 time 与 text",
    `   StatCard          有具体数字或占比 → stat 含 value 与 note，可选 caption 与 bars（bars 最多 ${STAT_MAX_BARS} 根，各含 label 与 value，并给 hint 写明单位如「32%」「7 盎司」；实际项数超过 ${STAT_MAX_BARS} 时，把最小的几项合并成一根「其他」，不要直接丢掉）`,
    "   StatCardSplit     同 StatCard，但数字与柱状左右并排。柱子较多时用它",
    fixedTemplate ? `本次固定用 ${fixedTemplate}。` : "",
    usedTopics && usedTopics.length > 0
      ? `注意：别的段落已经用过这些主题：${usedTopics.join("、")}。不要再做介绍同一个人/同一对立面的卡，换这一段里别的角度；实在没有别的角度就输出空对象 {}。`
      : "",
    "",
    "另外给 avatar：人名旁边那个方块头像里放的字，**只放 1 个汉字**。规则很重要：",
    "   - 中文姓名（如「黄仁勋」「张一鸣」）→ 给姓氏，如「黄」「张」",
    "   - 音译名（如「川普」「马斯克」「贝森特」「鲁比奥」）→ **必须留空**，它们没有姓氏，放首字等于写错人",
    "   - 拿不准就留空，留空会显示成抽象人形标记，不会出错",
    "",
    "另外给 beats：这页卡上要「跟着旁白一条条出现」的要点，2-3 条。",
    "   text  上屏的那一行，不超过 12 字，要具体（人名、动作、数字），不要复述整句字幕",
    "   quote 从台词里原样摘 4-20 个字，用来定位这条要点是在第几句被讲到的（必须能在台词里一字不差找到）",
    "CompareCard 的两栏各给一个 quote（同样规则），表示旁白讲到这一栏的位置；没有就留空。",
    "如果这段内容不适合做信息卡（只是过渡、或没有明确信息点），输出空对象 {}。",
    "只输出 JSON：",
    '{"template":"PersonCard","title":"川普","avatar":"","role":"美国总统","line":"亲自出马逐个说服董事",',
    ' "beats":[{"text":"亲自出马","quote":"总统亲自下场"},{"text":"股价也在亏","quote":"手里的股票也在跟着亏钱"}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const text = await chat("你是短视频视觉编辑，只输出 JSON。", prompt, {
    json: true,
    temperature: 0.6,
    signal: ctx.signal,
  });
  const json = extractJsonObject(text);
  if (!json) return null;

  const parsed = JSON.parse(json) as DraftInfoCard;
  if (!parsed || typeof parsed !== "object" || !parsed.template) return null;
  if (fixedTemplate) parsed.template = fixedTemplate;

  return draftInfoToSpec(parsed, accent, durationSec, paragraph, palette);
}

/**
 * 抽一帧素材当信息层的底图，转成 data URI。
 *
 * 为什么不直接用 <Img src={file://...}>：Remotion 的 bundle 配置了 publicDir: null，
 * 本地绝对路径在渲染进程里读不到。而 1080×1920 的 JPEG 约 140KB，
 * Base64 后 190KB 左右，塞进 props.json 完全在可接受范围内。
 */
export async function materialFrameDataUri(
  videoPath: string,
  width: number,
  height: number,
  atSec = 2,
): Promise<string | null> {
  const out = path.join(
    path.dirname(videoPath),
    `.frame-${createHash("sha1").update(videoPath).digest("hex").slice(0, 8)}.jpg`,
  );
  try {
    await runFfmpeg([
      "-y",
      "-ss",
      String(Math.max(0, atSec)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      // 与成片同构图：先按比例放大再居中裁切，避免拉伸
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-q:v",
      "4",
      out,
    ]);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(out).toString("base64")}`;
  } catch {
    return null;
  } finally {
    fs.rmSync(out, { force: true });
  }
}

/**
 * 渲染信息卡的透明层（VP9 alpha），叠在素材上。
 *
 * 与 ensureCardVideo 的区别：产出是 webm 透明层，不是整段画面。
 * 素材由 renderParagraph 照常渲染（保留运镜），这里只出信息部分。
 */
export async function ensureCardLayer(
  ctx: TaskContext,
  spec: CardSpec,
  total: number,
  durationSec?: number,
  sentences?: BeatSentence[],
): Promise<string | null> {
  const finalSec = durationSec && durationSec > 0 ? durationSec : spec.durationSec;
  const beats = resolveBeats(spec.beats, sentences ?? []);
  const compareAt = compareTimes(spec.compare, sentences ?? []);
  /*
   * 时长进指纹：换段落时长就要重渲图层。
   * Lv2 是图层缓存版本：v1 的图层里误画了静帧底图（整框不透明，把素材盖成死图），
   * 不升版本就会一直命中那批坏图层。
   */
  const layerSpec: CardSpec = {
    ...spec,
    durationSec: finalSec,
    fingerprint: `${spec.fingerprint ?? "raw"}-Lv2-${Math.round(finalSec * 10)}${timingSuffix(beats, compareAt)}`,
  };
  const dir = path.join(ctx.workspace, "cards");
  const file = path.join(dir, `${layerSpec.id}-${layerSpec.fingerprint}.webm`);

  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;

  ensureDir(dir);
  const ok = await renderCardLayer({
    compositionId: layerSpec.compositionId,
    title: layerSpec.title,
    label: layerSpec.label,
    handle: layerSpec.handle,
    accent: layerSpec.accent,
    index: layerSpec.paragraph ?? 1,
    total: chapterTotal(layerSpec, total),
    ...infoCardProps(layerSpec),
    beats,
    compareAt,
    width: ctx.options.width,
    height: ctx.options.height,
    fps: ctx.options.fps,
    durationSec: finalSec,
    output: file,
    signal: ctx.signal,
  });

  if (!ok) {
    ctx.log(
      logText("infoLayerRenderFailed", {
        title: layerSpec.title,
        reason: lastRenderErrorMessage() || UNKNOWN_REASON,
      }),
      "warn",
    );
    return null;
  }
  return file;
}
