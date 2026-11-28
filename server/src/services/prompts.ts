import fs from "node:fs";
import path from "node:path";
import { speakerNames, type SpeakerNames } from "../config.js";
import { pick, type Bilingual, type Lang } from "../i18n.js";
import { ensureDir, promptsDir, userPromptsDir } from "../paths.js";

export interface PromptPair {
  writer: string;
  rewriter: string;
}

/** 运行时替换的角色名占位符 */
const SPEAKER_MAIN_TOKEN = "{{SPEAKER_MAIN}}";
const SPEAKER_GUEST_TOKEN = "{{SPEAKER_GUEST}}";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: string;
}

/** 带上文件时间戳，用户在外面改文本也能立刻生效 */
const cache = new Map<string, CacheEntry>();

export function clearPromptCache(): void {
  cache.clear();
}

function builtinPath(file: string): string {
  return path.join(promptsDir(), file);
}

function userPath(file: string): string {
  return path.join(userPromptsDir(), file);
}

/** 按 mtime + size 判断要不要重读 */
function readJsonFile(full: string): Record<string, unknown> {
  if (!fs.existsSync(full)) throw new Error(`缺少 prompt 文件：${full}`);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new Error(`无法读取 prompt 文件：${full}`);
  }

  const cached = cache.get(full);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return JSON.parse(cached.value) as Record<string, unknown>;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(full, "utf-8");
  } catch {
    throw new Error(`无法读取 prompt 文件：${full}`);
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  cache.set(full, { mtimeMs: stat.mtimeMs, size: stat.size, value: raw });
  return data;
}

