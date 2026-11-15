import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aisv", {
  platform: process.platform,
  /** 渲染层菜单（文件 / 帮助）把动作交给主进程执行 */
  menu: (action: string) => ipcRenderer.invoke("app:menu", action) as Promise<{ ok: boolean; error?: string }>,
  getConfig: () => ipcRenderer.invoke("settings:get") as Promise<Record<string, string>>,
  saveConfig: (values: Record<string, string>) =>
    ipcRenderer.invoke("settings:save", values) as Promise<{ ok: boolean; file: string }>,
  restartBackend: () => ipcRenderer.invoke("settings:restart") as Promise<{ ok: boolean; error?: string }>,
  /** 成片页选自定义 BGM，取消返回空串 */
  pickMusic: () => ipcRenderer.invoke("music:pick") as Promise<string>,
  /** 在资源管理器/访达里定位到成片文件 */
  revealFile: (file: string) =>
    ipcRenderer.invoke("app:reveal-file", file) as Promise<{ ok: boolean; error?: string }>,
  close: () => ipcRenderer.invoke("settings:close") as Promise<void>,
});
