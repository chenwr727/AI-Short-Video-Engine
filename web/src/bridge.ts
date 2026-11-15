/** Electron 主进程通过 preload 暴露的桥；浏览器里打开时是 null */
export interface AisvBridge {
  platform: string;
  menu: (action: MenuAction) => Promise<{ ok: boolean; error?: string }>;
  /** 选本地音频文件当 BGM，取消返回空串（浏览器里没有） */
  pickMusic?: () => Promise<string>;
  /** 在系统文件管理器里定位成片（浏览器里没有） */
  revealFile?: (file: string) => Promise<{ ok: boolean; error?: string }>;
}

export type MenuAction = "settings" | "output-dir" | "config-file" | "quit" | "about";

export function bridge(): AisvBridge | null {
  return (window as unknown as { aisv?: AisvBridge }).aisv ?? null;
}
