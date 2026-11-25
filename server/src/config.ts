import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export interface AppConfig {
  LLM_API_KEY: string;
  LLM_API_URL: string;
  LLM_MODEL: string;
  DASHSCOPE_API_KEY: string;
  DASHSCOPE_BASE_URL: string;
  /** 作为 X-DashScope-WorkSpace 请求头 */
  DASHSCOPE_WORKSPACE_ID: string;
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
  /** 0 = 不显示 */
  TITLE_DURATION: string;
  /** 台词间静音秒数 */
  SUBTITLE_INTERVAL: string;
  /** px，0 = 按画宽自动 */
  SUBTITLE_FONT_SIZE: string;
  /**
   * ass = 合并期用 libass 烧字幕（快，默认）。
   * remotion = 叠一层透明 VP9：当前实现与 ass 视觉等价、但慢约 20 倍，
   * 只在需要 ASS 表达不了的逐字动效时才值得开；remotion/ 缺席或失败会自动回退 ass。
   */
  SUBTITLE_RENDER: string;
  BGM_ENABLED: string;
  BGM_VOLUME: string;
  /** 秒数，0 = 关闭 */
  AUDIO_FADE_IN: string;
  AUDIO_FADE_OUT: string;
  VIDEO_FADE_IN: string;
  VIDEO_FADE_OUT: string;
  /** 0 = 关闭，1-10 = 缓慢推拉/平移的强度 */
  CAMERA_MOTION: string;
  /** 0 = 关闭，1-10 = 对比度/饱和/暗角/颗粒的强度 */
  COLOR_GRADE: string;
  /** fade = 统一淡入淡出，mixed = 按段落轮换转场 */
  TRANSITION_STYLE: string;
  /** 1 = 用缩略图让模型看画面选片，0 = 只按标签文本选 */
  VISION_SELECT: string;
  /** 每段镜头数 1-3，1 = 整段只用一条素材 */
  SHOTS_PER_PARAGRAPH: string;
  /** 1 = 没检索到素材时改用设计卡，0 = 直接报错中断 */
  QUOTE_FALLBACK: string;
  /** 1 = 转场与片头加音效 */
  SFX_ENABLED: string;
  /** 音效音量，1 = 原音量 */
  SFX_VOLUME: string;
  /** 1 = 用 Remotion 模板渲染片头，需要 remotion/ 子工程已安装依赖 */
  INTRO_ENABLED: string;
  /** Remotion 片尾秒数，0 = 不加片尾 */
  OUTRO_DURATION: string;
  OUTRO_TITLE: string;
  /** 片尾账号名，留空则不显示 */
  OUTRO_HANDLE: string;
  /** 1 = 段落之间插入 Remotion 过场卡 */
  CHAPTER_CARD: string;
  /** 过场卡秒数，过短会被转场吃掉，建议 2 秒以上 */
  CHAPTER_DURATION: string;
  /** 1 = 素材之后多一步「生成版式」，由 AI 选模板并写卡片文案 */
  CARDS_ENABLED: string;
  /** 卡片主色，AI 只在这个色板里挑 */
  CARD_ACCENT: string;
  SPEAKER_MAIN: string;
  SPEAKER_GUEST: string;
}

const DEFAULTS: AppConfig = {
  LLM_API_KEY: "",
  LLM_API_URL: "https://api.deepseek.com",
  LLM_MODEL: "deepseek-flash",
  DASHSCOPE_API_KEY: "",
  DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/api/v1",
  DASHSCOPE_WORKSPACE_ID: "",
  TTS_COSYVOICE_MODEL: "cosyvoice-v3-flash",
  TTS_SEED_MODEL: "seed-tts-2.0-expressive",
  TTS_SEED_RESOURCE_ID: "seed-tts-2.0",
  SEED_TTS_API_KEY: "",
  DASHSCOPE_WS_URL: "",
  PIXABAY_API_KEY: "",
  PEXELS_API_KEY: "",
  VIDEO_WIDTH: "1080",
  VIDEO_HEIGHT: "1920",
  FPS: "24",
  TTS_SPEED: "1.1",
  MATERIAL_MIN_DURATION: "10",
  TRANSITION_DURATION: "0.5",
  TITLE_DURATION: "1.6",
  SUBTITLE_INTERVAL: "0.2",
  SUBTITLE_FONT_SIZE: "0",
  SUBTITLE_RENDER: "ass",
  BGM_ENABLED: "1",
  BGM_VOLUME: "0.1",
  AUDIO_FADE_IN: "0.8",
  AUDIO_FADE_OUT: "1.2",
  VIDEO_FADE_IN: "0.5",
  VIDEO_FADE_OUT: "0.5",
  CAMERA_MOTION: "6",
  COLOR_GRADE: "5",
  TRANSITION_STYLE: "mixed",
  VISION_SELECT: "1",
  SHOTS_PER_PARAGRAPH: "2",
  QUOTE_FALLBACK: "1",
  SFX_ENABLED: "1",
  SFX_VOLUME: "0.2",
  INTRO_ENABLED: "0",
  OUTRO_DURATION: "0",
  OUTRO_TITLE: "关注我，下期见",
  OUTRO_HANDLE: "",
  CHAPTER_CARD: "0",
  CHAPTER_DURATION: "2",
  CARDS_ENABLED: "0",
  CARD_ACCENT: "#ff5a3c",
  SPEAKER_MAIN: "小简",
  SPEAKER_GUEST: "老陈",
};

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

export interface SpeakerNames {
  main: string;
  guest: string;
}

export const SPEAKER_MAX_LEN = 8;

export function speakerNames(cfg: AppConfig = loadConfig()): SpeakerNames {
  return {
    main: (cfg.SPEAKER_MAIN || "").trim() || DEFAULTS.SPEAKER_MAIN,
    guest: (cfg.SPEAKER_GUEST || "").trim() || DEFAULTS.SPEAKER_GUEST,
  };
}

export function normalizeSpeaker(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, SPEAKER_MAX_LEN) : fallback;
}

export function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 字幕区占画宽比例 */
export const SUBTITLE_WIDTH_RATIO = 0.8;
/** 自动字号 = 字幕区宽度 ÷ 该系数 */
export const SUBTITLE_FONT_SIZE_RATIO = 12;
/** 标题字号相对字幕的倍数 */
export const TITLE_SIZE_RATIO = 1.4;

export function autoSubtitleFontSize(width: number): number {
  return Math.round(Math.round(width * SUBTITLE_WIDTH_RATIO) / SUBTITLE_FONT_SIZE_RATIO);
}

/** 同 num()，但允许 0 */
export function numberOrZero(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 留空用 fallback */
/** 卡片可选主色，主色之外只允许这几个，避免出现荧光色 */
const CARD_EXTRA_ACCENTS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];

export function cardAccentPalette(cfg: AppConfig = loadConfig()): string[] {
  const base = (cfg.CARD_ACCENT ?? "").trim() || "#ff5a3c";
  return [base, ...CARD_EXTRA_ACCENTS.filter((color) => color !== base)];
}

export function bool(value: string, fallback: boolean): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return ["1", "true", "on", "yes"].includes(v) || Boolean(Number(v));
}

export function joinApiPath(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${apiPath.replace(/^\/+/, "")}`;
}
