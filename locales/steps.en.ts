import type { StepsKey } from "./steps.zh";

/** steps 命名空间的英文字典，键由 zh 侧约束。 */
export const steps = {
  backTo: "Back to “{step}”",
  content: "Content",
  contentDesc: "Paste a link or text",
  material: "Footage",
  materialDesc: "Match clips · intro & chapters",
  render: "Final cut",
  renderDesc: "Render settings · playback",
  script: "Script",
  scriptDesc: "Pick a style · AI writes",
  tts: "Voice",
  ttsDesc: "Sentence by sentence · voices",
} satisfies Record<StepsKey, string>;
