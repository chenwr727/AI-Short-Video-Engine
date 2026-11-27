import type { ResultKey } from "./result.zh";

/** result 命名空间的英文字典，键由 zh 侧约束。 */
export const result = {
  again: "Make another",
  bgmToggle: "Add background music (unchecked keeps voiceover only)",
  bgmVolume: "Music volume (0–2, default 0.1)",
  customMusic: "Custom track",
  download: "Download",
  fontHint:
    "Font size is computed from the frame width ({n}px at {w}×{h}) and can be edited. Changing it re-renders the segments; changing only the music reuses them and just remixes.",
  hint: "The final cut is ready, using the clips below. To change footage, hit Regenerate above with a new source.",
  noOutput: "No final cut yet.",
  noTask: "No task yet. Generate a script and confirm footage first.",
  revealFailed: "Couldn't reveal the file",
  showInFolder: "Show in folder",
  title: "Final cut",
} satisfies Record<ResultKey, string>;
