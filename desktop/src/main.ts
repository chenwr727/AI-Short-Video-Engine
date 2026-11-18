import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import { configFile, DEFAULTS, ensureConfig, loadConfig, saveConfig, type AppConfig } from "./config";
import { isPortable, setupPortableMode } from "./paths";
import { findFreePort, startBackend, type Backend } from "./server";

setupPortableMode();

const DEV = !app.isPackaged;
const FIXED_DEV_PORT = 4000;

/** 打包后在 asar 的 assets 下 */
function appIcon(): string | undefined {
  const file = path.join(__dirname, "..", "assets", "icon.png");
  return fs.existsSync(file) ? file : undefined;
}

let backend: Backend | null = null;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

interface HealthPayload {
  ok: boolean;
  version: string;
  dataDir: string;
  outDir: string;
  config: { llm: { baseUrl: string; model: string; configured: boolean } };
  deps: { ffmpeg: string | null; ffprobe: string | null };
}

async function ping(url: string, ms = 800): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function health(): Promise<HealthPayload | null> {
  if (!backend) return null;
  try {
    const res = await fetch(`${backend.baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  }
}

async function ensureBackend(): Promise<Backend> {
  if (backend && (backend.proc === null || backend.proc.exitCode === null)) return backend;

  // 开发态已有后端则复用
  if (DEV && (await ping(`http://127.0.0.1:${FIXED_DEV_PORT}/api/health`))) {
    console.log(`[desktop] 复用已在运行的后端 :${FIXED_DEV_PORT}`);
    backend = {
      port: FIXED_DEV_PORT,
      baseUrl: `http://127.0.0.1:${FIXED_DEV_PORT}`,
      proc: null,
      stop: () => {},
    };
    return backend;
  }

  const port = DEV ? FIXED_DEV_PORT : await findFreePort();
  backend = await startBackend(port, (line) => console.log("[server]", line));
  return backend;
}

/** 与 index.css 的 .titlebar 高度一致 */
const HEADER_HEIGHT = 36;

function createMainWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f7fb",
    title: "AI 短视频生成器",
    icon: appIcon(),
    // 菜单由渲染层绘制
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 22 } }
      : { titleBarOverlay: { color: "#f4f7fb", symbolColor: "#3b4a5f", height: HEADER_HEIGHT } }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 菜单在渲染层，快捷键在此兜住
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (!(input.control || input.meta)) return;
    if (input.key === ",") {
      event.preventDefault();
      createSettingsWindow();
    } else if (input.key.toLowerCase() === "o") {
      event.preventDefault();
      void outDir().then(openDir);
    } else if (input.key.toLowerCase() === "n") {
      // 默认会开新窗口，改为通知渲染层
      event.preventDefault();
      win.webContents.send("app:new-task");
    }
  });

  win.loadURL(url).catch((e) => {
    dialog.showErrorBox("加载失败", String(e));
  });
  win.once("ready-to-show", () => {
    win.show();
    if (DEV && process.env.AISV_OPEN_DEVTOOLS === "1") win.webContents.openDevTools({ mode: "detach" });
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  return win;
}

/** 主窗口显示后再挂模态子窗口，否则设置页可能白屏 */
function waitForMainShown(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isVisible()) return Promise.resolve();
  return new Promise((resolve) => win.once("ready-to-show", () => resolve()));
}

async function openPath(target: string): Promise<void> {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, "{}\n", "utf-8");
  const err = await shell.openPath(target);
  if (err) dialog.showErrorBox("打开失败", err);
}

async function openDir(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) dialog.showErrorBox("打开失败", err);
}

const REPO_URL = "https://github.com/chenwr727/AI-Short-Video-Engine";
const DOCS_URL = `${REPO_URL}#工作流`;
const FEEDBACK_URL = `${REPO_URL}/issues`;

/** 用系统浏览器打开 */
async function openExternal(url: string): Promise<void> {
  await shell.openExternal(url);
}

async function outDir(): Promise<string> {
  const h = await health();
  return h?.outDir ?? path.join(app.getPath("userData"), "data", "out");
}

async function dataDir(): Promise<string> {
  const h = await health();
  return h?.dataDir ?? path.join(app.getPath("userData"), "data");
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 800,
    height: 840,
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    show: false,
    title: "设置",
    backgroundColor: "#f4f7fb",
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win
    .loadFile(path.join(__dirname, "..", "assets", "settings.html"))
    .catch((e) => dialog.showErrorBox("无法打开设置", String(e)));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow = win;
}