function pickFrom(full: string, key: string): string | null {
  if (!fs.existsSync(full)) return null;
  const data = readJsonFile(full);
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * 按层级取值：覆盖层缺这个键就用内置的，
 * 这样删掉覆盖层里的单个键不会让整个文件失效
 */
function readPrompt(file: string, key: string): string {
  const value = pickFrom(userPath(file), key) ?? pickFrom(builtinPath(file), key);
  if (!value) throw new Error(`${builtinPath(file)} 缺少 ${key}`);
  return value;
}

function applySpeakers(template: string, speakers: SpeakerNames): string {
  return template.split(SPEAKER_MAIN_TOKEN).join(speakers.main).split(SPEAKER_GUEST_TOKEN).join(speakers.guest);
}

/** 读取 <风格>.json，填充角色名占位符 */
export function loadPrompts(source: string, speakers?: SpeakerNames): PromptPair {
  const names = speakers ?? speakerNames();
  return {
    writer: applySpeakers(readPrompt(`${source}.json`, "prompt_writer"), names),
    rewriter: applySpeakers(readPrompt(`${source}.json`, "prompt_rewriter"), names),
  };
}

export interface CriticPrompts {
  critic: string;
  repair: string;
}

/** 审稿与按意见修复，风格无关 */
export function loadCriticPrompts(): CriticPrompts {
  return {
    critic: readPrompt("critic.json", "prompt_critic"),
    repair: readPrompt("critic.json", "prompt_repair"),
  };
}

export function loadSearchTermsPrompt(): string {
  return readPrompt("material.json", "prompt_search_terms");
}

export function loadVideoSelectPrompt(): string {
  return readPrompt("video_select.json", "prompt_video_select");
}

export function loadVisionSelectPrompt(): string {
  return readPrompt("vision_select.json", "prompt_vision_select");
}

export interface PromptField {
  key: string;
  label: string;
  hint: string;
}

export interface PromptDoc {
  file: string;
  title: string;
  description: string;
  fields: PromptField[];
}

/** 内部定义：文案保留双语，出站前再按语言取 */
interface DocText {
  file: string;
  title: Bilingual;
  description: Bilingual;
  fields: { key: string; label: Bilingual; hint: Bilingual }[];
}

/** 可编辑的提示词文档，顺序即展示顺序 */
const DOC_TEXTS: DocText[] = [
  {
    file: "podcast.json",
    title: { zh: "播客", en: "Podcast" },
    description: {
      zh: "两人对谈。改这里会影响下一次写稿，已生成的任务不受影响。",
      en: "Two-host chat. Edits apply to the next script; finished tasks keep their version.",
    },
    fields: [
      {
        key: "prompt_writer",
        label: { zh: "写稿", en: "Draft" },
        hint: { zh: "决定结构、段数与语气", en: "Sets structure, paragraph count and tone" },
      },
      {
        key: "prompt_rewriter",
        label: { zh: "润色", en: "Polish" },
        hint: { zh: "压字数、改口语，容易磨平人味", en: "Trims length and colloquializes; can flatten personality" },
      },
    ],
  },
  {
    file: "crosstalk.json",
    title: { zh: "相声", en: "Crosstalk" },
    description: { zh: "捧逗互动，包袱节奏快。", en: "Straight man and comic, fast-paced punchlines." },
    fields: [
      {
        key: "prompt_writer",
        label: { zh: "写稿", en: "Draft" },
        hint: { zh: "决定结构与包袱密度", en: "Sets structure and punchline density" },
      },
      {
        key: "prompt_rewriter",
        label: { zh: "润色", en: "Polish" },
        hint: { zh: "压字数、改口语", en: "Trims length, colloquializes" },
      },
    ],
  },
  {
    file: "talkshow.json",
    title: { zh: "脱口秀", en: "Stand-up" },
    description: { zh: "单人吐槽，口语化强。", en: "Solo rant, highly colloquial." },
    fields: [
      {
        key: "prompt_writer",
        label: { zh: "写稿", en: "Draft" },
        hint: { zh: "决定结构与吐槽方式", en: "Sets structure and comedic angle" },
      },
      {
        key: "prompt_rewriter",
        label: { zh: "润色", en: "Polish" },
        hint: { zh: "压字数、改口语", en: "Trims length, colloquializes" },
      },
    ],
  },
  {
    file: "critic.json",
    title: { zh: "审稿与返修", en: "Review and repair" },
    description: {
      zh: "所有风格共用。分数低于阈值会触发返修，返修提示词写得太严会把稿子改回工整。",
      en: "Shared by all styles. Scores below the threshold trigger repair; an over-strict repair prompt makes scripts stilted again.",
    },
    fields: [
      {
        key: "prompt_critic",
        label: { zh: "审稿", en: "Review" },
        hint: { zh: "打分维度与阈值说明", en: "Scoring dimensions and thresholds" },
      },
      {
        key: "prompt_repair",
        label: { zh: "按意见返修", en: "Apply feedback" },
        hint: { zh: "拿到意见后如何改稿", en: "How to revise given the feedback" },
      },
    ],
  },
  {
    file: "material.json",
    title: { zh: "素材检索词", en: "Footage search terms" },
    description: {
      zh: "把每段台词转成外网检索用的英文关键词。",
      en: "Turns each line into English keywords for stock footage search.",
    },
    fields: [
      {
        key: "prompt_search_terms",
        label: { zh: "检索词", en: "Search terms" },
        hint: { zh: "每段 3~5 个词", en: "3-5 terms per paragraph" },
      },
    ],
  },
  {
    file: "video_select.json",
    title: { zh: "素材选片", en: "Clip selection" },
    description: {
      zh: "看完候选素材后，挑出与台词最搭的一条。",
      en: "Picks the clip that best matches each line.",
    },
    fields: [
      {
        key: "prompt_video_select",
        label: { zh: "选片", en: "Select" },
        hint: { zh: "按标签与画面挑片", en: "Choose by tags and visuals" },
      },
    ],
  },
  {
    file: "vision_select.json",
    title: { zh: "视觉选片", en: "Visual selection" },
    description: {
      zh: "看缩略图挑片，比纯文本选片更准，也更容易挑到不相关画面。",
      en: "Picks from thumbnails: more accurate than text-only, but can also favor irrelevant frames.",
    },
    fields: [
      {
        key: "prompt_vision_select",
        label: { zh: "视觉选片", en: "Visual select" },
        hint: { zh: "看画面判断是否贴合台词", en: "Judge whether the frame fits the line" },
      },
    ],
  },
];

/** 按语言展开文档文案 */
export function promptDocs(lang: Lang = "zh"): PromptDoc[] {
  return DOC_TEXTS.map((doc) => ({
    file: doc.file,
    title: pick(lang, doc.title),
    description: pick(lang, doc.description),
    fields: doc.fields.map((field) => ({
      key: field.key,
      label: pick(lang, field.label),
      hint: pick(lang, field.hint),
    })),
  }));
}

/** 中文文档，供内部校验与报错使用 */
export const PROMPT_DOCS: PromptDoc[] = promptDocs("zh");

export function findPromptDoc(file: string): PromptDoc | undefined {
  return PROMPT_DOCS.find((doc) => doc.file === file);
}

/** 只允许 PROMPT_DOCS 里的文件与键，避免任意路径写入 */
export function assertPromptTarget(file: string, key: string): PromptDoc {
  const doc = findPromptDoc(file);
  if (!doc) throw new Error(`未知提示词文件：${file}`);
  if (!doc.fields.some((field) => field.key === key)) throw new Error(`${doc.title} 没有 ${key}`);
  return doc;
}

export interface PromptValue {
  file: string;
  key: string;
  /** 当前生效值，可能是用户覆盖层 */
  value: string;
  /** 内置默认值，用于对比与恢复 */
  builtin: string;
  /** 是否已被用户覆盖 */
  overridden: boolean;
  /** 当前生效文件路径 */
  path: string;
}

export function readPromptValue(file: string, key: string): PromptValue {
  const doc = assertPromptTarget(file, key);

  const builtinFile = builtinPath(doc.file);
  if (!fs.existsSync(builtinFile)) throw new Error(`缺少内置提示词：${builtinFile}`);
  const builtinData = JSON.parse(fs.readFileSync(builtinFile, "utf-8")) as Record<string, unknown>;
  const builtin = typeof builtinData[key] === "string" ? (builtinData[key] as string) : "";

  // 覆盖层存在但缺这个键时，实际用的仍是内置值，不算自定义
  const overridden = pickFrom(userPath(doc.file), key) !== null;
  return {
    file: doc.file,
    key,
    value: readPrompt(doc.file, key),
    builtin,
    overridden,
    path: path.join(overridden ? userPromptsDir() : promptsDir(), doc.file),
  };
}

/** 写入用户覆盖层：只存改过的键，其余读取时回退到内置 */
export function writePromptValue(file: string, key: string, value: string): PromptValue {
  const doc = assertPromptTarget(file, key);
  if (!value.trim()) throw new Error("提示词不能为空");

  const userFile = userPath(doc.file);
  const base: Record<string, unknown> = fs.existsSync(userFile)
    ? (JSON.parse(fs.readFileSync(userFile, "utf-8")) as Record<string, unknown>)
    : {};

  base[key] = value;
  ensureDir(userPromptsDir());
  fs.writeFileSync(userFile, `${JSON.stringify(base, null, 2)}\n`, "utf-8");
  clearPromptCache();
  return readPromptValue(doc.file, key);
}

/** 删掉覆盖层里的这一键；文件空了就连文件一起删 */
export function resetPromptValue(file: string, key: string): PromptValue {
  const doc = assertPromptTarget(file, key);
  const userFile = userPath(doc.file);
  if (!fs.existsSync(userFile)) return readPromptValue(doc.file, key);

  const data = JSON.parse(fs.readFileSync(userFile, "utf-8")) as Record<string, unknown>;
  delete data[key];

  if (Object.keys(data).length === 0) fs.rmSync(userFile, { force: true });
  else fs.writeFileSync(userFile, `${JSON.stringify(data, null, 2)}\n`, "utf-8");

  clearPromptCache();
  return readPromptValue(doc.file, key);
}
