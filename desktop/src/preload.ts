import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aisv", {
  platform: process.platform,
  /** 菜单动作交给主进程执行 */
  menu: (action: string) => ipcRenderer.invoke("app:menu", action) as Promise<{ ok: boolean; error?: string }>,
  /** 主进程拦下 Ctrl+N 后回调 */
  onNewTask: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("app:new-task", listener);
    return () => ipcRenderer.off("app:new-task", listener);
  },
  getConfig: () => ipcRenderer.invoke("settings:get") as Promise<Record<string, string>>,
  saveConfig: (values: Record<string, string>) =>
    ipcRenderer.invoke("settings:save", values) as Promise<{ ok: boolean; file: string }>,
  /** config 为表单当前值，未落盘也能试 */
  testConfig: (target: "llm" | "dashscope", config: Record<string, string>) =>
    ipcRenderer.invoke("settings:test", target, config) as Promise<{ ok: boolean; ms: number; message: string }>,
  /** reused 表示后端由外部启动，无法重启 */
  restartBackend: () =>
    ipcRenderer.invoke("settings:restart") as Promise<{ ok: boolean; reused?: boolean; error?: string }>,
  /** 取消返回空串 */
  pickMusic: () => ipcRenderer.invoke("music:pick") as Promise<string>,
  /** 在资源管理器中定位 */
  revealFile: (file: string) => ipcRenderer.invoke("app:reveal-file", file) as Promise<{ ok: boolean; error?: string }>,
  /** 用系统默认程序打开配置文件 */
  openConfigFile: () => ipcRenderer.invoke("app:open-config-file") as Promise<{ ok: boolean; error?: string }>,
  /**
   * 把实际生效的深浅主题告诉主进程。
   * 窗口右上角的按钮区由原生绘制，渲染层改不到。
   */
  setWindowTheme: (theme: "light" | "dark") => {
    ipcRenderer.send("app:window-theme", theme);
  },
  /** 别的窗口改了外观时通知本窗口 */
  onThemeChanged: (handler: (theme: "light" | "dark" | "system") => void) => {
    const listener = (_event: unknown, theme: "light" | "dark" | "system") => handler(theme);
    ipcRenderer.on("app:theme-changed", listener);
    return () => ipcRenderer.off("app:theme-changed", listener);
  },
  announceTheme: (theme: "light" | "dark" | "system") => {
    ipcRenderer.send("app:theme-changed", theme);
  },
  getTheme: () => ipcRenderer.invoke("app:theme-get") as Promise<"light" | "dark" | "system">,
  /** 关掉当前窗口 */
  closeWindow: () => ipcRenderer.invoke("app:close-self") as Promise<void>,
  /**
   * 别的窗口改了界面语言时通知本窗口。
   * 各窗口不同源，localStorage 不互通，只能靠主进程转发。
   */
  onLanguageChanged: (handler: (language: "zh" | "en" | "system") => void) => {
    const listener = (_event: unknown, language: "zh" | "en" | "system") => handler(language);
    ipcRenderer.on("app:language-changed", listener);
    return () => ipcRenderer.off("app:language-changed", listener);
  },
  /** 改语言后广播给其他窗口 */
  announceLanguage: (language: "zh" | "en" | "system") => {
    ipcRenderer.send("app:language-changed", language);
  },
  /** 新窗口打开时取当前偏好，避免不同源导致显示错语言 */
  getLanguage: () => ipcRenderer.invoke("app:language-get") as Promise<"zh" | "en" | "system">,
  /** 关于卡片的版本号与仓库地址 */
  aboutInfo: () =>
    ipcRenderer.invoke("app:about-info") as Promise<{
      repo: string;
      versions: { key: string; value: string }[];
    }>,
  /** 用系统浏览器打开外部链接 */
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url) as Promise<{ ok: boolean }>,
  close: () => ipcRenderer.invoke("settings:close") as Promise<void>,
});
