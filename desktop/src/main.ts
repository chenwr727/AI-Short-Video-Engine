import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from "electron";
import {
  configFile,
  DEFAULTS,
  ensureConfig,
  loadConfig,
  loadUi,
  saveConfig,
  saveUi,
  type AppConfig,
  type UiPreferences,
} from "./config";
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
let promptsWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;

/** 广播界面偏好，跳过发起窗口 —— 它自己已经切过了，回声会多一次重绘 */
function broadcast<T>(origin: Electron.WebContents, channel: string, value: T): void {
  for (const target of [mainWindow, settingsWindow, promptsWindow, aboutWindow]) {
    if (!target || target.isDestroyed()) continue;
    if (target.webContents === origin) continue;
    target.webContents.send(channel, value);
  }
}

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

/**
 * 窗口底色与系统按钮区配色，与 web/src/styles/tokens.css 的
 * --aisv-bg-base / --aisv-label-secondary 保持一致。
 *
 * 这两处颜色只能由主进程设：窗口背景在页面加载前就要画出来，
 * 右上角的按钮区是原生绘制的，CSS 管不到。
 */
const WINDOW_THEME = {
  light: { bg: "#ffffff", symbol: "#61666b" },
  dark: { bg: "#151517", symbol: "#cfd3d6" },
} as const;

type WindowTheme = keyof typeof WINDOW_THEME;

