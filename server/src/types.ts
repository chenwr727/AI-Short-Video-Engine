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
}

export interface MaterialItem extends MaterialInfo {
  paragraph: number;
  searchTerms: string[];
}

export interface MaterialManifest {
  source: MaterialSource;
  items: MaterialItem[];
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
