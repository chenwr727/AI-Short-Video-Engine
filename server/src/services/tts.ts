import type { AppConfig } from "../config.js";
import type { TtsEngine } from "../types.js";
import { synthesizeCosyvoice } from "./tts-cosyvoice.js";
import { synthesizeEdge } from "./tts-edge.js";
import { synthesizeSeed } from "./tts-seed.js";

export interface TtsRequest {
  text: string;
  voice: string;
  signal: AbortSignal;
}

export interface TtsEngineRuntime {
  model: string;
  synthesize: (req: TtsRequest) => Promise<Buffer>;
}

export function createTtsEngine(cfg: AppConfig, engine: TtsEngine): TtsEngineRuntime {
  if (engine === "edge") {
    return { model: "Edge TTS", synthesize: (req) => synthesizeEdge(cfg, req) };
  }
  if (engine === "seedtts") {
    return { model: cfg.TTS_SEED_MODEL, synthesize: (req) => synthesizeSeed(cfg, req) };
  }

  if (!cfg.DASHSCOPE_API_KEY) {
    throw new Error(
      "未配置 DASHSCOPE_API_KEY，无法使用 CosyVoice 配音。请编辑 config.json 后重启应用，或改用 Edge 在线语音",
    );
  }
  return { model: cfg.TTS_COSYVOICE_MODEL, synthesize: (req) => synthesizeCosyvoice(cfg, req) };
}
