export type PromptSource = "podcast" | "crosstalk" | "talkshow";
export type TtsEngine = "cosyvoice" | "edge" | "seedtts";
export type MaterialSource = "pixabay" | "pexels";

export interface GenerateOptions {
  promptSource: PromptSource;
  /** 剧本里的两个角色名（主讲 / 追问），默认取配置项 */
  speakers: { main: string; guest: string };
  ttsEngine: TtsEngine;
  /** 默认音色；实际按角色分配时优先用 voiceMap */
  voice: string;
  /** 角色 → 音色，确认剧本时由前端指定 */
  voiceMap?: Record<string, string>;
  materialSource: MaterialSource;
  width: number;
  height: number;
  fps: number;
  ttsSpeed: number;
  /** 成片渲染参数：undefined 表示用配置里的默认值，可在「成片预览」页改后重新生成 */
  /** 字幕字号（px），0 = 按画宽自动 */
  subtitleFontSize?: number;
  /** 是否混入 BGM */
  bgmEnabled?: boolean;
  bgmVolume?: number;
  /**
   * 任务级自定义 BGM：绝对路径，或音乐目录（AISV_MUSIC_DIR）下的文件名。
   * 在「成片预览」页指定，留空表示沿用配置里的 BGM 开关 + 程序合成。
   */
  bgmFile?: string;
}

/** 「成片预览」页点「生成成片」时下发的渲染参数 */
export interface RenderPatch {
  subtitleFontSize?: number;
  bgmEnabled?: boolean;
  bgmVolume?: number;
  bgmFile?: string;
}

/** 内部剧本：已按标点分句，可直接进入配音与字幕 */
export interface Dialogue {
  speaker: string;
  /** 展示/字幕文本 */
  contents: string[];
  /** 送 TTS 的文本（可带情绪/语气标签），与 contents 一一对应 */
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

/** LLM 产出的原始剧本（未分句），落盘格式与 Python 版一致 */
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

/** 配音产物清单，供素材匹配与合成阶段消费 */
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
}

/** 匹配到的素材 */
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
  /** 下载后的本地路径 */
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
  /** 日志属于哪个阶段，前端按步骤过滤时用；任务级日志不带 */
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

/** 传给流水线各阶段的上下文 */
export interface TaskContext {
  input: string;
  options: GenerateOptions;
  workspace: string;
  signal: AbortSignal;
  log: (text: string, level?: LogLine["level"]) => void;
  markStage: (id: string, status: StageStatus, message?: string) => void;
}
