import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../paths.js";
import { runFfmpeg } from "./ffmpeg.js";

/** 找 remotion 子工程：开发态在仓库根，打包态可被 AISV_REMOTION_DIR 覆盖 */
export function remotionDir(): string | null {
  const candidates = [
    process.env.AISV_REMOTION_DIR,
    path.join(process.cwd(), "..", "remotion"),
    path.join(process.cwd(), "remotion"),
    path.join(process.cwd(), "..", "..", "remotion"),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "render.mjs")) && fs.existsSync(path.join(dir, "node_modules"))) {
      return dir;
    }
  }
  return null;
}

interface ClipOptions {
  compositionId: string;
  title: string;
  quote?: string;
  subtitle?: string;
  handle?: string;
  label?: string;
  accent?: string;
  index?: number;
  total?: number;
  /** 信息卡专属字段，按 compositionId 取用；未使用的字段传 undefined 即可 */
  avatar?: string;
  role?: string;
  line?: string;
  rightAccent?: string;
  compare?: unknown;
  timeline?: unknown;
  stat?: unknown;
  bgImage?: string;
  /** 排版变体：hero / compact / stacked / split，缺省用组件默认排版 */
  variant?: string;
  /** 逐条上屏的要点，at 是相对本段起点的秒数 */
  beats?: { text: string; at: number }[];
  /** CompareCard：左右栏各自的出现时刻（秒），缺省走固定错位 */
  compareAt?: { left: number; right: number };
  /** 只出透明信息层（VP9 alpha），给 ffmpeg overlay 用 */
  transparent?: boolean;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  output: string;
  signal?: AbortSignal;
}

/** 最近一次渲染失败的原因，调用方拿去写进任务日志 */
let lastRenderError = "";

export function lastRenderErrorMessage(): string {
  return lastRenderError;
}

/**
 * 找一只能被 Remotion 拉起来的 Chromium。
 *
 * 桌面端的后端进程由 electron.exe 带起来（ELECTRON_RUN_AS_NODE），
 * 这种情况下 Remotion 自己察觉不到可用浏览器：找不到随包 chrome-headless-shell
 * 时它会回退到内置探测，而内置探测在 Electron 环境里会失败
 * （"Failed to launch the browser process! Closed with 0 signal: null"）。
 * 结果就是卡片预览永远渲不出来。所以这里显式给一个可执行路径。
 */
function resolveBrowserExecutable(): string | undefined {
  // 显式指定优先，开发态常用它指到自己装的 Chrome
  const explicit = process.env.REMOTION_BROWSER?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  // 随包的 Chrome Shell：有就不必再猜（render.mjs 里也按这个顺序判断）
  const shell = path.join(remotionDir() ?? "", "node_modules", ".remotion", "chrome-headless-shell");
  if (fs.existsSync(shell)) return undefined;

  const win = process.platform === "win32";
  const programs = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const programsX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = win
    ? [
        path.join(programs, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programsX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programs, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programsX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]
    : [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
  return candidates.find((file) => fs.existsSync(file));
}

/**
 * 找一个 ffmpeg 真的能写入的临时目录。
 *
 * Remotion 的中间产物全走 os.tmpdir()（TMPDIR/TMP/TEMP）。有些机器上系统 Temp
 * 对 ffmpeg 拒绝写入（pre-encode.mp4: Permission denied），整段渲染就挂在这一步。
 * 顺序：显式配置 > 当前 tmpdir（可写就直接用）> 数据目录下的 .tmp-render。
 */
function resolveTempDir(): string | undefined {
  const explicit = process.env.AISV_RENDER_TMP?.trim();
  const candidates = [explicit, os.tmpdir(), path.join(dataDir(), ".tmp-render")].filter((dir): dir is string =>
    Boolean(dir),
  );

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // 只 stat 不够：这里要的是「能真的建出文件并写进去」
      const probe = path.join(dir, `.aisv-write-${process.pid}-${Date.now()}`);
      fs.writeFileSync(probe, "1");
      fs.rmSync(probe, { force: true });
      return dir;
    } catch {
      // 换下一个候选目录
    }
  }
  return undefined;
}

