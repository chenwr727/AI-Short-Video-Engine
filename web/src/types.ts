export interface Option {
  id: string;
  label: string;
  description?: string;
  /** 该脚本风格有几个角色（脱口秀为单人） */
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
  /** 角色名的配置默认值 */
  speakers: SpeakerNames;
  ttsEngines: TtsEngineOption[];
  /** 配音语速默认值（配置项 TTS_SPEED） */
  ttsSpeed: number;
  /** 成片预览页的渲染默认值 */
  render: {
    subtitleFontSize: number;
    bgmEnabled: boolean;
    bgmVolume: number;
  };
  materialSources: Option[];
  resolutions: Option[];
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
}

export interface MaterialItem extends MaterialInfo {
  paragraph: number;
  searchTerms: string[];
}

export interface MaterialManifest {
  source: string;
  items: MaterialItem[];
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
}

export interface LogLine {
  time: string;
  level: "info" | "warn" | "error";
  text: string;
  /** 属于哪个阶段；任务级日志没有这个字段 */
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
    width: number;
    height: number;
    fps: number;
    ttsSpeed: number;
    /** 成片预览页的渲染参数；未设置表示用配置默认值 */
    subtitleFontSize?: number;
    bgmEnabled?: boolean;
    bgmVolume?: number;
    /** 成片页选的自定义 BGM；空表示用默认 BGM */
    bgmFile?: string;
  };
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
