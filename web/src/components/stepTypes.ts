export interface FormState {
  content: string;
  promptSource: string;
  /** 主讲 */
  speakerMain: string;
  /** 追问 */
  speakerGuest: string;
}

export interface RenderFormState {
  ttsEngine: string;
  /** 1 = 原速 */
  ttsSpeed: number;
  materialSource: string;
  resolution: string;
  voices: Record<string, string>;
}
