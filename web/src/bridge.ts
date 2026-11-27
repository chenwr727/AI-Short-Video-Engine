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
  /**
   * 同步实际生效的深浅主题给主进程。
   * 右上角的系统窗口按钮是原生画的，只有主进程改得动。
   */
  setWindowTheme?: (theme: "light" | "dark") => void;
  /** 关掉当前窗口 */
  closeWindow?: () => Promise<void>;
  /**
   * 别的窗口改了界面语言时回调。
   * 设置页在 file:// 下、主窗口在 http:// 下，localStorage 不互通，只能靠主进程转发。
   */
  onLanguageChanged?: (handler: (language: "zh" | "en" | "system") => void) => () => void;
  /** 改语言后交给主进程落盘并广播 */
  announceLanguage?: (language: "zh" | "en" | "system") => void;
  /** 启动时取真实偏好 */
  getLanguage?: () => Promise<"zh" | "en" | "system">;
}

export type MenuAction = "settings" | "prompts" | "output-dir" | "data-dir" | "quit" | "about" | "docs" | "feedback";

export function bridge(): AisvBridge | null {
  return (window as unknown as { aisv?: AisvBridge }).aisv ?? null;
}
