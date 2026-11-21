import fs from "node:fs";
import path from "node:path";
import {
  autoSubtitleFontSize,
  bool,
  loadConfig,
  num,
  numberOrZero,
  SUBTITLE_WIDTH_RATIO,
  TITLE_SIZE_RATIO,
  type AppConfig,
} from "../config.js";
import { ensureDir } from "../paths.js";
import { prepareBgm } from "../services/bgm.js";
import { runFfmpeg } from "../services/ffmpeg.js";
import { ensureSfx } from "../services/sfx.js";
import { renderChapter, renderIntro, renderOutro, renderQuote } from "../services/remotion.js";
import { ensureCardVideo } from "./cards.js";
import { probeVideo } from "../services/probe.js";
import { buildAss, charsPerLine, type SubtitleCue } from "../services/subtitle.js";
import type {
  AudioManifest,
  CardManifest,
  CardSpec,
  GenerateOptions,
  MaterialManifest,
  TaskContext,
  Transcript,
} from "../types.js";

/** 其他平台由 libass 回退 */
const SUBTITLE_FONT = "Microsoft YaHei";
const SUBTITLE_POSITION_RATIO = 0.667;
const SUBTITLE_STROKE_RATIO = 1 / 24;
const TITLE_STROKE_RATIO = 1 / 20;
const MIN_STROKE = 1;
/** AABBGGRR */
const SHADOW_COLOUR = "&H80000000";
const BGM_VOLUME = 0.1;
/** 改渲染效果或折行规则时加一，旧片段缓存随之失效 */
const SUBTITLE_STYLE_VERSION = 4;
const CLIP_CRF = "18";
const CLIP_PRESET = "veryfast";
const CLIP_SIG_SUFFIX = ".json";
/** 运镜预放大倍数，缩回目标尺寸后才有推近余量，同时避免抖动露出边缘 */
const MOTION_PAD = 1.15;
/** 转场强度上限，超出的部分 ffmpeg 会吃穿片段 */
const MAX_MOTION_LEVEL = 10;
/** mixed 模式按顺序轮换，第 1 个转场仍是柔和的淡入淡出 */
const XFADE_MIXED = [
  "fade",
  "smoothleft",
  "slideup",
  "circleopen",
  "dissolve",
  "wipeleft",
  "zoomin",
  "slideleft",
] as const;

type TransitionMode = "fade" | "mixed";

interface RenderOptions {
  bgmVolume: number;
  bgmFadeIn: number;
  bgmFadeOut: number;
  videoFadeIn: number;
  videoFadeOut: number;
}

/** 画面观感参数，改动会写进片段签名 */
interface LookOptions {
  /** 0 = 不做运镜 */
  motion: number;
  /** 0 = 不调色 */
  grade: number;
}

/** 任务参数 > 配置项 > 内置默认 */
function renderOptions(cfg: AppConfig, options: GenerateOptions): RenderOptions {
  return {
    bgmVolume: options.bgmVolume ?? numberOrZero(cfg.BGM_VOLUME, BGM_VOLUME),
    bgmFadeIn: numberOrZero(cfg.AUDIO_FADE_IN, 0),
    bgmFadeOut: numberOrZero(cfg.AUDIO_FADE_OUT, 0),
    videoFadeIn: numberOrZero(cfg.VIDEO_FADE_IN, 0),
    videoFadeOut: numberOrZero(cfg.VIDEO_FADE_OUT, 0),
  };
}

/** 配置里的观感强度，越界按上限收敛 */
function lookOptions(cfg: AppConfig): LookOptions {
  return {
    motion: Math.min(MAX_MOTION_LEVEL, numberOrZero(cfg.CAMERA_MOTION, 0)),
    grade: Math.min(MAX_MOTION_LEVEL, numberOrZero(cfg.COLOR_GRADE, 0)),
  };
}

function transitionMode(cfg: AppConfig): TransitionMode {
  return (cfg.TRANSITION_STYLE ?? "").trim().toLowerCase() === "mixed" ? "mixed" : "fade";
}

/** 片段签名只关心开关与强度，运镜方向由段落序号决定 */
function lookKey(look: LookOptions): string {
  return `motion:${look.motion};grade:${look.grade}`;
}

/**
 * 运镜：zoompan 的 x/y 逐帧求值，比 scale 的时变表达式稳。
 * 输入先预放大 MOTION_PAD 倍，所以 zoom=1 时仍是原构图。
 * on 最大到 frames-1，缩放值永远落在 [1, maxZoom) 内，不必额外 clamp。
 */
function motionChain(plan: ParagraphPlan, width: number, height: number, fps: number, level: number): string | null {
  if (level <= 0) return null;

  const frames = Math.max(1, Math.round(plan.duration * fps));
  const maxZoom = 1 + 0.012 * level;
  const rate = (maxZoom - 1) / frames;
  const tail = `d=1:s=${width}x${height}:fps=${fps}`;
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";

  // 按段落轮换，避免整片只有一种运动方向
  switch (plan.index % 4) {
    case 1:
      return `zoompan=z='1+${rate.toFixed(6)}*on':x='${centerX}':y='${centerY}':${tail}`;
    case 2:
      return `zoompan=z='${maxZoom.toFixed(3)}-${rate.toFixed(6)}*on':x='${centerX}':y='${centerY}':${tail}`;
    case 3:
      return `zoompan=z='${maxZoom.toFixed(3)}':x='(iw-iw/zoom)*on/${frames}':y='${centerY}':${tail}`;
    default:
      return `zoompan=z='${maxZoom.toFixed(3)}':x='${centerX}':y='(ih-ih/zoom)*(1-on/${frames})':${tail}`;
  }
}

