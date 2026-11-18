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
}

export type MenuAction =
  | "settings"
  | "output-dir"
  | "data-dir"
  | "config-file"
  | "quit"
  | "about"
  | "docs"
  | "feedback";

export function bridge(): AisvBridge | null {
  return (window as unknown as { aisv?: AisvBridge }).aisv ?? null;
}
