import { CARD_TEMPLATES } from "./card-templates.js";
import { cardDefaults, MAX_CHAPTER_CARDS } from "./pipeline/cards.js";
import {
  autoSubtitleFontSize,
  bool,
  cardAccentPalette,
  loadConfig,
  num,
  numberOrZero,
  speakerNames,
  type AppConfig,
} from "./config.js";
import { pick, type Bilingual, type Lang } from "./i18n.js";
import { COSY_VOICES, EDGE_VOICES, SEED_VOICES, type VoiceDef } from "./voices.js";

/** 下发给前端的选项：文案已按语言展开 */
export interface Option {
  id: string;
  label: string;
  description?: string;
  /** 角色数，单人风格只需主讲名 */
  speakers?: number;
}

export interface VoiceOption {
  id: string;
  label: string;
}

export interface TtsEngineOption extends Option {
  voices: VoiceOption[];
}

/** 内部定义：文案保留双语，出站前再按语言取 */
interface TextOption {
  id: string;
  label: Bilingual;
  description?: Bilingual;
  speakers?: number;
}

export const PROMPT_SOURCES: TextOption[] = [
  {
    id: "podcast",
    label: { zh: "播客", en: "Podcast" },
    description: { zh: "两人对谈，信息密度高", en: "Two-host chat, dense" },
    speakers: 2,
  },
  {
    id: "crosstalk",
    label: { zh: "相声", en: "Crosstalk" },
    description: { zh: "捧逗互动，包袱节奏快", en: "Banter with quick punchlines" },
    speakers: 2,
  },
  {
    id: "talkshow",
    label: { zh: "脱口秀", en: "Stand-up" },
    description: { zh: "单人吐槽，口语化强", en: "Solo rant, very colloquial" },
    speakers: 1,
  },
];

export const MATERIAL_SOURCES: TextOption[] = [
  {
    id: "pixabay",
    label: { zh: "Pixabay", en: "Pixabay" },
    description: { zh: "横竖版素材多，免费额度宽", en: "Plenty of clips, generous free tier" },
  },
  {
    id: "pexels",
    label: { zh: "Pexels", en: "Pexels" },
    description: { zh: "画质高，中文检索体验好", en: "High quality, good search" },
  },
];

export const RESOLUTIONS: TextOption[] = [
  { id: "1080x1920", label: { zh: "1080 × 1920（竖屏高清）", en: "1080 × 1920 (portrait HD)" } },
  { id: "720x1280", label: { zh: "720 × 1280（竖屏快速）", en: "720 × 1280 (portrait fast)" } },
];

/** 内部定义：引擎与音色文案都保留双语 */
interface TextTtsEngine extends TextOption {
  description: Bilingual;
  voices: VoiceDef[];
}

/** Edge 始终可用，其余需配置 Key；首个为默认 */
export function ttsEngines(cfg: AppConfig, lang: Lang = "zh"): TtsEngineOption[] {
  const engines: TextTtsEngine[] = [
    {
      id: "edge",
      label: { zh: "Edge 在线语音", en: "Edge online voices" },
      description: { zh: "免费、无需 Key，默认引擎", en: "Free, no key needed, default" },
      voices: EDGE_VOICES,
    },
  ];

  if (cfg.DASHSCOPE_API_KEY) {
    engines.push({
      id: "cosyvoice",
      label: { zh: "CosyVoice（流式）", en: "CosyVoice (streaming)" },
      description: { zh: "WebSocket 流式合成，长句韵律更自然", en: "Streaming synthesis, smoother long lines" },
      voices: COSY_VOICES,
    });
  }

  if (cfg.SEED_TTS_API_KEY) {
    engines.push({
      id: "seedtts",
      label: { zh: "豆包 Seed-TTS（火山引擎）", en: "Doubao Seed-TTS (Volcano)" },
      description: { zh: "需要 SEED_TTS_API_KEY，情绪与韵律表现更好", en: "Needs SEED_TTS_API_KEY, richer prosody" },
      voices: SEED_VOICES,
    });
  }

  return engines.map((engine) => ({
    id: engine.id,
    label: pick(lang, engine.label),
    description: pick(lang, engine.description),
    voices: engine.voices.map((voice) => ({ id: voice.id, label: pick(lang, voice.label) })),
  }));
}

/** 把双语选项展开成当前语言 */
function localize(options: TextOption[], lang: Lang): Option[] {
  return options.map((option) => ({
    id: option.id,
    label: pick(lang, option.label),
    ...(option.description ? { description: pick(lang, option.description) } : {}),
    ...(option.speakers === undefined ? {} : { speakers: option.speakers }),
  }));
}

export function metaPayload(lang: Lang = "zh", cfg: AppConfig = loadConfig()) {
  return {
    promptSources: localize(PROMPT_SOURCES, lang),
    speakers: speakerNames(cfg),
    ttsEngines: ttsEngines(cfg, lang),
    ttsSpeed: num(cfg.TTS_SPEED, 1.1),
    render: {
      // 0 表示自动，换算成具体 px 返回；竖屏基准宽度固定 1080
      subtitleFontSize: numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0) || autoSubtitleFontSize(1080),
      bgmEnabled: bool(cfg.BGM_ENABLED, true),
      bgmVolume: numberOrZero(cfg.BGM_VOLUME, 0.1),
    },
    materialSources: localize(MATERIAL_SOURCES, lang),
    resolutions: localize(RESOLUTIONS, lang),
    /** 版式确认页的配色与模板选项 */
    cardAccents: cardAccentPalette(cfg),
    cardTemplates: CARD_TEMPLATES,
    /** 版式确认页要显示的配置现值 */
    cardDefaults: {
      ...cardDefaults(cfg),
      /** 章节卡上限：每段之间最多一张，另有 6 张的总量上限 */
      maxChapters: MAX_CHAPTER_CARDS,
      accent: cardAccentPalette(cfg)[0] ?? "#ff5a3c",
      outroTitle: (cfg.OUTRO_TITLE ?? "").trim(),
      outroHandle: (cfg.OUTRO_HANDLE ?? "").trim(),
    },
  };
}
