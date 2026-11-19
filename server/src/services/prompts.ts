import fs from "node:fs";
import path from "node:path";
import { speakerNames, type SpeakerNames } from "../config.js";
import { promptsDir } from "../paths.js";

export interface PromptPair {
  writer: string;
  rewriter: string;
}

/** 运行时替换的角色名占位符 */
const SPEAKER_MAIN_TOKEN = "{{SPEAKER_MAIN}}";
const SPEAKER_GUEST_TOKEN = "{{SPEAKER_GUEST}}";

const cache = new Map<string, string>();

function readPrompt(file: string, key: string): string {
  const cacheKey = `${file}#${key}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const full = path.join(promptsDir(), file);
  if (!fs.existsSync(full)) throw new Error(`缺少 prompt 文件：${full}`);

  const data = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${full} 缺少 ${key}`);

  cache.set(cacheKey, value);
  return value;
}

function applySpeakers(template: string, speakers: SpeakerNames): string {
  return template.split(SPEAKER_MAIN_TOKEN).join(speakers.main).split(SPEAKER_GUEST_TOKEN).join(speakers.guest);
}

/** 读取 assets/prompts/<风格>.json，填充角色名占位符 */
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