/** 统一调色：把不同来源的库存素材拉到同一套观感上 */
function gradeChain(level: number): string[] {
  if (level <= 0) return [];

  const chain = [
    `eq=contrast=${(1 + 0.008 * level).toFixed(3)}:saturation=${(1 + 0.02 * level).toFixed(3)}:gamma=1.010`,
  ];
  if (level >= 4) chain.push(`vignette=angle=PI/${(8 - level * 0.2).toFixed(1)}`);
  if (level >= 6) chain.push("noise=alls=3:allf=t");
  return chain;
}

/** mixed 模式下按序号轮换转场，fade 模式保持单一淡入淡出 */
function xfadeStyle(mode: TransitionMode, index: number): string {
  if (mode !== "mixed") return "fade";
  return XFADE_MIXED[(index - 1) % XFADE_MIXED.length] ?? "fade";
}

/** 0 表示自动 */
function subtitleFontSize(cfg: AppConfig, options: GenerateOptions): number {
  const size = options.subtitleFontSize ?? numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0);
  return size > 0 ? size : autoSubtitleFontSize(options.width);
}

/** 淡入淡出最多占时长 1/3 */
function clampFade(value: number, durationSec: number): number {
  if (value <= 0) return 0;
  return Math.min(value, Math.max(0.1, durationSec / 3));
}

function videoFadeChain(o: RenderOptions, durationSec: number): string[] {
  const chain: string[] = [];
  const fadeIn = clampFade(o.videoFadeIn, durationSec);
  const fadeOut = clampFade(o.videoFadeOut, durationSec);
  if (fadeIn > 0) chain.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0) {
    const start = Math.max(0, durationSec - fadeOut);
    chain.push(`fade=t=out:st=${start.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  return chain;
}

/** 只作用于音乐轨 */
function bgmChain(o: RenderOptions, durationSec: number): string {
  const chain = [`volume=${o.bgmVolume.toFixed(3)}`];
  const fadeIn = clampFade(o.bgmFadeIn, durationSec);
  const fadeOut = clampFade(o.bgmFadeOut, durationSec);
  if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0) {
    const start = Math.max(0, durationSec - fadeOut);
    chain.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  return chain.join(",");
}

interface Sentence {
  file: string;
  text: string;
  start: number;
}

interface ParagraphPlan {
  index: number;
  sentences: Sentence[];
  cues: SubtitleCue[];
  duration: number;
  /** 转场用的首尾静音留白 */
  padLead: number;
  padTail: number;
}

interface TimelineOptions {
  titleDuration: number;
  interval: number;
  padLead: number;
  padTail: number;
}

/** 排时间轴：首句前插标题，句间留间隔，转场时垫首尾留白 */
export function planParagraphs(transcript: Transcript, audio: AudioManifest, o: TimelineOptions): ParagraphPlan[] {
  const plans: ParagraphPlan[] = [];

  for (let pi = 0; pi < transcript.paragraphs.length; pi++) {
    const paragraph = transcript.paragraphs[pi];
    if (!paragraph) continue;

    const audioParagraph = audio.paragraphs.find((p) => p.index === pi + 1);
    const sentences: Sentence[] = [];
    const cues: SubtitleCue[] = [];
    let cursor = 0;

    for (let di = 0; di < paragraph.dialogues.length; di++) {
      const files = audioParagraph?.dialogues[di]?.files ?? [];

      for (let si = 0; si < files.length; si++) {
        const info = files[si];
        if (!info) continue;

        if (pi === 0 && di === 0 && si === 0) {
          const title = transcript.title.trim();
          if (title && o.titleDuration > 0) {
            cues.push({ text: title, start: cursor, end: cursor + o.titleDuration, style: "Title" });
            cursor += o.titleDuration;
          }
        } else {
          cursor += o.interval;
        }

        const start = cursor;
        sentences.push({ file: info.file, text: info.text, start });
        cues.push({ text: info.text, start, end: start + info.duration, style: "Subtitle" });
        cursor = start + info.duration;
      }
    }

    if (sentences.length > 0) {
      plans.push({ index: pi + 1, sentences, cues, duration: cursor, padLead: 0, padTail: 0 });
    }
  }

  // 首段不垫片头、末段不垫片尾
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;
    plan.padLead = i === 0 ? 0 : o.padLead;
    plan.padTail = i === plans.length - 1 ? 0 : o.padTail;
    if (plan.padLead === 0 && plan.padTail === 0) continue;

    for (const sentence of plan.sentences) sentence.start += plan.padLead;
    for (const cue of plan.cues) {
      cue.start += plan.padLead;
      cue.end += plan.padLead;
    }
    plan.duration += plan.padLead + plan.padTail;
  }

  return plans;
}

/**
 * 段内切镜：按句子边界把段落切成 count 段，切点落在句子开头，
 * 换镜头与换话题对齐，总时长保持不变。
 */
export function shotDurations(plan: ParagraphPlan, count: number): number[] {
  const n = Math.min(Math.max(1, Math.floor(count)), plan.sentences.length);
  if (n <= 1) return [plan.duration];

  const cuts: number[] = [];
  for (let i = 1; i < n; i++) {
    const sentence = plan.sentences[Math.round((i * plan.sentences.length) / n)];
    const start = sentence?.start;
    // 切点太靠前会让第一镜一闪而过
    if (typeof start === "number" && start > 0.4) cuts.push(start);
  }
  if (cuts.length === 0) return [plan.duration];

  const durations: number[] = [];
  let prev = 0;
  for (const cut of cuts) {
    durations.push(cut - prev);
    prev = cut;
  }
  durations.push(plan.duration - prev);

  return durations.filter((duration) => duration > 0.05);
}

/** 过场卡标题：取本段第一句，截到 14 字 */
function chapterTitle(plan: ParagraphPlan): string {
  const first = plan.cues.find((cue) => cue.style === "Subtitle")?.text ?? plan.sentences[0]?.text ?? "";

  return Array.from(first.trim())
    .slice(0, 14)
    .join("")
    .replace(/[，,。.；;：:！!？?、]+$/, "");
}

/** 兜底设计卡上的那句话：取本段最长的一句，截到 30 字 */
function pickQuoteText(plan: ParagraphPlan): string {
  const texts = plan.cues
    .filter((cue) => cue.style === "Subtitle")
    .map((cue) => cue.text.trim())
    .filter((text) => Array.from(text).length >= 6);

  const best = texts.sort((a, b) => Array.from(b).length - Array.from(a).length)[0] ?? plan.sentences[0]?.text ?? "";

  return Array.from(best)
    .slice(0, 30)
    .join("")
    .replace(/[，,。.；;：:！!？?、]+$/, "");
}

/** Remotion 也不可用时的最后兜底：一段带颗粒的深色渐变，保证仍能出片 */
async function makePlaceholder(
  ctx: TaskContext,
  width: number,
  height: number,
  fps: number,
  output: string,
): Promise<string> {
  try {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `gradients=s=${width}x${height}:c0=0x101828:c1=0x080b12:x0=0:y0=0:x1=${width}:y1=${height}:duration=2:rate=${fps}`,
        "-vf",
        "noise=alls=6:allf=t",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-t",
        "2",
        output,
      ],
      { signal: ctx.signal },
    );
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x0d1220:s=${width}x${height}:r=${fps}:d=2`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        output,
      ],
      { signal: ctx.signal },
    );
  }

  return output;
}

