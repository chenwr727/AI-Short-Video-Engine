import type { RenderKey } from "./render.zh";

/** render 命名空间的英文字典，键由 zh 侧约束。 */
export const render = {
  backFirst: "Back to step one",
  bgmPlaceholder: "Leave blank for the built-in track, or enter a filename from the music folder",
  defaultMusic: "default music",
  empty: "The final cut appears here once generated.",
  fontSize: "Subtitle size",
  generate: "Generate final cut",
  generating: "Compositing…",
  hint: "The final cut is saved locally. Change the parameters above and regenerate — voiceover and footage don't need to rerun.",
  hintNoTts: "Footage is ready. Set subtitles and background music, then hit Generate final cut.",
  log: "Run log",
  noBgm: "No background music",
  noSpeakers: "The script has no characters yet.",
  noTask: "No task yet. Go back to step one and generate a script.",
  params: "Render parameters",
  scriptLabel: "Script",
  summary: "Subtitles {size}px · {bgm}{music}",
} satisfies Record<RenderKey, string>;
