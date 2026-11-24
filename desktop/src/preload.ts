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
  /** config 为表单当前值，未保存也能试 */
  testConfig: (target: "llm" | "dashscope", config: Record<string, string>) =>
    ipcRenderer.invoke("settings:test", target, config) as Promise<{ ok: boolean; ms: number; message: string }>,
  /** reused 表示后端由外部启动，无法重启 */
  restartBackend: () =>
    ipcRenderer.invoke("settings:restart") as Promise<{ ok: boolean; reused?: boolean; error?: string }>,
  /** 取消返回空串 */
  pickMusic: () => ipcRenderer.invoke("music:pick") as Promise<string>,
  /** 在资源管理器中定位 */
  revealFile: (file: string) => ipcRenderer.invoke("app:reveal-file", file) as Promise<{ ok: boolean; error?: string }>,
  /** 关掉当前窗口（提示词独立窗口用） */
  closeWindow: () => ipcRenderer.invoke("app:close-self") as Promise<void>,
  close: () => ipcRenderer.invoke("settings:close") as Promise<void>,
});
