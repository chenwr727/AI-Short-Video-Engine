import type { Bilingual } from "./i18n.js";

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
  /**
   * 素材匹配完成后是否顺带配置信息卡，缺省 true。
   * 关掉就只出实拍素材；打开则逐段判断哪几段适合做信息卡并生成。
   * 生成 / 重新生成素材都按这个配置走。
   */
  autoInfoCards?: boolean;
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
  /** 摘要：纯数字走 counts 由前端拼，固定说法按写那一刻的语言定稿 */
  message?: string;
  /**
   * 结构化的完成摘要，前端按界面语言组装文案。
   *
   * message 是落盘的中文快照，语言切换后不会变；有 counts 时前端优先用它，
   * 老任务没有这个字段则回退到 message。
   */
  counts?: {
    sections?: number;
    seconds?: number;
    sentences?: number;
    chars?: number;
    cards?: number;
    /** 合成时因缺素材没生成的版式卡数量 */
    missingCards?: number;
  };
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
  /**
   * 这一段配了信息卡。
   * 卡片和实拍一样是「素材」，由用户在素材页逐段指定，不是版式阶段的附属产物。
   * 有素材时渲染成透明层叠在实拍上（画面照旧带运镜）；没素材时才整段替代 videoPath。
   */
  infoCard?: CardSpec;
}

export interface MaterialManifest {
  source: MaterialSource;
  /** 来源 + 画幅 + 时长门槛，变了清单不可复用 */
  signature?: string;
  items: MaterialItem[];
}

export type CardKind = "intro" | "chapter" | "outro" | "quote" | "info";

/** 模板白名单：AI 只能在这些 composition 里选，避免生成不可控版式 */
export type CardComposition =
  | "TitleCard"
  | "TitleHero"
  | "ChapterCard"
  | "ChapterSplit"
  | "OutroCard"
  | "OutroMinimal"
  | "QuoteCard"
  | "PersonCard"
  | "PersonCardHero"
  | "PersonCardCompact"
  | "CompareCard"
  | "CompareCardStacked"
  | "TimelineCard"
  | "StatCard"
  | "StatCardSplit";

/** 对比卡的一栏 */
export interface CompareSide {
  name: string;
  stance: string;
  note?: string;
  /**
   * 台词里能定位到这一栏的原句片段。
   * 合成时按它算出「念到这句时这一栏才出现」的时间点，见 resolveQuote。
   */
  quote?: string;
}

/**
 * 信息层上「跟着旁白逐条出现」的一条要点。
 *
 * quote 是台词里的原句片段（不是句号），用来定位它对应哪一句旁白 ——
 * 模型不可信，片段对不上就丢这一条，卡片退回静态版式，不猜时间。
 */
export interface CardBeat {
  text: string;
  quote: string;
}

/** 时间线卡的一个节点 */
export interface TimelineItem {
  time: string;
  text: string;
}

/** 数据卡的一根柱子 */
export interface StatBar {
  label: string;
  value: number;
  hint?: string;
}

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

  // ——— 信息卡专用字段，按 compositionId 取用 ———
  /** PersonCard：头像位上的 1 个汉字；音译名留空，卡片用抽象人形标记 */
  avatar?: string;
  /** PersonCard：身份/职务 */
  role?: string;
  /** PersonCard：一句核心判断；其它卡的主文案也复用它 */
  line?: string;
  /** CompareCard：左右两栏 */
  compare?: { left: CompareSide; right: CompareSide };
  /** CompareCard：右栏主色 */
  rightAccent?: string;
  /** TimelineCard：节点列表 */
  timeline?: TimelineItem[];
  /** StatCard：主数字与说明 */
  stat?: { value: string; caption?: string; note?: string; bars?: StatBar[] };
  /** 逐条上屏的要点：PersonCard 替代 line，StatCard 替代 note */
  beats?: CardBeat[];
  /**
   * 信息卡的底图（素材帧的 data URI）。
   * 有它就渲染成「素材上叠信息层」，没有就是纯设计卡。
   * 存 base64 而不是文件路径：Remotion 渲染进程读不到本地绝对路径。
   */
  bgImage?: string;
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
  /** 写入时的界面语言，只存这一份 */
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
  /** 失败原因：按失败那一刻的界面语言定稿 */
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 最近一次重跑某个阶段的时刻（毫秒时间戳）。
   * 重跑时用它把旧日志连同没有 stage 的历史行一起清掉。
   */
  runStartedAt?: number;
}

export type TaskEvent = { type: "snapshot"; state: TaskState | null };

export interface TaskContext {
  input: string;
  options: GenerateOptions;
  workspace: string;
  signal: AbortSignal;
  /** 双语对象由 manager 按当时语言定稿；字符串表示纯数据（路径、标签、数字） */
  log: (text: string | Bilingual, level?: LogLine["level"]) => void;
  markStage: (id: string, status: StageStatus, message?: string | Bilingual, counts?: StageState["counts"]) => void;
}
