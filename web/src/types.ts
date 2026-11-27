export interface Option {
  id: string;
  label: string;
  description?: string;
  /** 该风格的角色数，脱口秀为单人 */
  speakers?: number;
}

export interface VoiceOption {
  id: string;
  label: string;
}

export interface TtsEngineOption extends Option {
  voices: VoiceOption[];
}

export interface SpeakerNames {
  main: string;
  guest: string;
}

export interface Meta {
  promptSources: Option[];
  speakers: SpeakerNames;
  ttsEngines: TtsEngineOption[];
  ttsSpeed: number;
  /** 成片预览页的渲染默认值 */
  render: {
    subtitleFontSize: number;
    bgmEnabled: boolean;
    bgmVolume: number;
  };
  materialSources: Option[];
  resolutions: Option[];
  /** 版式页可选的卡片配色与模板 */
  cardAccents: string[];
  cardTemplates: Record<CardKind, { id: string; name: string; hint: string }[]>;
  /** 版式页要显示的配置现值（设置页里配的片头/章节/片尾） */
  cardDefaults?: CardDefaults;
}

/** 与后端 cardDefaults() 的返回值一致 */
export interface CardDefaults {
  introSec: number;
  chapterSec: number;
  outroSec: number;
  /** 三个开关全关，按上面的时长出一份默认清单 */
  auto: boolean;
  /** 章节卡总量上限 */
  maxChapters: number;
  accent: string;
  outroTitle: string;
  outroHandle: string;
}

export interface PromptField {
  key: string;
  label: string;
  hint: string;
}

/** 可编辑的提示词文档，一个文件多个键 */
export interface PromptDoc {
  file: string;
  title: string;
  description: string;
  fields: PromptField[];
}

export interface PromptValue {
  file: string;
  key: string;
  value: string;
  builtin: string;
  overridden: boolean;
  path: string;
}

/** 列表接口只带当前值，详情才带内置默认 */
export interface PromptSummary {
  file: string;
  key: string;
  value: string;
  overridden: boolean;
}

export interface Health {
  ok: boolean;
  version: string;
  dataDir: string;
  outDir: string;
  config: {
    llm: { baseUrl: string; model: string; configured: boolean };
    dashscope: { configured: boolean };
    tts: { edge: boolean; dashscope: boolean; seed: boolean };
    material: { pixabay: boolean; pexels: boolean };
    cards: { enabled: boolean };
  };
  deps: { ffmpeg: string | null; ffprobe: string | null };
}

export interface Dialogue {
  speaker: string;
  contents: string[];
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

/** 标签与检索词的贴合度：0 跑题，1 只命中通用词，2 命中实义词 */
export type Relevance = 0 | 1 | 2;

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
  videoPath: string;
  /** 旧版 _videos.json 没有这个字段 */
  relevance?: Relevance;
}

export interface MaterialItem extends MaterialInfo {
  paragraph: number;
  searchTerms: string[];
  /** 这一段配了信息卡；有素材时叠在实拍上，没素材才整段替代画面 */
  infoCard?: CardSpec;
  /** 没检索到可用素材，合成时改用设计卡 */
  fallback?: boolean;
}

export interface MaterialManifest {
  source: string;
  /** 来源 + 画幅 + 时长门槛，变了清单不可复用 */
  signature?: string;
  items: MaterialItem[];
}

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageState {
  id: string;
  /** 后端写入的中文名；界面按 id 从词典取词，这里只作兜底 */
  label: string;
  status: StageStatus;
  /** 落盘的中文摘要；老任务只有这个 */
  message?: string;
  /** 结构化摘要，有它时按当前语言现拼 */
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

export type CardKind = "intro" | "chapter" | "outro" | "quote";

/** 对比卡的一栏 */
export interface CompareSide {
  name: string;
  stance: string;
  note?: string;
  /** 台词里能定位到这一栏的原句片段 */
  quote?: string;
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

/** 逐条上屏的要点 */
export interface CardBeat {
  text: string;
  quote: string;
}

export interface CardSpec {
  id: string;
  kind: CardKind;
  compositionId: string;
  /** 章节卡关联的段号 */
  paragraph?: number;
  title: string;
  label: string;
  handle?: string;
  accent: string;
  durationSec: number;
  fingerprint?: string;
  videoPath?: string;
  stillPath?: string;

  // 信息卡专用的渲染参数，前端不读取，但要与后端定义保持一致
  avatar?: string;
  role?: string;
  line?: string;
  compare?: { left: CompareSide; right: CompareSide };
  rightAccent?: string;
  timeline?: TimelineItem[];
  stat?: { value: string; caption?: string; note?: string; bars?: StatBar[] };
  beats?: CardBeat[];
  /** 信息卡底图（素材帧的 data URI） */
  bgImage?: string;
}

export interface CardManifest {
  items: CardSpec[];
  signature?: string;
  style?: string;
}

/**
 * 版式生成偏好：手动改过才写；字段缺省表示跟随 AI 与配置。
 * 时长是绝对取值：0 = 这次不要这类卡。
 */
export interface CardPrefs {
  accent?: string;
  introDurationSec?: number;
  chapterDurationSec?: number;
  outroDurationSec?: number;
}

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

export interface LogLine {
  time: string;
  level: "info" | "warn" | "error";
  text: string;
  /** 所属阶段，任务级日志没有 */
  stage?: string;
}

export interface TaskState {
  id: string;
  input: string;
  options: {
    promptSource: string;
    speakers: SpeakerNames;
    ttsEngine: string;
    voice: string;
    materialSource: string;
    /** 素材匹配后是否配信息卡；旧任务没有这个字段，按开启处理 */
    autoInfoCards?: boolean;
    width: number;
    height: number;
    fps: number;
    ttsSpeed: number;
    /** 未设置则用配置默认值 */
    subtitleFontSize?: number;
    bgmEnabled?: boolean;
    bgmVolume?: number;
    /** 空表示用默认 */
    bgmFile?: string;
  };
  workspace: string;
  status: TaskStatus;
  stages: StageState[];
  logs: LogLine[];
  transcript: Transcript | null;
  audio: AudioManifest | null;
  material: MaterialManifest | null;
  /** 关闭版式阶段时为 null */
  cards: CardManifest | null;
  /** 手动指定的配色与章节时长；null 表示没选过 */
  cardPrefs: CardPrefs | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** 最近一次重跑阶段的时刻（毫秒），用于清掉上一轮的日志 */
  runStartedAt?: number;
}