/** 渲染脚本是纯 Node 进程，避免把 Remotion 的依赖装进 server */
function spawnRender(dir: string, propsFile: string, signal?: AbortSignal, timeoutMs = 180_000): Promise<boolean> {
  return new Promise((resolve) => {
    // 不能把父进程的 loader 注入（NODE_OPTIONS 里的 --require/--import）带下去，
    // 渲染脚本是纯 JS，带了反而会在启动阶段就挂掉
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.NODE_OPTIONS;

    /*
     * Electron 环境必须显式给浏览器路径：此时 process.execPath 是 electron.exe，
     * Remotion 的自动探测会拉不起来（见 resolveBrowserExecutable 注释）。
     */
    const browser = resolveBrowserExecutable();
    if (browser) env.REMOTION_BROWSER = browser;

    /*
     * 系统 Temp 对 ffmpeg 不可写时换到数据目录，否则 pre-encode 必失败。
     * 三个变量都要给：Node 读 TMPDIR，Windows 上的库多读 TMP/TEMP。
     */
    const tempDir = resolveTempDir();
    if (tempDir && tempDir !== os.tmpdir()) {
      env.TMPDIR = tempDir;
      env.TMP = tempDir;
      env.TEMP = tempDir;
    }

    const child = spawn(process.execPath, ["render.mjs", `@${propsFile}`], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (ok: boolean, detail = "") => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      lastRenderError = ok ? "" : (stderr.trim() || detail).slice(-600);
      if (!ok) console.error("[remotion]", lastRenderError);
      resolve(ok);
    };

    child.on("error", (error) => finish(false, `启动渲染进程失败：${error.message}`));
    child.on("close", (code) => finish(code === 0, `渲染进程退出码 ${code}`));
  });
}