/** 时长以产物为准，配置值和实际帧数可能差一帧 */
async function clipSeconds(file: string, fallback: number): Promise<number> {
  try {
    const info = await probeVideo(file);
    return info.duration > 0 ? info.duration : fallback;
  } catch {
    return fallback;
  }
}

/** 设计卡：优先 Remotion 排版，失败退回纯色底，保证这一段的时长和音轨照常 */
async function renderFallbackCard(
  ctx: TaskContext,
  plan: ParagraphPlan,
  clipsDir: string,
  fps: number,
): Promise<string> {
  const quoteText = pickQuoteText(plan);
  const quoteFile = path.join(clipsDir, `${plan.index}.quote.mp4`);

  if (fs.existsSync(quoteFile) && fs.statSync(quoteFile).size > 0) return quoteFile;

  const ok = await renderQuote({
    quote: quoteText,
    width: ctx.options.width,
    height: ctx.options.height,
    fps,
    durationSec: plan.duration,
    output: quoteFile,
    signal: ctx.signal,
  });

  if (ok) {
    ctx.log(`第 ${plan.index} 段使用设计卡：「${quoteText}」`);
    return quoteFile;
  }

  const placeholder = path.join(clipsDir, `${plan.index}.placeholder.mp4`);
  ctx.log(`第 ${plan.index} 段设计卡渲染失败，改用纯色底`, "warn");
  return makePlaceholder(ctx, ctx.options.width, ctx.options.height, fps, placeholder);
}

function assOptions(width: number, height: number, fontSize: number) {
  const subtitleWidth = Math.round(width * SUBTITLE_WIDTH_RATIO);
  const sideMargin = Math.round((width - subtitleWidth) / 2);
  const subtitleSize = fontSize > 0 ? Math.round(fontSize) : autoSubtitleFontSize(width);
  const titleSize = Math.round(subtitleSize * TITLE_SIZE_RATIO);
  const stroke = Math.max(MIN_STROKE, Math.round(subtitleSize * SUBTITLE_STROKE_RATIO * 10) / 10);
  const titleStroke = Math.max(stroke, Math.round(titleSize * TITLE_STROKE_RATIO * 10) / 10);
  return {
    width,
    height,
    fontName: SUBTITLE_FONT,
    subtitleSize,
    titleSize,
    subtitleMarginV: Math.round(height - height * SUBTITLE_POSITION_RATIO),
    titleMarginV: 0,
    marginL: sideMargin,
    marginR: sideMargin,
    subtitleOutline: stroke,
    titleOutline: titleStroke,
    subtitleShadow: Math.round(stroke * 0.66 * 10) / 10,
    titleShadow: Math.round(titleStroke * 0.66 * 10) / 10,
    shadowColour: SHADOW_COLOUR,
    maxChars: charsPerLine(subtitleWidth, subtitleSize),
  };
}

