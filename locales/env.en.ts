import type { EnvKey } from "./env.zh";

/** env 命名空间的英文字典，键由 zh 侧约束。 */
export const env = {
  ffmpegMissing: "Not found — video compositing will fail",
  materialSource: "Footage source",
  missing: "{n} not configured",
  missingOne: "{label} not configured",
  needLlm: "No API key — cannot generate scripts",
  needMaterial: "Configure at least one of Pixabay / Pexels keys, or footage matching fails",
  needTts: "Configure at least one of Edge voices / CosyVoice / Doubao Seed-TTS",
  title: "Environment",
  voiceEngine: "Voice engine",
} satisfies Record<EnvKey, string>;
