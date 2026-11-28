import fs from "node:fs";
import path from "node:path";
import { userDataDir } from "./paths";

export interface AppConfig {
  LLM_API_KEY?: string;
  LLM_API_URL?: string;
  LLM_MODEL?: string;
  LLM_THINKING?: string;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_WORKSPACE_ID?: string;
  PIXABAY_API_KEY?: string;
  PEXELS_API_KEY?: string;
  FPS?: string;
  TTS_SPEED?: string;
  TITLE_DURATION?: string;
  SUBTITLE_INTERVAL?: string;
  [key: string]: string | undefined;
}

/** 与 server/src/config.ts 保持一致，也作为保存白名单 */
export const DEFAULTS: AppConfig = {
  LLM_API_KEY: "",
  LLM_API_URL: "https://api.deepseek.com",
  LLM_MODEL: "deepseek-flash",
  LLM_THINKING: "0",
  DASHSCOPE_API_KEY: "",
  DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/api/v1",
  DASHSCOPE_WORKSPACE_ID: "",
  DASHSCOPE_WS_URL: "",
  TTS_COSYVOICE_MODEL: "cosyvoice-v3-flash",
  SEED_TTS_API_KEY: "",
  TTS_SEED_RESOURCE_ID: "seed-tts-2.0",
  TTS_SEED_MODEL: "seed-tts-2.0-expressive",
  PIXABAY_API_KEY: "",
  PEXELS_API_KEY: "",
  MATERIAL_MIN_DURATION: "10",
  FPS: "24",
  TTS_SPEED: "1.1",
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
  VARIATION_SEED: "",
  VISION_SELECT: "1",
  SHOTS_PER_PARAGRAPH: "2",
  QUOTE_FALLBACK: "1",
  SFX_ENABLED: "1",
  SFX_VOLUME: "0.2",
  OUTRO_DURATION: "0",
  OUTRO_TITLE: "关注我，下期见",
  OUTRO_HANDLE: "",
  CHAPTER_DURATION: "2",
  CARD_ACCENT: "#ff5a3c",
  SPEAKER_MAIN: "小简",
  SPEAKER_GUEST: "老陈",
};

/** 配置读写的唯一白名单 */
const CONFIG_KEYS = Object.keys(DEFAULTS);

export function configFile(): string {
  return path.join(userDataDir(), "config.json");
}

/** 只保留白名单内且值为字符串的键 */
function sanitize(input: unknown): AppConfig {
  const out: AppConfig = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return out;
  const source = input as Record<string, unknown>;
  for (const key of CONFIG_KEYS) {
    const value = source[key];
    if (typeof value === "string") out[key] = value.trim();
  }
  return out;
}

/** 读文件并清洗，文件不存在或损坏返回空对象 */
function readFileConfig(): AppConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configFile(), "utf-8");
  } catch (e) {
    // 文件不存在属正常，其它错误需留日志
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[config] 读取配置失败，本次回退默认值：${String(e)}`);
    }
    return {};
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch (e) {
    // 先备份再回退，避免覆盖用户填的 Key
    const backup = `${configFile()}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(configFile(), backup);
      console.warn(`[config] 配置文件解析失败，已备份到 ${backup}：${String(e)}`);
    } catch (renameErr) {
      console.warn(`[config] 配置文件解析失败且备份失败：${String(renameErr)}`);
    }
    return {};
  }
}

export function loadConfig(): AppConfig {
  return { ...DEFAULTS, ...readFileConfig() };
}

/*
 * 界面偏好，单独存 ui.json。
 *
 * 不放进 config.json：后者是后端配置，键集合被一致性检查严格约束。
 * 更要紧的是设置页在 file:// 下、主窗口在 http:// 下，两边 localStorage
 * 互不相通，只有落到同一个文件才谈得上共享。
 */
export type ThemePreference = "light" | "dark" | "system";

export interface UiPreferences {
  language: "zh" | "en" | "system";
  theme: ThemePreference;
}

export const UI_DEFAULTS: UiPreferences = { language: "system", theme: "system" };

/** 两个偏好的取值集合相同，共用一个守卫 */
function isPreference<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

const LANGUAGE_OPTIONS = ["zh", "en", "system"] as const;
const THEME_OPTIONS = ["light", "dark", "system"] as const;

export function uiFile(): string {
  return path.join(userDataDir(), "ui.json");
}

export function loadUi(): UiPreferences {
  try {
    const raw = fs.readFileSync(uiFile(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      language: isPreference(parsed.language, LANGUAGE_OPTIONS) ? parsed.language : UI_DEFAULTS.language,
      theme: isPreference(parsed.theme, THEME_OPTIONS) ? parsed.theme : UI_DEFAULTS.theme,
    };
  } catch {
    return { ...UI_DEFAULTS };
  }
}

export function saveUi(next: Partial<UiPreferences>): UiPreferences {
  const merged: UiPreferences = { ...loadUi(), ...next };
  fs.mkdirSync(userDataDir(), { recursive: true });
  const file = uiFile();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    // 先写临时文件再 rename，避免写到一半掉电留下半个 JSON
    fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw e;
  }
  return merged;
}

/** 首次启动写入一份带默认值的配置 */
export function ensureConfig(): AppConfig {
  // 损坏文件由 loadConfig 处理，这里只确认存在
  const cfg = loadConfig();
  if (!fs.existsSync(configFile())) saveConfig(cfg);
  return cfg;
}

export function saveConfig(next: AppConfig): AppConfig {
  const merged: AppConfig = { ...loadConfig(), ...sanitize(next) };
  const file = configFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(userDataDir(), { recursive: true });
  try {
    // 先写临时文件再 rename 保证原子性；含 API Key，POSIX 下收窄到 0600
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败可忽略
    }
    throw e;
  }
  return merged;
}
