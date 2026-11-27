/** env 命名空间的中文字典，也是这一组键的真源。 */
export const env = {
  ffmpegMissing: "未检测到，合成视频会失败",
  materialSource: "素材源",
  missing: "{n} 项未配置",
  missingOne: "{label}未配置",
  needLlm: "未配置 API Key，无法生成剧本",
  needMaterial: "Pixabay / Pexels 至少配一个 Key，否则匹配素材会失败",
  needTts: "Edge 语音 / CosyVoice / 豆包 Seed-TTS 至少配一个",
  title: "运行环境",
  voiceEngine: "配音引擎",
} satisfies Record<string, string>;

export type EnvKey = keyof typeof env;
