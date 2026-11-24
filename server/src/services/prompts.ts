import fs from "node:fs";
import path from "node:path";
import { speakerNames, type SpeakerNames } from "../config.js";
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

/** 可在「设置 → 提示词」里编辑的文档，顺序即展示顺序 */
export const PROMPT_DOCS: PromptDoc[] = [
  {
    file: "podcast.json",
    title: "播客",
    description: "两人对谈。改这里会影响下一次写稿，已生成的任务不受影响。",
    fields: [
      { key: "prompt_writer", label: "写稿", hint: "决定结构、段数与语气" },
      { key: "prompt_rewriter", label: "润色", hint: "压字数、改口语，容易磨平人味" },
    ],
  },
  {
    file: "crosstalk.json",
    title: "相声",
    description: "捧逗互动，包袱节奏快。",
    fields: [
      { key: "prompt_writer", label: "写稿", hint: "决定结构与包袱密度" },
      { key: "prompt_rewriter", label: "润色", hint: "压字数、改口语" },
    ],
  },
  {
    file: "talkshow.json",
    title: "脱口秀",
    description: "单人吐槽，口语化强。",
    fields: [
      { key: "prompt_writer", label: "写稿", hint: "决定结构与吐槽方式" },
      { key: "prompt_rewriter", label: "润色", hint: "压字数、改口语" },
    ],
  },
  {
    file: "critic.json",
    title: "审稿与返修",
    description: "所有风格共用。分数低于阈值会触发返修，返修提示词写得太严会把稿子改回工整。",
    fields: [
      { key: "prompt_critic", label: "审稿", hint: "打分维度与阈值说明" },
      { key: "prompt_repair", label: "按意见返修", hint: "拿到意见后如何改稿" },
    ],
  },
  {
    file: "material.json",
    title: "素材检索词",
    description: "把每段台词转成外网检索用的英文关键词。",
    fields: [{ key: "prompt_search_terms", label: "检索词", hint: "每段 3~5 个词" }],
  },
  {
    file: "video_select.json",
    title: "素材选片",
    description: "看完候选素材后，挑出与台词最搭的一条。",
    fields: [{ key: "prompt_video_select", label: "选片", hint: "按标签与画面挑片" }],
  },
  {
    file: "vision_select.json",
    title: "视觉选片",
    description: "看缩略图挑片，比纯文本选片更准，也更容易挑到不相关画面。",
    fields: [{ key: "prompt_vision_select", label: "视觉选片", hint: "看画面判断是否贴合台词" }],
  },
];

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