/** 素材、画幅、字号、时间轴任一变化都会失效 */
export function clipSignature(
  plan: ParagraphPlan,
  materialPath: string | string[],
  width: number,
  height: number,
  fps: number,
  fontSize: number,
  look = "",
): string {
  // 单素材时保持与旧签名一致的格式，多镜头按顺序拼接
  const material = (Array.isArray(materialPath) ? materialPath : [materialPath])
    .map((file) => {
      try {
        const stat = fs.statSync(file);
        return `${path.basename(file)}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return path.basename(file);
      }
    })
    .join("|");

  return JSON.stringify({
    material,
    width,
    height,
    fps,
    fontSize,
    look,
    style: SUBTITLE_STYLE_VERSION,
    duration: Number(plan.duration.toFixed(3)),
    sentences: plan.sentences.map((s) => [s.file, Number(s.start.toFixed(3))]),
    cues: plan.cues.map((c) => [c.text, Number(c.start.toFixed(3)), Number(c.end.toFixed(3)), c.style]),
  });
}

async function renderParagraph(
  ctx: TaskContext,
  plan: ParagraphPlan,
  materialPaths: string[],
  subsDir: string,
  clipsDir: string,
  onProgress: (ratio: number) => void,
): Promise<string> {
  const cfg = loadConfig();
  const fps = ctx.options.fps > 0 ? ctx.options.fps : num(cfg.FPS, 24);
  const { width, height } = ctx.options;
  const fontSize = subtitleFontSize(cfg, ctx.options);
  const look = lookOptions(cfg);

  const clipFile = path.join(clipsDir, `${plan.index}.mp4`);
  const sigFile = path.join(clipsDir, `${plan.index}.mp4${CLIP_SIG_SUFFIX}`);
  const signature = clipSignature(plan, materialPaths, width, height, fps, fontSize, lookKey(look));

  if (fs.existsSync(clipFile) && fs.statSync(clipFile).size > 0) {
    let cached = "";
    try {
      cached = fs.readFileSync(sigFile, "utf-8");
    } catch {
      // 无签名视为不匹配
    }
    if (cached === signature) {
      ctx.log(`复用已渲染片段 ${path.basename(clipFile)}`);
      return clipFile;
    }
    ctx.log(`第 ${plan.index} 段的素材或参数变了，重新渲染片段`);
    fs.rmSync(clipFile, { force: true });
  }

  const assFile = path.join(subsDir, `${plan.index}.ass`);
  fs.writeFileSync(assFile, buildAss(plan.cues, assOptions(width, height, fontSize)), "utf-8");

  // 段内多镜头：按句子边界切时长，每个素材占一段
  const durations = shotDurations(plan, materialPaths.length);
  const shots = materialPaths.slice(0, durations.length);

  const args: string[] = [];
  for (const shot of shots) args.push("-stream_loop", "-1", "-i", shot);
  for (const sentence of plan.sentences) {
    args.push("-i", path.join(ctx.workspace, sentence.file));
  }

  // 运镜需要推近余量：先放大到 1.15 倍再缩回目标尺寸，避免推近时露出边缘
  const scaledWidth = look.motion > 0 ? Math.round((width * MOTION_PAD) / 2) * 2 : width;
  const scaledHeight = look.motion > 0 ? Math.round((height * MOTION_PAD) / 2) * 2 : height;
  const baseChain = [
    `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${scaledWidth}:${scaledHeight}`,
    "setsar=1",
    `fps=${fps}`,
  ];

  // 运镜与调色作用于整段（拼接之后），保证跨镜头连续
  const postChain: string[] = [];
  const motion = motionChain(plan, width, height, fps, look.motion);
  if (motion) {
    postChain.push(motion);
    // zoompan 会重算像素比，ass 依赖 SAR 定位字幕
    postChain.push("setsar=1");
  }
  postChain.push(...gradeChain(look.grade));
  // 字幕放在调色之后，避免暗角和颗粒影响可读性
  postChain.push(`ass=subs/${plan.index}.ass`);

  const filters: string[] = [];
  if (shots.length === 1) {
    filters.push(`[0:v]${[...baseChain, ...postChain].join(",")}[v]`);
  } else {
    for (let i = 0; i < shots.length; i++) {
      filters.push(
        `[${i}:v]${baseChain.join(",")},trim=duration=${(durations[i] ?? 0).toFixed(3)},setpts=PTS-STARTPTS[s${i}]`,
      );
    }
    filters.push(`${shots.map((_, i) => `[s${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[vcat]`);
    filters.push(`[vcat]${postChain.join(",")}[v]`);
  }

  const audioLabels: string[] = [];
  plan.sentences.forEach((sentence, index) => {
    const delayMs = Math.round(sentence.start * 1000);
    filters.push(
      `[${index + shots.length}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[a${index}]`,
    );
    audioLabels.push(`[a${index}]`);
  });

  if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}anull[a]`);
  } else {
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[a0]`);
    filters.push("[a0]anull[a]");
  }

  // 补齐尾部留白，避免音轨短于画面导致 acrossfade 错位
  filters.push(`[a]apad=whole_dur=${plan.duration.toFixed(3)}[apad]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[apad]",
    "-t",
    plan.duration.toFixed(3),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    CLIP_PRESET,
    "-crf",
    CLIP_CRF,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-ac",
    "2",
    clipFile,
  );

  await runFfmpeg(args, {
    cwd: ctx.workspace,
    signal: ctx.signal,
    totalMs: plan.duration * 1000,
    onProgress,
  });

  // 成功后才写签名，失败或被取消的片段不当作缓存
  fs.writeFileSync(sigFile, signature, "utf-8");
  return clipFile;
}

interface SfxFiles {
  whoosh: string | null;
  impact: string | null;
  /** 0-1，乘到音效本身音量上 */
  volume: number;
}

interface MergeOptions {
  ctx: TaskContext;
  clips: string[];
  /** 0 表示直接拼接 */
  transition: number;
  /** fade = 统一淡入淡出，mixed = 逐段轮换 */
  transitionMode: TransitionMode;
  /** 每个转场对应的风格；缺省时按 transitionMode 轮换 */
  transitionStyles?: string[];
  output: string;
  encode: string[];
  bgm: string | null;
  sfx: SfxFiles | null;
  totalDurationMs: number;
  render: RenderOptions;
}

/** 音效轨统一成主音轨的采样格式，才能跟配音一起 amix */
function sfxChain(delayMs: number, volume: number): string {
  return `aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},volume=${volume.toFixed(3)}`;
}

/** 探测片段时长，失败时按均值兜底 */
async function clipDurations(ctx: TaskContext, clips: string[], totalDurationMs: number): Promise<number[]> {
  try {
    const probes = await Promise.all(clips.map((clip) => probeVideo(clip)));
    return probes.map((probe) => probe.duration);
  } catch {
    const average = totalDurationMs / 1000 / clips.length;
    ctx.log("无法探测片段时长，按平均时长估算转场偏移", "warn");
    return clips.map(() => average);
  }
}

/** xfade / acrossfade 带转场串联 */
async function mergeWithTransitions(options: MergeOptions): Promise<void> {
  const {
    ctx,
    clips,
    transition,
    transitionMode: mode,
    transitionStyles,
    output,
    encode,
    bgm,
    sfx,
    totalDurationMs,
    render,
  } = options;

  const durations = await clipDurations(ctx, clips, totalDurationMs);

  const shortest = Math.min(...durations);
  const fade = Math.max(0.1, Math.min(transition, shortest / 2));
  if (fade < transition) {
    ctx.log(`转场 ${transition}s 对最短片段 ${shortest.toFixed(2)}s 过长，已收敛为 ${fade.toFixed(2)}s`, "warn");
  }

  const filters: string[] = [];

  // xfade 要求两条流时间基一致
  for (let i = 0; i < clips.length; i++) {
    filters.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
  }

  let videoLabel = "v0";
  let elapsed = durations[0] ?? 0;
  const transitionOffsets: number[] = [];
  for (let k = 1; k < clips.length; k++) {
    const offset = Math.max(0, elapsed - fade);
    transitionOffsets.push(offset);
    const style = transitionStyles?.[k - 1] ?? xfadeStyle(mode, k);
    filters.push(
      `[${videoLabel}][v${k}]xfade=transition=${style}:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[vx${k}]`,
    );
    videoLabel = `vx${k}`;
    elapsed = elapsed + (durations[k] ?? 0) - fade;
  }

  let audioLabel = "";
  for (let k = 1; k < clips.length; k++) {
    const previous = k === 1 ? "[0:a]" : `[a${k - 1}]`;
    filters.push(`${previous}[${k}:a]acrossfade=d=${fade.toFixed(3)}:c1=tri:c2=tri[a${k}]`);
    audioLabel = `a${k}`;
  }

  // 转场会吃掉重叠部分
  const outputSec = Math.max(0.1, durations.reduce((sum, d) => sum + d, 0) - (clips.length - 1) * fade);

  const args: string[] = [];
  for (const clip of clips) args.push("-i", clip);

  const videoChain = videoFadeChain(render, outputSec);
  if (videoChain.length > 0) {
    filters.push(`[${videoLabel}]${videoChain.join(",")}[vf]`);
    videoLabel = "vf";
  }

  let nextInput = clips.length;
  const mixLabels: string[] = audioLabel ? [audioLabel] : [];

  if (bgm) {
    args.push("-stream_loop", "-1", "-i", bgm);
    filters.push(`[${nextInput}:a]${bgmChain(render, outputSec)}[b]`);
    nextInput++;
    mixLabels.push("b");
  }

  // 音效：片头一个落点，每个转场中点一个呼应
  if (sfx) {
    const points: { file: string; at: number }[] = [];
    if (sfx.impact) points.push({ file: sfx.impact, at: 0.05 });
    if (sfx.whoosh) {
      for (const offset of transitionOffsets) points.push({ file: sfx.whoosh, at: offset + fade / 2 });
    }

    points.forEach((point, index) => {
      args.push("-i", point.file);
      filters.push(`[${nextInput}:a]${sfxChain(Math.max(0, Math.round(point.at * 1000)), sfx.volume)}[fx${index}]`);
      nextInput++;
      mixLabels.push(`fx${index}`);
    });
  }

  if (mixLabels.length > 1) {
    filters.push(
      `${mixLabels.map((label) => `[${label}]`).join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`,
    );
    audioLabel = "aout";
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, ...encode);
  if (bgm) args.push("-shortest");
  args.push(output);

  await runFfmpeg(args, { cwd: ctx.workspace, signal: ctx.signal, totalMs: outputSec * 1000 });
}

/** concat 拼接，无需后处理时直接流拷贝 */
async function mergeByConcat(options: MergeOptions): Promise<void> {
  const { ctx, clips, output, encode, bgm, sfx, totalDurationMs, render } = options;

  const listFile = path.join(ctx.workspace, "listfile.txt");
  fs.writeFileSync(listFile, `${clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n")}\n`, "utf-8");

  const needFilter = Boolean(bgm) || Boolean(sfx?.impact) || render.videoFadeIn > 0 || render.videoFadeOut > 0;
  if (!needFilter) {
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output], {
      cwd: ctx.workspace,
      signal: ctx.signal,
      totalMs: totalDurationMs,
    });
    return;
  }

  const durations = await clipDurations(ctx, clips, totalDurationMs);
  const outputSec = Math.max(
    0.1,
    durations.reduce((sum, d) => sum + d, 0),
  );
  const videoChain = videoFadeChain(render, outputSec);

  const args: string[] = ["-f", "concat", "-safe", "0", "-i", listFile];
  const filters: string[] = [`[0:v]${videoChain.length > 0 ? videoChain.join(",") : "null"}[v]`];

  // 无转场时只在片头加一个落点音效
  const audioMix: string[] = ["0:a"];
  let nextInput = 1;

  if (bgm) {
    args.push("-stream_loop", "-1", "-i", bgm);
    filters.push(`[${nextInput}:a]${bgmChain(render, outputSec)}[b]`);
    nextInput++;
    audioMix.push("b");
  }

  if (sfx?.impact) {
    args.push("-i", sfx.impact);
    filters.push(`[${nextInput}:a]${sfxChain(50, sfx.volume)}[fx0]`);
    audioMix.push("fx0");
  }

  let audioMap = "0:a";
  if (audioMix.length > 1) {
    filters.push(
      `${audioMix.map((label) => `[${label}]`).join("")}amix=inputs=${audioMix.length}:duration=first:normalize=0[a]`,
    );
    audioMap = "[a]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", audioMap, ...encode);
  if (bgm) args.push("-shortest");
  args.push(output);

  await runFfmpeg(args, { cwd: ctx.workspace, signal: ctx.signal, totalMs: totalDurationMs });
}