/** 重启前等旧进程真正退出 */
async function waitBackendDown(timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await ping(`http://127.0.0.1:${FIXED_DEV_PORT}/api/health`, 300))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function registerSettingsIpc(): void {
  // __defaults 供「恢复默认值」按钮使用
  ipcMain.handle("settings:get", () => ({
    ...loadConfig(),
    __file: configFile(),
    __defaults: DEFAULTS,
  }));

  ipcMain.handle("settings:save", (_event, values: Record<string, string>) => {
    const allowed = new Set(Object.keys(DEFAULTS));
    const next: AppConfig = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (allowed.has(key) && typeof value === "string") next[key] = value;
    }
    saveConfig(next);
    return { ok: true, file: configFile() };
  });

  /** 带表单当前值，未保存也能试 */
  ipcMain.handle("settings:test", async (_event, target: string, config: Record<string, string>) => {
    const b = backend;
    if (!b) return { ok: false, ms: 0, message: "后端未启动" };
    try {
      const res = await fetch(`${b.baseUrl}/api/config-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, config }),
        signal: AbortSignal.timeout(40_000),
      });
      const data = (await res.json()) as { ok?: boolean; ms?: number; message?: string; error?: string };
      if (!res.ok) return { ok: false, ms: 0, message: data.error ?? `HTTP ${res.status}` };
      return { ok: Boolean(data.ok), ms: data.ms ?? 0, message: data.message ?? "" };
    } catch (error) {
      return { ok: false, ms: 0, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("settings:restart", async () => {
    // 外部启动的后端停不掉，回报 reused 让界面提示手动重启
    if (backend !== null && backend.proc === null) {
      return { ok: true, reused: true };
    }
    try {
      backend?.stop();
      backend = null;
      if (DEV) await waitBackendDown();
      const next = await ensureBackend();
      await mainWindow?.loadURL(next.baseUrl);
      return { ok: true, reused: false };
    } catch (error) {
      return { ok: false, reused: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("settings:close", () => {
    settingsWindow?.close();
  });
}

/** macOS 需要应用菜单，其余交给渲染层 */
function buildMenu(): void {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]));
    return;
  }
  Menu.setApplicationMenu(null);
}

async function showAbout(): Promise<void> {
  const h = await health();
  const options = {
    type: "info" as const,
    title: "关于",
    message: "AI 短视频生成器",
    detail:
      "链接 → 剧本 → 配音 → 素材 → 成片，全流程自动跑。\n\n" +
      `桌面版 ${app.getVersion()}\n` +
      `后端 ${h?.version ?? "未连接"}\n` +
      `Electron ${process.versions.electron}\n` +
      `Chromium ${process.versions.chrome}\n` +
      `Node ${process.versions.node}`,
    buttons: ["知道了"],
  };
  if (mainWindow) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

/** 渲染层菜单发来的动作 */
function registerAppIpc(): void {
  ipcMain.handle("app:menu", async (_event, action: unknown) => {
    switch (action) {
      case "settings":
        createSettingsWindow();
        return { ok: true };
      case "output-dir":
        await outDir().then(openDir);
        return { ok: true };
      case "data-dir":
        await dataDir().then(openDir);
        return { ok: true };
      case "config-file":
        await openPath(configFile());
        return { ok: true };
      case "quit":
        app.quit();
        return { ok: true };
      case "about":
        await showAbout();
        return { ok: true };
      case "docs":
        await openExternal(DOCS_URL);
        return { ok: true };
      case "feedback":
        await openExternal(FEEDBACK_URL);
        return { ok: true };
      default:
        return { ok: false, error: `未知菜单项：${String(action)}` };
    }
  });

  /** 取消返回空串 */
  ipcMain.handle("music:pick", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "选择背景音乐",
      properties: ["openFile"],
      filters: [
        { name: "音频文件", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    };
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return "";
    return result.filePaths[0] ?? "";
  });

  /** 在资源管理器中定位文件 */
  ipcMain.handle("app:reveal-file", (_event, target: unknown) => {
    const file = typeof target === "string" ? target : "";
    if (!file || !fs.existsSync(file)) return { ok: false, error: "成片文件不存在" };
    shell.showItemInFolder(file);
    return { ok: true };
  });
}

async function bootstrap(): Promise<void> {
  ensureConfig();
  const b = await ensureBackend();
  mainWindow = createMainWindow(b.baseUrl);

  const h = await health();
  // 未填 LLM Key 视为首次打开，直接弹配置页
  const needSetup = Boolean(h && !h.config.llm.configured);
  if (needSetup || process.env.AISV_OPEN_SETTINGS === "1") {
    await waitForMainShown();
    createSettingsWindow();
  }

  // 配置页已弹出时不再叠对话框
  if (h && !h.deps.ffmpeg && !needSetup) {
    await dialog.showMessageBox({
      type: "warning",
      title: "缺少 ffmpeg",
      message: "未检测到 ffmpeg，合成视频会失败。",
      detail: `开发态请安装系统 ffmpeg；打包态会把 ffmpeg 放进 resources/bin。`,
      buttons: ["知道了"],
    });
  }
}

app.on("before-quit", () => {
  backend?.stop();
  backend = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const b = await ensureBackend();
    mainWindow = createMainWindow(b.baseUrl);
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("com.aisv.app");
    registerSettingsIpc();
    registerAppIpc();
    buildMenu();
    try {
      await bootstrap();
      if (isPortable()) console.log("[desktop] 当前为免安装模式");
    } catch (e) {
      dialog.showErrorBox("启动失败", String(e instanceof Error ? e.message : e));
      app.quit();
    }
  });
}