/** 视频与静帧共用同一份 props 结构，避免两边字段漂移 */
function clipProps(options: ClipOptions, durationInFrames: number): Record<string, unknown> {
  const props: Record<string, unknown> = {
    compositionId: options.compositionId,
    title: options.title,
    quote: options.quote ?? "",
    index: options.index ?? 1,
    total: options.total ?? 1,
    subtitle: options.subtitle ?? "",
    handle: options.handle ?? "",
    label: options.label ?? "",
    accent: options.accent ?? "#ff5a3c",
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationInFrames,
  };

  // 信息卡字段只在有值时写入：卡片组件的默认值负责兜底，
  // 空对象塞进去反而会让时间线/柱状图渲染出空壳
  if (options.role !== undefined) props.role = options.role;
  if (options.line !== undefined) props.line = options.line;
  if (options.rightAccent !== undefined) props.rightAccent = options.rightAccent;
  if (options.compare !== undefined) props.compare = options.compare;
  if (options.timeline !== undefined) props.timeline = options.timeline;
  if (options.stat !== undefined) props.stat = options.stat;
  if (options.bgImage !== undefined) props.bgImage = options.bgImage;
  if (options.variant !== undefined) props.variant = options.variant;
  if (options.avatar !== undefined) props.avatar = options.avatar;
  if (options.beats && options.beats.length > 0) props.beats = options.beats;
  if (options.compareAt) props.compareAt = options.compareAt;
  if (options.transparent) props.transparent = true;

  return props;
}
async function renderClip(options: ClipOptions): Promise<boolean> {
  const dir = remotionDir();
  if (!dir) {
    lastRenderError = "没找到 remotion 运行环境：resources/remotion 下缺 render.mjs 或 node_modules";
    return false;
  }

  const raw = `${options.output}.raw.mp4`;
  const propsFile = `${options.output}.props.json`;
  const durationInFrames = Math.max(1, Math.round(options.durationSec * options.fps));

  fs.writeFileSync(propsFile, JSON.stringify({ ...clipProps(options, durationInFrames), output: raw }), "utf8");

  try {
    if (!(await spawnRender(dir, propsFile, options.signal))) return false;

    // 重编码成与段落片段相同的参数，并补静音轨
    await runFfmpeg(
      [
        "-y",
        "-i",
        raw,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(options.fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "2",
        options.output,
      ],
      { signal: options.signal },
    );

    return fs.existsSync(options.output) && fs.statSync(options.output).size > 0;
  } catch {
    return false;
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(propsFile, { force: true });
  }
}

export interface CardOptions {
  title: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  output: string;
  signal?: AbortSignal;
}

/** 片头：标题卡 */
export function renderIntro(options: CardOptions): Promise<boolean> {
  return renderClip({ ...options, compositionId: "TitleCard", label: "AI 摘要" });
}

/** 片尾：关注引导 */
export function renderOutro(options: CardOptions & { handle?: string; subtitle?: string }): Promise<boolean> {
  return renderClip({
    ...options,
    compositionId: "OutroCard",
    label: "下期见",
    handle: options.handle,
    subtitle: options.subtitle,
  });
}

/** 段落过场卡：大序号 + 本段主题 */
export function renderChapter(
  options: Omit<CardOptions, "title"> & { title: string; index: number; total: number },
): Promise<boolean> {
  return renderClip({
    ...options,
    compositionId: "ChapterCard",
    title: options.title,
    index: options.index,
    total: options.total,
    label: "PART",
  });
}

/** 兜底设计卡：没有合适素材时用一句观点撑住画面 */
export function renderQuote(options: Omit<CardOptions, "title"> & { quote: string }): Promise<boolean> {
  return renderClip({
    ...options,
    compositionId: "QuoteCard",
    title: options.quote,
    quote: options.quote,
    label: "观点",
  });
}

/** 版式清单里的一张卡：模板、文案、配色全部由 spec 决定 */
export interface SpecCardOptions extends CardOptions {
  compositionId: string;
  label?: string;
  handle?: string;
  accent?: string;
  index?: number;
  total?: number;
  /** 信息卡专属字段 */
  avatar?: string;
  role?: string;
  line?: string;
  rightAccent?: string;
  compare?: unknown;
  timeline?: unknown;
  stat?: unknown;
  bgImage?: string;
  /** 排版变体，与 ClipOptions 同义 */
  variant?: string;
  /** 逐条上屏的要点与对比栏时间，已在合成阶段按分句时间解析好 */
  beats?: { text: string; at: number }[];
  compareAt?: { left: number; right: number };
}

export function renderCard(options: SpecCardOptions): Promise<boolean> {
  return renderClip({
    compositionId: options.compositionId,
    title: options.title,
    label: options.label,
    handle: options.handle,
    accent: options.accent,
    index: options.index,
    total: options.total,
    role: options.role,
    line: options.line,
    rightAccent: options.rightAccent,
    compare: options.compare,
    timeline: options.timeline,
    stat: options.stat,
    bgImage: options.bgImage,
    variant: options.variant,
    avatar: options.avatar,
    beats: options.beats,
    compareAt: options.compareAt,
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationSec: options.durationSec,
    output: options.output,
    signal: options.signal,
  });
}

/** 字幕层的一条 cue，lines 已由后端按 libass 规则折好 */
export interface SubtitleLayerCue {
  lines: string[];
  start: number;
  end: number;
  style: "Subtitle" | "Title";
}

/** 与 ASS 样式同名同单位，方便两条渲染路径共用一份参数 */
export interface SubtitleLayerStyle {
  fontName: string;
  subtitleSize: number;
  titleSize: number;
  subtitleMarginV: number;
  titleMarginV: number;
  marginL: number;
  marginR: number;
  subtitleOutline: number;
  titleOutline: number;
  subtitleShadow: number;
  titleShadow: number;
  shadowColour: string;
}

export interface SubtitleLayerOptions extends SubtitleLayerStyle {
  cues: SubtitleLayerCue[];
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  output: string;
  signal?: AbortSignal;
}

/**
 * 渲染整片字幕为透明 VP9/webm。
 * 注意：合流时必须显式用 libvpx-vp9 解码，ffmpeg 原生 vp9 解码器会丢掉 alpha。
 */
export async function renderSubtitleLayer(options: SubtitleLayerOptions): Promise<boolean> {
  const dir = remotionDir();
  if (!dir) {
    lastRenderError = "没找到 remotion 运行环境：resources/remotion 下缺 render.mjs 或 node_modules";
    return false;
  }

  const propsFile = `${options.output}.props.json`;
  const durationInFrames = Math.max(1, Math.round(options.durationSec * options.fps));

  fs.writeFileSync(
    propsFile,
    JSON.stringify({
      compositionId: "SubtitleLayer",
      codec: "vp9",
      cues: options.cues,
      width: options.width,
      height: options.height,
      fps: options.fps,
      durationInFrames,
      fontName: options.fontName,
      subtitleSize: options.subtitleSize,
      titleSize: options.titleSize,
      subtitleMarginV: options.subtitleMarginV,
      titleMarginV: options.titleMarginV,
      marginL: options.marginL,
      marginR: options.marginR,
      subtitleOutline: options.subtitleOutline,
      titleOutline: options.titleOutline,
      subtitleShadow: options.subtitleShadow,
      titleShadow: options.titleShadow,
      shadowColour: options.shadowColour,
      output: options.output,
    }),
    "utf8",
  );

  // 实测全片渲染约 1.1× 实时，按 4 倍时长给上限，再兜底 5 分钟
  const timeoutMs = Math.max(300_000, options.durationSec * 4000);

  try {
    if (!(await spawnRender(dir, propsFile, options.signal, timeoutMs))) return false;
    return fs.existsSync(options.output) && fs.statSync(options.output).size > 0;
  } finally {
    fs.rmSync(propsFile, { force: true });
  }
}

/**
 * 渲染一张卡的透明信息层（VP9 + alpha），给 ffmpeg overlay 用。
 *
 * 与 renderCard 的区别：不转码成 h264、不补静音轨 —— alpha 会丢。
 * 素材由合成阶段的原有管线渲染（保留运镜），信息层单独叠上去，
 * 这样底图是真正的视频而不是抽出来的一帧静图。
 */
export async function renderCardLayer(options: SpecCardOptions): Promise<boolean> {
  const dir = remotionDir();
  if (!dir) {
    lastRenderError = "没找到 remotion 运行环境：resources/remotion 下缺 render.mjs 或 node_modules";
    return false;
  }

  const propsFile = `${options.output}.props.json`;
  const durationInFrames = Math.max(1, Math.round(options.durationSec * options.fps));

  fs.writeFileSync(
    propsFile,
    JSON.stringify({
      /*
       * 透明层永远不带底图。
       *
       * 底图（bgImage）是素材抽帧做的静帧，只用于「素材缺失时整段顶替」的卡片。
       * 透明层是要叠到活的素材视频上的，带上底图就等于把素材整幅盖死 ——
       * 成片里看到的是静帧，运镜全被埋掉。这里显式抹掉，不依赖组件自觉。
       */
      ...clipProps({ ...options, bgImage: undefined, transparent: true }, durationInFrames),
      codec: "vp9",
      output: options.output,
    }),
    "utf8",
  );

  // 全片渲染约 1.1× 实时，按 4 倍时长给上限
  const timeoutMs = Math.max(300_000, options.durationSec * 4000);

  try {
    if (!(await spawnRender(dir, propsFile, options.signal, timeoutMs))) return false;
    return fs.existsSync(options.output) && fs.statSync(options.output).size > 0;
  } finally {
    fs.rmSync(propsFile, { force: true });
  }
}

/**
 * 只渲染一帧静态图，预览页用它秒开。
 * 取 62% 处的帧，此时入场动画已经结束、又还没到收尾。
 */
export async function renderCardStill(options: SpecCardOptions & { frame?: number }): Promise<boolean> {
  const dir = remotionDir();
  if (!dir) {
    lastRenderError = "没找到 remotion 运行环境：resources/remotion 下缺 render.mjs 或 node_modules";
    return false;
  }

  const propsFile = `${options.output}.props.json`;
  const durationInFrames = Math.max(1, Math.round(options.durationSec * options.fps));
  const frame = Math.max(0, Math.min(durationInFrames - 1, Math.round(options.frame ?? durationInFrames * 0.62)));

  fs.writeFileSync(
    propsFile,
    JSON.stringify({
      ...clipProps({ ...options, compositionId: options.compositionId }, durationInFrames),
      output: options.output,
      still: frame,
    }),
    "utf8",
  );

  try {
    if (!(await spawnRender(dir, propsFile, options.signal))) return false;
    return fs.existsSync(options.output) && fs.statSync(options.output).size > 0;
  } finally {
    fs.rmSync(propsFile, { force: true });
  }
}
