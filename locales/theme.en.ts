import type { ThemeKey } from "./theme.zh";

/** theme 命名空间的英文字典，键由 zh 侧约束。 */
export const theme = {
  appearance: "Appearance",
  dark: "Dark",
  light: "Light",
  system: "System",
} satisfies Record<ThemeKey, string>;
