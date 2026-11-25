export type PromptSource = "podcast" | "crosstalk" | "talkshow";
export type TtsEngine = "cosyvoice" | "edge" | "seedtts";
export type MaterialSource = "pixabay" | "pexels";

export interface GenerateOptions {
  promptSource: PromptSource;
  /** 主讲 / 追问 */
  speakers: { main: string; guest: string };
  ttsEngine: TtsEngine;
  /** 默认音色，voiceMap 优先 */
  voice: string;
  /** 角色 → 音色 */
  voiceMap?: Record<string, string>;
  materialSource: MaterialSource;
  width: number;
  height: number;
  fps: number;
  ttsSpeed: number;
  /** px，0 = 按画宽自动 */
  subtitleFontSize?: number;
  bgmEnabled?: boolean;
  bgmVolume?: number;
  /** 绝对路径或 musicDir 下的文件名 */
  bgmFile?: string;
}

export interface RenderPatch {
  subtitleFontSize?: number;
  bgmEnabled?: boolean;
  bgmVolume?: number;
  bgmFile?: string;
}

/** 已分句的台词 */
export interface Dialogue {
  speaker: string;
  /** 展示与字幕文本 */
  contents: string[];
  /** 送 TTS 的文本，可带情绪标签，与 contents 一一对应 */
  contentsTts: string[];
}

export interface Paragraph {
  description: string;
  dialogues: Dialogue[];
}

export interface Transcript {
  title: string;
  paragraphs: Paragraph[];
}

/** LLM 原始输出，未分句 */
export interface RawDialogue {
  speaker: string;
  content: string;
}

export interface RawParagraph {
  description: string;
  dialogues: RawDialogue[];
}

export interface RawTranscript {
  title: string;
  paragraphs: RawParagraph[];
}

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageState {
  id: string;
  label: string;
  status: StageStatus;
  message?: string;
  startedAt?: number;
  endedAt?: number;
}

export type TaskStatus =
  | "idle"
  | "running"
  | "awaiting_script"
  | "script_confirmed"
  | "tts_ready"
  | "material_ready"
  | "awaiting_material"
  | "awaiting_cards"
  | "cards_ready"
  | "completed"
  | "failed"
  | "cancelled";

export interface AudioFileInfo {
  file: string;
  duration: number;
  text: string;
}

export interface AudioDialogue {
  speaker: string;
  voice: string;
  duration: number;
  files: AudioFileInfo[];
}

export interface AudioParagraph {
  index: number;
  duration: number;
  dialogues: AudioDialogue[];
}

export interface AudioManifest {
  engine: string;
  model: string;
  paragraphs: AudioParagraph[];
  totalDuration: number;
  /** 台词指纹，改动后旧清单不可复用 */
  fingerprint?: string;
}

export interface MaterialInfo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  tags: string;
  views: number;
  isAiGenerated: boolean;
  imageUrl: string;
  /** 本地缓存路径 */
  videoPath: string;
  /**
   * 标签与检索词的贴合度：0 跑题，1 只命中通用词，2 命中实义词。
   * 旧版 _videos.json 没有这个字段，读取时按 2 处理。
   */
  relevance?: Relevance;
}

/** 素材与检索词的贴合度，越大越贴合 */
export type Relevance = 0 | 1 | 2;

export interface MaterialItem extends MaterialInfo {
  paragraph: number;
  searchTerms: string[];
  /** 同段落内的补充画面，合成时按句子边界切镜；缺省表示整段只用主素材 */
  shots?: MaterialInfo[];
  /** 没检索到可用素材，合成时改用设计卡，不再中断流程 */
  fallback?: boolean;
}

export interface MaterialManifest {
  source: MaterialSource;
  /** 来源 + 画幅 + 时长门槛，变了清单不可复用 */
  signature?: string;
  items: MaterialItem[];
}

export type CardKind = "intro" | "chapter" | "outro" | "quote";

/** 模板白名单：AI 只能在这些 composition 里选，避免生成不可控版式 */
export type CardComposition =
  "TitleCard" | "TitleHero" | "ChapterCard" | "ChapterSplit" | "OutroCard" | "OutroMinimal" | "QuoteCard";

export interface CardSpec {
  /** 稳定标识：intro / chapter-2 / outro */
  id: string;
  kind: CardKind;
  compositionId: CardComposition;
  /** 章节卡关联的段号，1 起 */
  paragraph?: number;
  title: string;
  /** 角标文案，如 AI 摘要 / PART 02 */
  label: string;
  /** 片尾账号，留空不显示 */
  handle?: string;
  accent: string;
  durationSec: number;
  /** 参数指纹，变了就要重渲 */
  fingerprint?: string;
  /** 渲染产物，交给合成阶段直接拼接 */
  videoPath?: string;
  /** 静帧预览图 */
  stillPath?: string;
}

export interface CardManifest {
  items: CardSpec[];
  /** 剧本指纹 + 画幅，变了清单不可复用 */
  signature?: string;
  /** AI 给的风格说明，仅用于展示 */
  style?: string;
}

/**
 * 版式生成偏好：用户手动改过才写；字段缺省表示跟随 AI 与配置。
 *
 * 三个时长都是「绝对值」语义：0 = 这次不要这类卡，>0 = 用这个秒数。
 * 和缺省（undefined）区分开，否则无法表达「配置里开着，这次关掉」。
 */
export interface CardPrefs {
  /** 指定主色，须在色板内 */
  accent?: string;
  /** 片头时长（秒），0–15 */
  introDurationSec?: number;
  /** 章节卡时长（秒），0–15 */
  chapterDurationSec?: number;
  /** 片尾时长（秒），0–15 */
  outroDurationSec?: number;
}

export interface LogLine {
  time: string;
  level: "info" | "warn" | "error";
  text: string;
  /** 任务级日志不带 */
  stage?: string;
}

export interface TaskState {
  id: string;
  input: string;
  options: GenerateOptions;
  workspace: string;
  status: TaskStatus;
  stages: StageState[];
  logs: LogLine[];
  transcript: Transcript | null;
  audio: AudioManifest | null;
  material: MaterialManifest | null;
  /** 片头/章节/片尾的版式清单，关闭开关时为 null */
  cards: CardManifest | null;
  /** 手动指定的配色与章节时长；null 表示没选过，跟随 AI 与配置 */
  cardPrefs: CardPrefs | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskEvent = { type: "snapshot"; state: TaskState | null };

export interface TaskContext {
  input: string;
  options: GenerateOptions;
  workspace: string;
  signal: AbortSignal;
  log: (text: string, level?: LogLine["level"]) => void;
  markStage: (id: string, status: StageStatus, message?: string) => void;
}
