import type { WinKey } from "./win.zh";

/** win 命名空间的英文字典，键由 zh 侧约束。 */
export const win = {
  close: "Close",
  maximize: "Maximize",
  minimize: "Minimize",
} satisfies Record<WinKey, string>;