/** 偏好解析成实际深浅，跟随系统时读系统 */
function resolveWindowTheme(preference: UiPreferences["theme"]): WindowTheme {
  if (preference === "light" || preference === "dark") return preference;
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function createMainWindow(url: string): BrowserWindow {
  // 铺底跟随用户选的外观；按系统铺底会在「选浅色 + 系统深色」时闪一下深色
  const palette = WINDOW_THEME[resolveWindowTheme(loadUi().theme)];
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: palette.bg,
    title: "AI 短视频生成器",
    icon: appIcon(),
    // 菜单由渲染层绘制
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 22 } }
      : {
          titleBarOverlay: {
            color: palette.bg,
            symbolColor: palette.symbol,
            height: HEADER_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  /*
   * 渲染层切主题时把结果发回来，重新给窗口按钮区配色。
   * Windows 上 setTitleBarOverlay 可直接改；macOS 是交通灯按钮，跟随系统，
   * 不需要也不支持这个调用。
   */
  ipcMain.on("app:window-theme", (event, theme: unknown) => {
    if (event.sender !== win.webContents) return;
    if (theme !== "light" && theme !== "dark") return;
    const palette = WINDOW_THEME[theme as WindowTheme];
    win.setBackgroundColor(palette.bg);
    if (process.platform !== "darwin") {
      win.setTitleBarOverlay({ color: palette.bg, symbolColor: palette.symbol, height: HEADER_HEIGHT });
    }
  });

  /*
   * 界面偏好的转发。
   *
   * 设置页在 file:// 下、主窗口在 http://127.0.0.1:port，两者 localStorage
   * 完全隔离。所以真源放 ui.json：写入方落盘，主进程广播给其他窗口。
   */
  ipcMain.handle("app:language-get", () => loadUi().language);

  ipcMain.on("app:language-changed", (event, language: unknown) => {
    if (language !== "zh" && language !== "en" && language !== "system") return;
    saveUi({ language });
    broadcast(event.sender, "app:language-changed", language);
  });

  ipcMain.handle("app:theme-get", () => loadUi().theme);

  ipcMain.on("app:theme-changed", (event, theme: unknown) => {
    if (theme !== "light" && theme !== "dark" && theme !== "system") return;
    saveUi({ theme });
    broadcast(event.sender, "app:theme-changed", theme);
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
    } else if (input.key.toLowerCase() === "p") {
      event.preventDefault();
      createPromptsWindow();
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

/**
 * 设置：无边框模态面板，居中盖在主窗口上。
 *
 * 固定尺寸、圆角、不能缩放拖动。
 * 用无边框而不是系统标题栏 —— 系统标题栏会带最小化/最大化按钮，
 * 而「放大缩小」对一个固定版式的设置面板没有意义。
 */
const SETTINGS_SIZE = { width: 824, height: 760 };

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const parent = mainWindow;
  // 居中于主窗口，主窗口不在时居中于屏幕
  let x: number | undefined;
  let y: number | undefined;
  if (parent) {
    const b = parent.getBounds();
    x = Math.round(b.x + (b.width - SETTINGS_SIZE.width) / 2);
    y = Math.round(b.y + (b.height - SETTINGS_SIZE.height) / 2);
  }

  const win = new BrowserWindow({
    ...SETTINGS_SIZE,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    parent: parent ?? undefined,
    /*
     * 不用 modal。Windows 上 modal 子窗会让父窗口被系统禁用，
     * 关闭时再重新激活，主界面会因此整窗重绘、闪一下。
     * 设了 parent 已经能保证它始终压在主窗口之上。
     */
    modal: false,
    show: false,
    // 无边框 + 不可缩放：没有标题栏和最大化按钮
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "首选项",
    // 面板自带圆角，窗口透明才能看出圆角
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
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

/**
 * 提示词编辑器：独立无边框窗口。
 *
 * 和设置面板同一套做法：窗口透明、页面自己画圆角和标题栏。
 * 系统标题栏的灰底和主窗口的新配色对不上，而且它只出现在这一个窗口上，
 * 看起来像另一个程序。标题栏画在页面里就能跟着深浅主题走。
 */
function createPromptsWindow(): void {
  if (promptsWindow) {
    if (promptsWindow.isMinimized()) promptsWindow.restore();
    promptsWindow.focus();
    return;
  }

  const SIZE = { width: 1040, height: 760 };
  let x: number | undefined;
  let y: number | undefined;
  if (mainWindow) {
    const b = mainWindow.getBounds();
    x = Math.round(b.x + (b.width - SIZE.width) / 2);
    y = Math.round(b.y + (b.height - SIZE.height) / 2);
  }

  const win = new BrowserWindow({
    ...SIZE,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    parent: mainWindow ?? undefined,
    show: false,
    title: "提示词",
    // 和设置面板保持一致：无边框、固定尺寸，只有面板里那一个关闭钮
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const base = backend?.baseUrl;
  if (!base) {
    dialog.showErrorBox("无法打开提示词", "后端未启动。");
    win.destroy();
    return;
  }

  win.loadURL(`${base}/prompts.html`).catch((e) => dialog.showErrorBox("无法打开提示词", String(e)));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    promptsWindow = null;
  });
  promptsWindow = win;
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

/** 关于：自绘卡片，和设置面板同一套做法（透明窗口 + 页面画圆角） */
const ABOUT_SIZE = { width: 420, height: 360 };

function createAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  const parent = mainWindow;
  let x: number | undefined;
  let y: number | undefined;
  if (parent) {
    const b = parent.getBounds();
    x = Math.round(b.x + (b.width - ABOUT_SIZE.width) / 2);
    y = Math.round(b.y + (b.height - ABOUT_SIZE.height) / 2);
  }

  const win = new BrowserWindow({
    ...ABOUT_SIZE,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    parent: parent ?? undefined,
    modal: Boolean(parent),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "关于",
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
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
    .loadFile(path.join(__dirname, "..", "assets", "about.html"))
    .catch((e) => dialog.showErrorBox("无法打开关于", String(e)));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    aboutWindow = null;
  });
  aboutWindow = win;
}

/** 渲染层菜单发来的动作 */
function registerAppIpc(): void {
  ipcMain.handle("app:menu", async (_event, action: unknown) => {
    switch (action) {
      case "settings":
        createSettingsWindow();
        return { ok: true };
      case "prompts":
        createPromptsWindow();
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
        createAboutWindow();
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

  /** 关掉发起请求的窗口（提示词独立窗口的「取消」） */
  ipcMain.handle("app:close-self", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 页面里点链接交给系统浏览器，不在应用内开新窗口 */
  ipcMain.handle("app:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  /** 设置页顶栏的「配置文件」：用系统默认程序打开 */
  ipcMain.handle("app:open-config-file", async () => {
    try {
      await openPath(configFile());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** 关于卡片要的版本号与仓库地址 */
  ipcMain.handle("app:about-info", async () => {
    const h = await health();
    return {
      repo: REPO_URL,
      // key 用稳定标识，渲染层拼成 about.version.<key> 再取词；
      // 直接传中文会让翻译查不到，语言切换后仍然是中文
      versions: [
        { key: "desktop", value: app.getVersion() },
        { key: "backend", value: h?.version ?? "" },
        { key: "electron", value: process.versions.electron },
        { key: "chromium", value: process.versions.chrome },
        { key: "node", value: process.versions.node },
      ],
    };
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
