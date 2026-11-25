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
import { COSY_VOICES, EDGE_VOICES, SEED_VOICES } from "./voices.js";

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

export const PROMPT_SOURCES: Option[] = [
  { id: "podcast", label: "播客", description: "两人对谈，信息密度高", speakers: 2 },
  { id: "crosstalk", label: "相声", description: "捧逗互动，包袱节奏快", speakers: 2 },
  { id: "talkshow", label: "脱口秀", description: "单人吐槽，口语化强", speakers: 1 },
];

export const MATERIAL_SOURCES: Option[] = [
  { id: "pixabay", label: "Pixabay", description: "横竖版素材多，免费额度宽" },
  { id: "pexels", label: "Pexels", description: "画质高，中文检索体验好" },
];

export const RESOLUTIONS: Option[] = [
  { id: "1080x1920", label: "1080 × 1920（竖屏高清）" },
  { id: "720x1280", label: "720 × 1280（竖屏快速）" },
];

/** Edge 始终可用，其余需配置 Key；首个为默认 */
export function ttsEngines(cfg: AppConfig): TtsEngineOption[] {
  const engines: TtsEngineOption[] = [
    {
      id: "edge",
      label: "Edge 在线语音",
      description: "免费、无需 Key，默认引擎",
      voices: EDGE_VOICES,
    },
  ];

  if (cfg.DASHSCOPE_API_KEY) {
    engines.push({
      id: "cosyvoice",
      label: "CosyVoice（流式）",
      description: "WebSocket 流式合成，长句韵律更自然",
      voices: COSY_VOICES,
    });
  }

  if (cfg.SEED_TTS_API_KEY) {
    engines.push({
      id: "seedtts",
      label: "豆包 Seed-TTS（火山引擎）",
      description: "需要 SEED_TTS_API_KEY，情绪与韵律表现更好",
      voices: SEED_VOICES,
    });
  }

  return engines;
}

export function metaPayload(cfg: AppConfig = loadConfig()) {
  return {
    promptSources: PROMPT_SOURCES,
    speakers: speakerNames(cfg),
    ttsEngines: ttsEngines(cfg),
    ttsSpeed: num(cfg.TTS_SPEED, 1.1),
    render: {
      // 0 表示自动，换算成具体 px 返回
      subtitleFontSize: numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0) || autoSubtitleFontSize(num(cfg.VIDEO_WIDTH, 1080)),
      bgmEnabled: bool(cfg.BGM_ENABLED, true),
      bgmVolume: numberOrZero(cfg.BGM_VOLUME, 0.1),
    },
    materialSources: MATERIAL_SOURCES,
    resolutions: RESOLUTIONS,
    /** 版式确认页的配色与模板选项 */
    cardAccents: cardAccentPalette(cfg),
    cardTemplates: CARD_TEMPLATES,
    /**
     * 版式确认页要显示的配置现值。
     * 之前页面只拿到色板，片头/章节/片尾的时长与开关全靠猜，
     * 用户改了设置却看不出有没有生效。
     */
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
