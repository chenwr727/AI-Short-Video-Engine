import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export interface AppConfig {
  LLM_API_KEY: string;
  LLM_API_URL: string;
  LLM_MODEL: string;
  DASHSCOPE_API_KEY: string;
  DASHSCOPE_BASE_URL: string;
  TTS_COSYVOICE_MODEL: string;
  TTS_SEED_MODEL: string;
  TTS_SEED_RESOURCE_ID: string;
  SEED_TTS_API_KEY: string;
  DASHSCOPE_WS_URL: string;
  PIXABAY_API_KEY: string;
  PEXELS_API_KEY: string;
  VIDEO_WIDTH: string;
  VIDEO_HEIGHT: string;
  FPS: string;
  TTS_SPEED: string;
  MATERIAL_MIN_DURATION: string;
  TRANSITION_DURATION: string;
  /** 字幕字号（px），0 表示按画宽自动换算 */
  SUBTITLE_FONT_SIZE: string;
  /** 是否混入 BGM：1/0，也认 true/false */
  BGM_ENABLED: string;
  BGM_VOLUME: string;
  /** 淡入淡出（秒），0 表示关闭 */
  AUDIO_FADE_IN: string;
  AUDIO_FADE_OUT: string;
  VIDEO_FADE_IN: string;
  VIDEO_FADE_OUT: string;
  /** 剧本里的两个角色名，可在「文案脚本」页临时改 */
  SPEAKER_MAIN: string;
  SPEAKER_GUEST: string;
}

const DEFAULTS: AppConfig = {
  LLM_API_KEY: "",
  LLM_API_URL: "https://api.deepseek.com",
  LLM_MODEL: "deepseek-flash",
  DASHSCOPE_API_KEY: "",
  DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/api/v1",
  TTS_COSYVOICE_MODEL: "cosyvoice-v3.5-flash",
  // 豆包（火山引擎 Seed-TTS）：SEED_TTS_API_KEY 留空则界面上不出现该引擎
  TTS_SEED_MODEL: "seed-tts-2.0-expressive",
  TTS_SEED_RESOURCE_ID: "seed-tts-2.0",
  SEED_TTS_API_KEY: "",
  // 留空则按 DASHSCOPE_BASE_URL 推导为 wss://<host>/api-ws/v1/inference
  DASHSCOPE_WS_URL: "",
  PIXABAY_API_KEY: "",
  PEXELS_API_KEY: "",
  VIDEO_WIDTH: "1080",
  VIDEO_HEIGHT: "1920",
  FPS: "24",
  TTS_SPEED: "1.1",
  MATERIAL_MIN_DURATION: "10",
  TRANSITION_DURATION: "0.5",
  // 0 = 按画宽自动换算（1080 宽约 72px），想固定字号就填具体像素
  SUBTITLE_FONT_SIZE: "0",
  BGM_ENABLED: "1",
  BGM_VOLUME: "0.1",
  AUDIO_FADE_IN: "0.8",
  AUDIO_FADE_OUT: "1.2",
  VIDEO_FADE_IN: "0.5",
  VIDEO_FADE_OUT: "0.5",
  // 双人风格的默认角色名：主讲（引出观点）与追问（插话提问）
  SPEAKER_MAIN: "小简",
  SPEAKER_GUEST: "老陈",
};

/** 配置来源优先级：环境变量 > 用户 config.json > 默认值 */
const ENV_KEYS = Object.keys(DEFAULTS) as (keyof AppConfig)[];

export function configFile(): string {
  return process.env.AISV_CONFIG_FILE ?? path.join(dataDir(), "config.json");
}

function readFileConfig(): Partial<AppConfig> {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<AppConfig> = {};
    for (const key of ENV_KEYS) {
      const v = parsed[key];
      if (typeof v === "string") out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadConfig(): AppConfig {
  const merged: AppConfig = { ...DEFAULTS, ...readFileConfig() };
  for (const key of ENV_KEYS) {
    const v = process.env[key];
    if (v && v.trim()) merged[key] = v.trim();
  }
  return merged;
}

export function isLlmConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.LLM_API_KEY && cfg.LLM_API_URL && cfg.LLM_MODEL);
}

/** 剧本里的两个角色名（主讲 / 追问） */
export interface SpeakerNames {
  main: string;
  guest: string;
}

export const SPEAKER_MAX_LEN = 8;

/** 角色名优先用任务里传的，其次配置项，最后默认值 */
export function speakerNames(cfg: AppConfig = loadConfig()): SpeakerNames {
  return {
    main: (cfg.SPEAKER_MAIN || "").trim() || DEFAULTS.SPEAKER_MAIN,
    guest: (cfg.SPEAKER_GUEST || "").trim() || DEFAULTS.SPEAKER_GUEST,
  };
}

/** 清洗用户输入的角色名：空值回退、去空白、限长 */
export function normalizeSpeaker(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, SPEAKER_MAX_LEN) : fallback;
}

export function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 字幕区占画宽的比例 */
export const SUBTITLE_WIDTH_RATIO = 0.8;
/** 自动字号 = 字幕区宽度 ÷ 该系数（12 → 1080 宽约 72px，比早期的 17 大一圈） */
export const SUBTITLE_FONT_SIZE_RATIO = 12;
/** 标题相对字幕的放大倍数 */
export const TITLE_SIZE_RATIO = 1.4;

/** 按画宽算出的默认字幕字号（具体 px），给成片页显示用，不显示「0 = 自动」 */
export function autoSubtitleFontSize(width: number): number {
  return Math.round(Math.round(width * SUBTITLE_WIDTH_RATIO) / SUBTITLE_FONT_SIZE_RATIO);
}

/** 允许 0 的数值配置：num() 把 0 当无效值，这里专给「0 = 关闭/自动」的项用 */
export function numberOrZero(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 布尔型配置：1/true/on/yes 为真，0/false/off/no 为假，留空用默认值 */
export function bool(value: string, fallback: boolean): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return ["1", "true", "on", "yes"].includes(v) || Boolean(Number(v));
}

/** 逗号分隔的配置项 → 数组，空则回退默认 */
export function splitList(value: string, fallback: string[]): string[] {
  const list = value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

/** 允许用户只填域名或带 /v1，统一补齐到具体接口路径 */
export function joinApiPath(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${apiPath.replace(/^\/+/, "")}`;
}
