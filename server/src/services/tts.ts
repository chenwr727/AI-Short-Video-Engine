import type { AppConfig } from "../config.js";
import type { TtsEngine } from "../types.js";
import { synthesizeCosyvoice } from "./tts-cosyvoice.js";
import { synthesizeEdge } from "./tts-edge.js";
import { synthesizeSeed } from "./tts-seed.js";
import { userError } from "../errors.js";

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
    throw userError("noDashscopeKey", 500);
  }
  return { model: cfg.TTS_COSYVOICE_MODEL, synthesize: (req) => synthesizeCosyvoice(cfg, req) };
}
