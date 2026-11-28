/** Electron preload 暴露的桥，浏览器里为 null */
export interface AisvBridge {
  platform: string;
  menu: (action: MenuAction) => Promise<{ ok: boolean; error?: string }>;
  /** Ctrl+N 由主进程拦下后回调 */
  onNewTask?: (handler: () => void) => () => void;
  /** 选本地音频当 BGM，取消返回空串 */
  pickMusic?: () => Promise<string>;
  /** 在文件管理器中定位成片 */
  revealFile?: (file: string) => Promise<{ ok: boolean; error?: string }>;
  /** 右上角窗口按钮由原生绘制，只有主进程改得动 */
  setWindowTheme?: (theme: "light" | "dark") => void;
  /** 拿到的是偏好而非解析结果 */
  onThemeChanged?: (handler: (theme: "light" | "dark" | "system") => void) => () => void;
  announceTheme?: (theme: "light" | "dark" | "system") => void;
  getTheme?: () => Promise<"light" | "dark" | "system">;
  /** 关掉当前窗口 */
  closeWindow?: () => Promise<void>;
  /** 各窗口不同源，语言变更只能靠主进程转发 */
  onLanguageChanged?: (handler: (language: "zh" | "en" | "system") => void) => () => void;
  announceLanguage?: (language: "zh" | "en" | "system") => void;
  getLanguage?: () => Promise<"zh" | "en" | "system">;
  onConfigChanged?: (handler: () => void) => () => void;
  announceConfigChanged?: () => void;
}

export type MenuAction = "settings" | "prompts" | "output-dir" | "data-dir" | "quit" | "about" | "docs" | "feedback";

export function bridge(): AisvBridge | null {
  return (window as unknown as { aisv?: AisvBridge }).aisv ?? null;
}
