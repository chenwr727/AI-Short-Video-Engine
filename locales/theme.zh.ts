/** theme 命名空间的中文字典，也是这一组键的真源。 */
export const theme = {
  appearance: "外观",
  dark: "深色",
  light: "浅色",
  system: "跟随系统",
} satisfies Record<string, string>;

export type ThemeKey = keyof typeof theme;
