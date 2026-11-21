import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

/** 渲染脚本是纯 Node 进程，避免把 Remotion 的依赖装进 server */
function spawnRender(dir: string, propsFile: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    // 不能把父进程的 loader 注入（NODE_OPTIONS 里的 --require/--import）带下去，
    // 渲染脚本是纯 JS，带了反而会在启动阶段就挂掉
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.NODE_OPTIONS;

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

    const timer = setTimeout(() => child.kill(), 180_000);
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

/**
 * 渲染一张卡片并补一条静音轨，让它能和段落片段一起走转场拼接。
 * 任何一步失败都返回 false，由调用方回退。
 */
/** 视频与静帧共用同一份 props 结构，避免两边字段漂移 */
function clipProps(options: ClipOptions, durationInFrames: number): Record<string, unknown> {
  return {
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
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationSec: options.durationSec,
    output: options.output,
    signal: options.signal,
  });
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
