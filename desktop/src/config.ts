import fs from "node:fs";
import path from "node:path";
import { userDataDir } from "./paths";

export interface AppConfig {
  LLM_API_KEY?: string;
  LLM_API_URL?: string;
  LLM_MODEL?: string;
  DASHSCOPE_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  PEXELS_API_KEY?: string;
  VIDEO_WIDTH?: string;
  VIDEO_HEIGHT?: string;
  FPS?: string;
  TTS_SPEED?: string;
  [key: string]: string | undefined;
}

/** 与 server/src/config.ts 的默认值保持一致；设置面板按这里的键做白名单保存 */
export const DEFAULTS: AppConfig = {
  LLM_API_KEY: "",
  LLM_API_URL: "https://api.deepseek.com",
  LLM_MODEL: "deepseek-flash",
  DASHSCOPE_API_KEY: "",
  DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/api/v1",
  DASHSCOPE_WS_URL: "",
  TTS_COSYVOICE_MODEL: "cosyvoice-v3.5-flash",
  SEED_TTS_API_KEY: "",
  TTS_SEED_RESOURCE_ID: "seed-tts-2.0",
  TTS_SEED_MODEL: "seed-tts-2.0-expressive",
  PIXABAY_API_KEY: "",
  PEXELS_API_KEY: "",
  MATERIAL_MIN_DURATION: "10",
  VIDEO_WIDTH: "1080",
  VIDEO_HEIGHT: "1920",
  FPS: "24",
  TTS_SPEED: "1.1",
  TRANSITION_DURATION: "0.5",
  SUBTITLE_FONT_SIZE: "0",
  BGM_ENABLED: "1",
  BGM_VOLUME: "0.1",
  AUDIO_FADE_IN: "0.8",
  AUDIO_FADE_OUT: "1.2",
  VIDEO_FADE_IN: "0.5",
  VIDEO_FADE_OUT: "0.5",
  SPEAKER_MAIN: "小简",
  SPEAKER_GUEST: "老陈",
};

export function configFile(): string {
  return path.join(userDataDir(), "config.json");
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as AppConfig) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 首次启动写入一份带默认值的配置，避免用户面对空文件猜字段名 */
export function ensureConfig(): AppConfig {
  if (!fs.existsSync(configFile())) {
    saveConfig(DEFAULTS);
  }
  return loadConfig();
}

export function saveConfig(next: AppConfig): AppConfig {
  const merged: AppConfig = { ...loadConfig(), ...next };
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}