/** 成片旁边写一份「完成标记」：只有正常合完才算数，中途被杀的残留文件不能复用 */
function outputMarker(output: string): string {
  return `${output}.ok`;
}

function outputStamp(output: string): string {
  const stat = fs.statSync(output);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/** 文件存在且标记与它的大小/时间戳对得上，才认为是上一版完整成片 */
export function isComposedOutput(output: string): boolean {
  try {
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) return false;
    const marker = outputMarker(output);
    if (!fs.existsSync(marker)) return false;
    return fs.readFileSync(marker, "utf-8").trim() === outputStamp(output);
  } catch {
    return false;
  }
}

/** 分段渲染 → 合并 → 混入 BGM */
export async function runComposeStage(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
  material: MaterialManifest,
  cards?: CardManifest | null,
): Promise<string> {
  const output = path.join(ctx.workspace, "_output.mp4");
  const marker = outputMarker(output);
  if (isComposedOutput(output)) {
    ctx.log("复用已生成的成片（_output.mp4）");
    ctx.markStage("compose", "skipped", "命中缓存");
    return output;
  }
  // 上次合成没跑完留下的半成品：直接丢掉，否则会当成完整成片复用，看起来就是「成片里没有版式」
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    ctx.log("上次合成没跑完，丢弃不完整的成片重新合成", "warn");
    fs.rmSync(output, { force: true });
  }
  fs.rmSync(marker, { force: true });

  ctx.markStage("compose", "running");
  const clipsDir = ensureDir(path.join(ctx.workspace, "clips"));
  const subsDir = ensureDir(path.join(ctx.workspace, "subs"));

  const cfg = loadConfig();
  const fps = ctx.options.fps > 0 ? ctx.options.fps : num(cfg.FPS, 24);
  const transition = numberOrZero(cfg.TRANSITION_DURATION, 0);
  const mode = transitionMode(cfg);
  const look = lookOptions(cfg);
  if (look.motion > 0 || look.grade > 0) {
    ctx.log(
      `画面增强：运镜 ${look.motion > 0 ? `${look.motion} 级` : "关"} · 调色 ${
        look.grade > 0 ? `${look.grade} 级` : "关"
      }`,
    );
  }
  let titleDuration = numberOrZero(cfg.TITLE_DURATION, 0);
  let introClip: string | null = null;
  let outroClip: string | null = null;
  /** 实际产物时长，BGM 与总时长都按它算 */
  let introSec = 0;
  let outroActualSec = 0;
  /** 已确认的版式卡渲染失败数：成片会缺这些卡，末尾要明确告诉用户 */
  let missingCards = 0;

  // 清单里已定好片头/章节/片尾，这里只负责渲染与拼接
  const cardChapters = new Map<number, CardSpec>();
  for (const item of cards?.items ?? []) {
    if (item.kind === "chapter" && item.paragraph) cardChapters.set(item.paragraph, item);
  }
  const cardTotal = transcript.paragraphs.length;

  if (cards) {
    const introSpec = cards.items.find((item) => item.kind === "intro");
    if (introSpec) {
      ctx.markStage("compose", "running", "渲染片头");
      const file = await ensureCardVideo(ctx, introSpec, cardTotal);
      if (file) {
        introClip = file;
        introSec = await clipSeconds(file, introSpec.durationSec);
        // 片头占了标题的时长，ASS 就不再画标题，避免重复
        titleDuration = 0;
        ctx.log(`片头：${introSpec.title}`);
      } else {
        missingCards++;
        ctx.log("片头卡没渲染出来，本次成片不含片头（原因见上一条渲染日志）", "error");
      }
    }

    const outroSpec = cards.items.find((item) => item.kind === "outro");
    if (outroSpec) {
      ctx.markStage("compose", "running", "渲染片尾");
      const file = await ensureCardVideo(ctx, outroSpec, cardTotal);
      if (file) {
        outroClip = file;
        outroActualSec = await clipSeconds(file, outroSpec.durationSec);
        ctx.log(`片尾：${outroSpec.title}`);
      } else {
        missingCards++;
        ctx.log("片尾卡没渲染出来，本次成片不含片尾（原因见上一条渲染日志）", "error");
      }
    }
  } else {
    // 没开版式阶段时沿用配置开关
    if (bool(cfg.INTRO_ENABLED, false) && titleDuration > 0) {
      const introFile = path.join(ctx.workspace, "intro.mp4");
      if (fs.existsSync(introFile) && fs.statSync(introFile).size > 0) {
        introClip = introFile;
        ctx.log("复用已渲染的 Remotion 片头");
      } else {
        ctx.markStage("compose", "running", "渲染片头");
        const ok = await renderIntro({
          title: transcript.title,
          width: ctx.options.width,
          height: ctx.options.height,
          fps,
          durationSec: titleDuration,
          output: introFile,
          signal: ctx.signal,
        });
        if (ok) {
          introClip = introFile;
          ctx.log("片头使用 Remotion 模板");
        } else {
          ctx.log("Remotion 片头不可用，回退到字幕标题", "warn");
        }
      }
      if (introClip) {
        titleDuration = 0;
        introSec = numberOrZero(cfg.TITLE_DURATION, 0);
      }
    }

    // Remotion 片尾：纯增量，失败就不加，不影响正文
    const outroSec = numberOrZero(cfg.OUTRO_DURATION, 0);
    if (outroSec > 0) {
      const outroFile = path.join(ctx.workspace, "outro.mp4");
      if (fs.existsSync(outroFile) && fs.statSync(outroFile).size > 0) {
        outroClip = outroFile;
        ctx.log("复用已渲染的 Remotion 片尾");
      } else {
        ctx.markStage("compose", "running", "渲染片尾");
        const ok = await renderOutro({
          title: (cfg.OUTRO_TITLE ?? "").trim() || "关注我，下期见",
          handle: (cfg.OUTRO_HANDLE ?? "").trim() || undefined,
          width: ctx.options.width,
          height: ctx.options.height,
          fps,
          durationSec: outroSec,
          output: outroFile,
          signal: ctx.signal,
        });
        if (ok) {
          outroClip = outroFile;
          ctx.log("片尾使用 Remotion 模板");
        } else {
          ctx.log("Remotion 片尾不可用，本次不加片尾", "warn");
        }
      }
      if (outroClip) outroActualSec = outroSec;
    }
  }

  const timeline = {
    titleDuration,
    interval: numberOrZero(cfg.SUBTITLE_INTERVAL, 0),
  };

  // 多段且有转场时才补首尾留白
  const bare = planParagraphs(transcript, audio, { ...timeline, padLead: 0, padTail: 0 });
  if (bare.length === 0) throw new Error("没有可合成的段落");

  const withTransition = bare.length >= 2 && transition > 0;
  const pad = withTransition ? transition : 0;
  const plans = pad > 0 ? planParagraphs(transcript, audio, { ...timeline, padLead: pad, padTail: pad }) : bare;

  const contentMs = plans.reduce((sum, p) => sum + p.duration * 1000, 0);

  // 段落过场卡：纯增量插入，后续片段整体右移，不需要改时间轴模型
  const chapterEnabled = bool(cfg.CHAPTER_CARD, false);
  const chapterSec = Math.max(0, numberOrZero(cfg.CHAPTER_DURATION, 2));
  const useChapters = !cards && chapterEnabled && chapterSec > 0 && plans.length > 1;
  let chapterCount = 0;
  let chapterMs = 0;
  /** 上一段是不是卡片：卡片前后都用 fade，正片之间保持原来的轮换转场 */
  let afterCard = false;

  const clips: string[] = [];
  const transitionStyles: string[] = [];

  /** 片段入列时顺带记下它与前一片段之间的转场风格 */
  const addClip = (file: string, style?: string): void => {
    if (clips.length > 0) transitionStyles.push(style ?? xfadeStyle(mode, clips.length));
    clips.push(file);
  };

  if (introClip) addClip(introClip);

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;

    const materialItem = material.items.find((item) => item.paragraph === plan.index) ?? material.items[i];
    if (!materialItem) throw new Error(`第 ${plan.index} 段缺少素材`);

    // 有素材就正常渲染；没素材或文件丢了就出设计卡，不中断整条流水线
    const materialPaths: string[] = [];
    if (materialItem.fallback || !materialItem.videoPath || !fs.existsSync(materialItem.videoPath)) {
      materialPaths.push(await renderFallbackCard(ctx, plan, clipsDir, fps));
    } else {
      materialPaths.push(
        materialItem.videoPath,
        ...(materialItem.shots ?? []).map((shot) => shot.videoPath).filter((file) => fs.existsSync(file)),
      );
    }

    // 过场卡插在本段之前，后续片段整体右移即可，音频与字幕都在各自片段内部
    if (cards) {
      const chapterSpec = cardChapters.get(plan.index);
      if (chapterSpec) {
        ctx.markStage("compose", "running", `第 ${i + 1} 段过场卡`);
        const file = await ensureCardVideo(ctx, chapterSpec, cardTotal);
        if (file) {
          addClip(file, "fade");
          afterCard = true;
          chapterCount++;
          chapterMs += (await clipSeconds(file, chapterSpec.durationSec)) * 1000;
        } else {
          missingCards++;
          ctx.log(`第 ${i + 1} 段过场卡「${chapterSpec.title}」没渲染出来，成片缺这张卡`, "error");
        }
      }
    } else if (useChapters && i > 0) {
      const chapterFile = path.join(clipsDir, `chapter-${i}.mp4`);
      let ok = fs.existsSync(chapterFile) && fs.statSync(chapterFile).size > 0;

      if (!ok) {
        ctx.markStage("compose", "running", `第 ${i + 1} 段过场卡`);
        ok = await renderChapter({
          title: chapterTitle(plan),
          index: i + 1,
          total: plans.length,
          width: ctx.options.width,
          height: ctx.options.height,
          fps,
          durationSec: chapterSec,
          output: chapterFile,
          signal: ctx.signal,
        });
      }

      if (ok) {
        addClip(chapterFile, "fade");
        afterCard = true;
        chapterCount++;
        chapterMs += chapterSec * 1000;
      } else {
        ctx.log(`第 ${i + 1} 段过场卡渲染失败，本次跳过`, "warn");
      }
    }

    ctx.markStage("compose", "running", `第 ${plan.index}/${plans.length} 段`);
    ctx.log(
      `合成第 ${plan.index} 段（${plan.duration.toFixed(1)}s，${plan.sentences.length} 句${
        materialPaths.length > 1 ? `，${materialPaths.length} 个镜头` : ""
      }）`,
    );

    let lastPercent = -1;
    const clip = await renderParagraph(ctx, plan, materialPaths, subsDir, clipsDir, (ratio) => {
      const percent = Math.floor((ratio * 100) / 10) * 10;
      if (percent !== lastPercent) {
        lastPercent = percent;
        ctx.markStage("compose", "running", `第 ${plan.index}/${plans.length} 段 ${percent}%`);
      }
    });
    addClip(clip, afterCard ? "fade" : undefined);
    afterCard = false;
  }

  if (outroClip) addClip(outroClip);

  const totalDurationMs = contentMs + introSec * 1000 + outroActualSec * 1000 + chapterMs;

  if (chapterCount > 0) {
    ctx.log(
      cards
        ? `已插入 ${chapterCount} 张章节卡（共 ${(chapterMs / 1000).toFixed(1)}s）`
        : `已插入 ${chapterCount} 张段落过场卡（每张 ${chapterSec}s）`,
    );
  }

  ctx.markStage("compose", "running", "合并片段");

  const render = renderOptions(cfg, ctx.options);
  const withTransitions = clips.length >= 2 && withTransition;

  const musicRef = (ctx.options.bgmFile ?? "").trim();
  const bgmEnabled = ctx.options.bgmEnabled ?? bool(cfg.BGM_ENABLED, true);
  let bgm: string | null = null;
  let bgmCustom = false;
  if (bgmEnabled) {
    const prepared = await prepareBgm({
      output: path.join(ctx.workspace, "_bgm.wav"),
      durationSec: totalDurationMs / 1000,
      ref: musicRef,
    });
    bgm = prepared.plan?.file ?? null;
    bgmCustom = Boolean(prepared.plan?.custom);
    if (prepared.reason) ctx.log(prepared.reason, "warn");
    if (!bgm) ctx.log("BGM 生成失败，跳过混音", "warn");
  } else {
    ctx.log("配置里关掉了 BGM，本次只保留配音");
  }

  // 音效与 BGM 独立：关掉 BGM 也可以保留转场音效
  let sfx: SfxFiles | null = null;
  if (bool(cfg.SFX_ENABLED, true)) {
    const [whoosh, impact] = await Promise.all([ensureSfx("whoosh"), ensureSfx("impact")]);
    if (whoosh || impact) {
      sfx = { whoosh, impact, volume: Math.min(1, numberOrZero(cfg.SFX_VOLUME, 0.2)) };
    } else {
      ctx.log("音效生成失败，本次不加音效", "warn");
    }
  }

  ctx.log(
    `合并 ${clips.length} 个片段${bgm ? ` 并混入${bgmCustom ? "自定义" : "程序合成"} BGM` : ""}${
      withTransitions ? `，转场 ${transition}s（${mode === "mixed" ? "轮换" : "淡入淡出"}）` : ""
    }${sfx ? "，已加转场音效" : ""}`,
  );

  const encode = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
  ];

  const mergeOptions: MergeOptions = {
    ctx,
    clips,
    transition,
    transitionMode: mode,
    transitionStyles,
    output,
    encode,
    bgm,
    sfx,
    totalDurationMs,
    render,
  };
  if (withTransitions) await mergeWithTransitions(mergeOptions);
  else await mergeByConcat(mergeOptions);

  if (missingCards > 0) {
    ctx.log(`注意：本次成片缺少 ${missingCards} 张已确认的版式卡`, "error");
  }
  // 合完才写完成标记，下次复用前会先对一遍
  fs.writeFileSync(marker, outputStamp(output), "utf-8");

  const missingNote = missingCards > 0 ? ` / 缺 ${missingCards} 张版式卡` : "";
  ctx.markStage("compose", "done", `${clips.length} 段 / ${(totalDurationMs / 1000).toFixed(1)}s${missingNote}`);
  return output;
}
