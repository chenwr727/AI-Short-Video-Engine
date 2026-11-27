import type { MenuKey } from "./menu.zh";

/** menu 命名空间的英文字典，键由 zh 侧约束。 */
export const menu = {
  about: "About",
  dataDir: "Open data folder",
  docs: "Documentation",
  feedback: "Report an issue",
  file: "File",
  help: "Help",
  newTask: "New video",
  outputDir: "Open output folder",
  preferences: "Preferences…",
  prompts: "Prompts…",
  quit: "Quit",
  settings: "Settings",
} satisfies Record<MenuKey, string>;
