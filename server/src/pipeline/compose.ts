import crypto from "node:crypto";
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
import { seedFrom, shuffledIndex } from "./variation.js";
import { prepareBgm } from "../services/bgm.js";
import { runFfmpeg } from "../services/ffmpeg.js";
import { ensureSfx } from "../services/sfx.js";
import {
  lastRenderErrorMessage,
  renderChapter,
  renderIntro,
  renderOutro,
  renderQuote,
  renderSubtitleLayer,
} from "../services/remotion.js";
import { ensureCardLayer, ensureCardVideo, normalizeCard } from "./cards.js";
import { transcriptFingerprint } from "./tts.js";
import { probeVideo } from "../services/probe.js";
import { buildAss, charsPerLine, layoutCueText, type SubtitleCue } from "../services/subtitle.js";
import type {
  AudioManifest,
  CardManifest,
  CardSpec,
  GenerateOptions,
  MaterialManifest,
  TaskContext,
  Transcript,
} from "../types.js";
import { stageText, userError } from "../errors.js";
import { logText } from "../logs.js";

/** 其他平台由 libass 回退 */
const SUBTITLE_FONT = "Microsoft YaHei";
const SUBTITLE_POSITION_RATIO = 0.667;
const SUBTITLE_STROKE_RATIO = 1 / 24;
const TITLE_STROKE_RATIO = 1 / 20;
const MIN_STROKE = 1;
/** AABBGGRR */
const SHADOW_COLOUR = "&H80000000";
const BGM_VOLUME = 0.1;
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

/**
 * 这条视频的外观种子。
 *
 * 默认由剧本标题派生：不同选题得到不同的运镜/转场序列，
 * 同一条视频重跑结果完全一致（缓存仍然有效）。
 * 标题相同但想换一套观感时，在配置里设 VARIATION_SEED 覆盖。
 */
function variationSeed(cfg: AppConfig, transcript: Transcript): number {
  const manual = (cfg.VARIATION_SEED ?? "").trim();
  if (manual) return seedFrom(manual);
  return seedFrom(`${transcript.title}|${transcript.paragraphs.length}`);
}

/**
 * 把「观感强度 + 种子」压成片段签名用的短串。
 *
 * 种子必须进去：运镜方向由「种子洗牌 + 段落序号」决定，
 * 换种子就换方向，不重渲会命中上一条视频的片段缓存。
 */
function lookKey(look: LookOptions, seed: number): string {
  return `motion:${look.motion};grade:${look.grade}${seed ? `;seed:${seed}` : ""}`;
}

/**
 * 运镜：zoompan 的 x/y 逐帧求值，比 scale 的时变表达式稳。
 * 输入先预放大 MOTION_PAD 倍，所以 zoom=1 时仍是原构图。
 * on 最大到 frames-1，缩放值永远落在 [1, maxZoom) 内，不必额外 clamp。
 */
function motionChain(
  plan: ParagraphPlan,
  width: number,
  height: number,
  fps: number,
  level: number,
  seed: number,
): string | null {
  if (level <= 0) return null;

  const frames = Math.max(1, Math.round(plan.duration * fps));
  const maxZoom = 1 + 0.012 * level;
  const rate = (maxZoom - 1) / frames;
  const tail = `d=1:s=${width}x${height}:fps=${fps}`;
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";

  // 按种子洗牌后取用：同一段保持稳定（缓存有效），不同视频的序列不同
  const pick = shuffledIndex(plan.index, 4, seed);
  switch (pick) {
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

/** mixed 模式下按种子洗牌轮换转场，fade 模式保持单一淡入淡出 */
function xfadeStyle(mode: TransitionMode, index: number, seed: number): string {
  if (mode !== "mixed") return "fade";
  return XFADE_MIXED[shuffledIndex(index, XFADE_MIXED.length, seed)] ?? "fade";
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
  /**
   * 首段前面还排着一张卡（片头或第 1 段的章节卡）。
   * 首段本身没有前置留白，但卡片是靠 xfade 压上来的，
   * 不垫 padLead 的话首句配音和字幕会在卡片还没退场时就冒出来。
   */
  leadCard?: boolean;
  /** 末段后面还排着一张卡（片尾），同理需要尾部留白 */
  tailCard?: boolean;
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

  // 首段不垫片头、末段不垫片尾；但外面还挂着卡片时，它同样要靠留白让出转场窗口
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;
    plan.padLead = i === 0 ? (o.leadCard ? o.padLead : 0) : o.padLead;
    plan.padTail = i === plans.length - 1 ? (o.tailCard ? o.padTail : 0) : o.padTail;
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
    ctx.log(logText("designCardUsed", { n: plan.index, quote: quoteText }));
    return quoteFile;
  }

  const placeholder = path.join(clipsDir, `${plan.index}.placeholder.mp4`);
  ctx.log(logText("designCardFailed", { n: plan.index }), "warn");
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

/**
 * 只看画面要素：素材、画幅、运镜调色、时间轴。
 * 字幕不在这里——它在合并阶段才烧上去，改字号或文案不必重渲素材。
 */
export function clipSignature(
  plan: ParagraphPlan,
  materialPath: string | string[],
  width: number,
  height: number,
  fps: number,
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
    look,
    duration: Number(plan.duration.toFixed(3)),
    sentences: plan.sentences.map((s) => [s.file, Number(s.start.toFixed(3))]),
  });
}

async function renderParagraph(
  ctx: TaskContext,
  plan: ParagraphPlan,
  materialPaths: string[],
  clipsDir: string,
  onProgress: (ratio: number) => void,
  /** 整段就是一张信息卡（没有素材）：它已是最终画面，不该再被运镜推拉 */
  isCard = false,
  /** 透明信息层（VP9 alpha）：叠在素材上，素材的运镜保持不变 */
  overlayLayer?: string,
  /** 外观种子：决定运镜方向，不同视频洗牌结果不同 */
  seed = 0,
): Promise<string> {
  const cfg = loadConfig();
  const fps = ctx.options.fps > 0 ? ctx.options.fps : num(cfg.FPS, 24);
  const { width, height } = ctx.options;
  const look = lookOptions(cfg);
  // 卡片不叠加运镜和调色：静态设计图被 zoompan 每秒重采样并放大 1.15 倍再裁回，
  // 文字边缘会持续「蠕动」，观感就是抖
  const effective = isCard ? { ...look, motion: 0, grade: 0 } : look;

  const clipFile = path.join(clipsDir, `${plan.index}.mp4`);
  const sigFile = path.join(clipsDir, `${plan.index}.mp4${CLIP_SIG_SUFFIX}`);
  const signature = clipSignature(plan, materialPaths, width, height, fps, lookKey(effective, seed));
  // 叠了信息层的片段，签名还要带上图层：换了卡片内容必须重渲
  const fullSignature = overlayLayer ? `${signature}|layer:${path.basename(overlayLayer)}` : signature;

  if (fs.existsSync(clipFile) && fs.statSync(clipFile).size > 0) {
    let cached = "";
    try {
      cached = fs.readFileSync(sigFile, "utf-8");
    } catch {
      // 无签名视为不匹配
    }
    if (cached === fullSignature) {
      ctx.log(logText("reuseClip", { file: path.basename(clipFile) }));
      return clipFile;
    }
    ctx.log(logText("clipStale", { n: plan.index }));
    fs.rmSync(clipFile, { force: true });
  }

  // 段内多镜头：按句子边界切时长，每个素材占一段
  const durations = shotDurations(plan, materialPaths.length);
  const shots = materialPaths.slice(0, durations.length);

  const args: string[] = [];
  for (const shot of shots) args.push("-stream_loop", "-1", "-i", shot);
  for (const sentence of plan.sentences) {
    args.push("-i", path.join(ctx.workspace, sentence.file));
  }
  // 信息层放最后：透明层必须显式用 libvpx-vp9 解码，否则 alpha 平面丢失
  if (overlayLayer) args.push("-c:v", "libvpx-vp9", "-i", overlayLayer);

  // 运镜需要推近余量：先放大到 1.15 倍再缩回目标尺寸，避免推近时露出边缘
  const scaledWidth = effective.motion > 0 ? Math.round((width * MOTION_PAD) / 2) * 2 : width;
  const scaledHeight = effective.motion > 0 ? Math.round((height * MOTION_PAD) / 2) * 2 : height;
  const baseChain = [
    `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${scaledWidth}:${scaledHeight}`,
    "setsar=1",
    `fps=${fps}`,
  ];

  // 运镜与调色作用于整段（拼接之后），保证跨镜头连续
  const postChain: string[] = [];
  const motion = motionChain(plan, width, height, fps, effective.motion, seed);
  if (motion) {
    postChain.push(motion);
    // zoompan 会重算像素比，后续叠加字幕层依赖 SAR
    postChain.push("setsar=1");
  }
  postChain.push(...gradeChain(effective.grade));

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

  /*
   * 信息层叠加：素材照常走完缩放/运镜/调色，再把透明的信息层盖上去。
   *
   * 这样底图是真正的素材视频（带运镜），而不是抽出来的一帧静图 ——
   * 之前把素材压成静帧再让 Remotion 渲染，等于主动丢弃了动态画面。
   * 索引 = 素材数 + 句子数：overlay 放在所有输入的最后。
   */
  let videoOut = "v";
  if (overlayLayer) {
    const overlayIndex = shots.length + plan.sentences.length;
    filters.push(`[${overlayIndex}:v]format=yuva420p[olraw]`);
    filters.push(`[v][olraw]overlay=0:0:format=auto[vol]`);
    videoOut = "vol";
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
    `[${videoOut}]`,
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
  fs.writeFileSync(sigFile, fullSignature, "utf-8");
  return clipFile;
}

interface SfxFiles {
  whoosh: string | null;
  impact: string | null;
  /** 0-1，乘到音效本身音量上 */
  volume: number;
}

/** ass = libass 直接烧在视频上；webm = 带 alpha 的 VP9 层，overlay 上去 */
interface SubsLayer {
  file: string;
  kind: "ass" | "webm";
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
  /** 外观种子：决定转场顺序的洗牌结果 */
  seed?: number;
  output: string;
  encode: string[];
  bgm: string | null;
  sfx: SfxFiles | null;
  totalDurationMs: number;
  render: RenderOptions;
  /**
   * 拿到各片段在成片里的起点（秒）后生成整片字幕层；null = 本次不叠字幕。
   * 异步是因为 Remotion 那条路径要真的渲一段视频出来。
   */
  buildSubs?: (starts: number[]) => Promise<SubsLayer | null> | SubsLayer | null;
}

/**
 * 把字幕层挂到当前视频流上。
 * webm 是透明层，必须显式指定 libvpx-vp9 解码——ffmpeg 原生 vp9 解码器不输出 alpha 平面，
 * overlay 上去会得到一块黑底。
 */
function attachSubs(
  filters: string[],
  videoLabel: string,
  subs: SubsLayer,
  inputIndex: number,
): { label: string; usedInput: boolean } {
  if (subs.kind === "ass") {
    filters.push(`[${videoLabel}]ass=${subs.file}[vs]`);
    return { label: "vs", usedInput: false };
  }

  filters.push(`[${inputIndex}:v]format=yuva420p[subraw]`, `[${videoLabel}][subraw]overlay=0:0:format=auto[vs]`);
  return { label: "vs", usedInput: true };
}

/** 转场串联时每个片段的起点：前一片段结束再吃掉重叠部分 */
function transitionStarts(durations: number[], fade: number): number[] {
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < durations.length; i++) {
    starts.push(at);
    at += (durations[i] ?? 0) - fade;
  }
  return starts;
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
    ctx.log(logText("probeFailedAvg"), "warn");
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
    seed = 0,
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
    ctx.log(logText("transitionClamped", { t: transition, short: shortest.toFixed(2), fade: fade.toFixed(2) }), "warn");
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
    const style = transitionStyles?.[k - 1] ?? xfadeStyle(mode, k, seed);
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

  // 字幕放在调色与淡入淡出之后，否则会被暗角、颗粒和首尾淡出一起吃掉
  let nextInput = clips.length;
  const subs = await options.buildSubs?.(transitionStarts(durations, fade));
  if (subs) {
    const attached = attachSubs(filters, videoLabel, subs, nextInput);
    videoLabel = attached.label;
    if (attached.usedInput) {
      args.push("-c:v", "libvpx-vp9", "-i", subs.file);
      nextInput++;
    }
  }

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

  // 有字幕层时不能再走流拷贝，必须重编码一遍
  const needFilter =
    Boolean(bgm) ||
    Boolean(sfx?.impact) ||
    render.videoFadeIn > 0 ||
    render.videoFadeOut > 0 ||
    Boolean(options.buildSubs);
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
  let videoMap = "[v]";

  // 无转场时片段首尾相接，起点就是前面时长累加
  let nextInput = 1;
  const subs = await options.buildSubs?.(transitionStarts(durations, 0));
  if (subs) {
    const attached = attachSubs(filters, "v", subs, nextInput);
    videoMap = `[${attached.label}]`;
    if (attached.usedInput) {
      args.push("-c:v", "libvpx-vp9", "-i", subs.file);
      nextInput++;
    }
  }

  // 无转场时只在片头加一个落点音效
  const audioMix: string[] = ["0:a"];

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

  args.push("-filter_complex", filters.join(";"), "-map", videoMap, "-map", audioMap, ...encode);
  if (bgm) args.push("-shortest");
  args.push(output);

  await runFfmpeg(args, { cwd: ctx.workspace, signal: ctx.signal, totalMs: totalDurationMs });
}

/** 成片旁边写一份「完成标记」：只有正常合完才算数，中途被杀的残留文件不能复用 */
export function outputMarker(output: string): string {
  return `${output}.ok`;
}

function outputStamp(output: string): string {
  const stat = fs.statSync(output);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/**
 * 素材段上的信息卡也进指纹：换卡、改文案都要重合成。
 *
 * 但 bgImage 要排除 —— 它是素材抽帧的数据 URI（几十 KB），只喂「预览静帧」；
 * 真正进成片的是活的素材，透明信息层不带底图。把它算进来会让指纹随抽帧抖动。
 * 键名排序后再拼，避免同一份 spec 因字段顺序不同算出两个指纹。
 */
/**
 * 信息卡在指纹里的表示：只收「决定画面」的字段。
 *
 * 排除三类：
 *   bgImage / videoPath / stillPath —— 渲染产物与底图，不是输入。
 *   bgImage 是 200KB+ 的 data URI；两个路径带工作区绝对路径，
 *   换工作区（另存、迁移）就会让指纹变，画面其实一模一样。
 * 真正代表画面的是 fingerprint（参数指纹），它已经在这里面。
 * 键名排序后再拼，避免同一份 spec 因字段顺序不同算出两个指纹。
 */
export function infoCardKey(spec: CardSpec | undefined): string {
  if (!spec) return "";
  const derived = new Set(["bgImage", "videoPath", "stillPath"]);
  const entries = Object.entries(spec)
    .filter(([key]) => !derived.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * 成片指纹：把「影响成片的一切输入」压成一个短串。
 *
 * 以前只比对文件大小与 mtime，等于只认「文件还是那个文件」，
 * 却不认「参数还是那套参数」——改了转场、字幕字号、静音间隔、画幅之后，
 * 旧成片照样命中缓存，用户会看到「改了没反应」，还以为是功能坏了。
 *
 * 这里刻意只收真正会写进画面的项：
 * - 字幕文案走 transcriptFingerprint（改错别字必须重合成）
 * - cfg 里与合成无关的（API Key、模型名）一律不收，否则改密钥也会白跑一遍
 */
export function composeFingerprint(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
  material: MaterialManifest,
  cards: CardManifest | null | undefined,
  cfg: AppConfig,
  fps: number,
): string {
  const options = ctx.options;
  const payload = {
    // 文案与配音
    transcript: transcriptFingerprint(transcript),
    audio: [audio.engine, audio.model, Number(audio.totalDuration.toFixed(3))],
    sentences: audio.paragraphs.flatMap((p) =>
      p.dialogues.flatMap((d) => d.files.map((f) => `${f.file}:${f.duration.toFixed(3)}`)),
    ),
    // 画幅与帧率进片段签名，但成片也直接受它们影响
    frame: `${options.width}x${options.height}@${fps}`,
    // 素材：段落、镜头、兜底标记。缓存文件本身用路径+sig，改动会换文件
    material: material.items.map((item) => [
      item.paragraph,
      item.videoPath ?? "",
      item.fallback ? "fallback" : "real",
      (item.shots ?? []).map((shot) => shot.videoPath ?? "").join(","),
      infoCardKey(item.infoCard),
    ]),
    // 版式：卡片清单和每张卡的指纹，换卡必然重合成
    cards: (cards?.items ?? []).map((spec) => [spec.id, spec.kind, spec.fingerprint ?? "", spec.durationSec]),
    // 合并期参数：这些只在最后一步生效，片段缓存命中也不会更新
    render: {
      transition: numberOrZero(cfg.TRANSITION_DURATION, 0),
      transitionStyle: transitionMode(cfg),
      subtitleInterval: numberOrZero(cfg.SUBTITLE_INTERVAL, 0),
      subtitleFontSize: options.subtitleFontSize ?? numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0),
      subtitleRender: (cfg.SUBTITLE_RENDER ?? "").trim().toLowerCase(),
      titleDuration: numberOrZero(cfg.TITLE_DURATION, 0),
      motion: Math.min(MAX_MOTION_LEVEL, numberOrZero(cfg.CAMERA_MOTION, 0)),
      grade: Math.min(MAX_MOTION_LEVEL, numberOrZero(cfg.COLOR_GRADE, 0)),
      // 种子决定运镜方向与转场顺序，换了必须重合成
      variationSeed: variationSeed(cfg, transcript),
      bgm: options.bgmEnabled ?? bool(cfg.BGM_ENABLED, true),
      bgmVolume: options.bgmVolume ?? numberOrZero(cfg.BGM_VOLUME, BGM_VOLUME),
      bgmFile: (options.bgmFile ?? "").trim(),
      bgmFade: [numberOrZero(cfg.AUDIO_FADE_IN, 0), numberOrZero(cfg.AUDIO_FADE_OUT, 0)],
      videoFade: [numberOrZero(cfg.VIDEO_FADE_IN, 0), numberOrZero(cfg.VIDEO_FADE_OUT, 0)],
      sfx: bool(cfg.SFX_ENABLED, true) ? numberOrZero(cfg.SFX_VOLUME, 0.2) : "off",
      // 片头/片尾/章节：时长决定出不出，任一改动都要重合成
      intro: numberOrZero(cfg.TITLE_DURATION, 0),
      outro: [(cfg.OUTRO_TITLE ?? "").trim(), (cfg.OUTRO_HANDLE ?? "").trim(), numberOrZero(cfg.OUTRO_DURATION, 0)],
      chapter: numberOrZero(cfg.CHAPTER_DURATION, 2),
    },
  };
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/**
 * 标记格式：`<指纹>\n<大小:时间戳>`。
 * 指纹对不上说明参数变了；戳对不上说明文件被改过或没写完，两种情况都不能复用。
 */
export function isComposedOutput(output: string, fingerprint?: string): boolean {
  try {
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) return false;
    const marker = outputMarker(output);
    if (!fs.existsSync(marker)) return false;
    const text = fs.readFileSync(marker, "utf-8").trim();
    const [markedFingerprint, stamp] = text.split("\n");
    if (stamp === undefined) {
      // 老格式（只有戳）：当参数已变，让它重合成一次，之后就走新格式
      return fingerprint === undefined;
    }
    if (fingerprint !== undefined && markedFingerprint !== fingerprint) return false;
    return stamp.trim() === outputStamp(output);
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

  const cfg = loadConfig();
  const fps = ctx.options.fps > 0 ? ctx.options.fps : num(cfg.FPS, 24);
  // 重算信息卡指纹，让渲染器修复后的旧缓存失效
  for (const item of material.items) {
    if (item.infoCard) {
      item.infoCard = normalizeCard(item.infoCard, cfg, ctx.options.width, ctx.options.height, fps);
    }
  }
  // 观感种子：决定运镜方向与转场顺序，让连续几条视频不撞脸
  const seed = variationSeed(cfg, transcript);
  // 参数一变，旧成片就不再是「这次的成片」，必须重合成
  const fingerprint = composeFingerprint(ctx, transcript, audio, material, cards, cfg, fps);

  if (isComposedOutput(output, fingerprint)) {
    ctx.log(logText("reuseOutput"));
    ctx.markStage("compose", "skipped", stageText("cached"));
    return output;
  }
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    // 分两种原因，方便用户判断是「上次没跑完」还是「改了参数」
    ctx.log(fs.existsSync(marker) ? logText("outputStale") : logText("outputPartial"), "warn");
    fs.rmSync(output, { force: true });
  }
  fs.rmSync(marker, { force: true });

  ctx.markStage("compose", "running");
  const clipsDir = ensureDir(path.join(ctx.workspace, "clips"));
  const subsDir = ensureDir(path.join(ctx.workspace, "subs"));

  const transition = numberOrZero(cfg.TRANSITION_DURATION, 0);
  const mode = transitionMode(cfg);
  const look = lookOptions(cfg);
  if (look.motion > 0 || look.grade > 0) {
    ctx.log(
      logText("lookBoost", {
        motion: look.motion > 0 ? { zh: `${look.motion} 级`, en: `level ${look.motion}` } : { zh: "关", en: "off" },
        grade: look.grade > 0 ? { zh: `${look.grade} 级`, en: `level ${look.grade}` } : { zh: "关", en: "off" },
      }),
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
    if (item.paragraph !== undefined && item.kind === "chapter") cardChapters.set(item.paragraph, item);
  }
  const cardTotal = transcript.paragraphs.length;

  if (cards) {
    const introSpec = cards.items.find((item) => item.kind === "intro");
    if (introSpec) {
      ctx.markStage("compose", "running", stageText("renderIntro"));
      const file = await ensureCardVideo(ctx, introSpec, cardTotal);
      if (file) {
        introClip = file;
        introSec = await clipSeconds(file, introSpec.durationSec);
        // 片头占了标题的时长，ASS 就不再画标题，避免重复
        titleDuration = 0;
        ctx.log(logText("introTitle", { title: introSpec.title }));
      } else {
        missingCards++;
        ctx.log(logText("introCardFailed"), "error");
      }
    }

    const outroSpec = cards.items.find((item) => item.kind === "outro");
    if (outroSpec) {
      ctx.markStage("compose", "running", stageText("renderOutro"));
      const file = await ensureCardVideo(ctx, outroSpec, cardTotal);
      if (file) {
        outroClip = file;
        outroActualSec = await clipSeconds(file, outroSpec.durationSec);
        ctx.log(logText("outroTitle", { title: outroSpec.title }));
      } else {
        missingCards++;
        ctx.log(logText("outroCardFailed"), "error");
      }
    }
  } else {
    // 没开版式阶段时片头时长直接决定是否渲染，失败保留字幕标题
    if (titleDuration > 0) {
      const introFile = path.join(ctx.workspace, "intro.mp4");
      if (fs.existsSync(introFile) && fs.statSync(introFile).size > 0) {
        introClip = introFile;
        ctx.log(logText("reuseRemotionIntro"));
      } else {
        ctx.markStage("compose", "running", stageText("renderIntro"));
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
          ctx.log(logText("remotionIntroUsed"));
        } else {
          ctx.log(logText("remotionIntroUnavailable"), "warn");
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
        ctx.log(logText("reuseRemotionOutro"));
      } else {
        ctx.markStage("compose", "running", stageText("renderOutro"));
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
          ctx.log(logText("remotionOutroUsed"));
        } else {
          ctx.log(logText("remotionOutroUnavailable"), "warn");
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
  if (bare.length === 0) throw userError("noComposeParagraphs", 500);

  const withTransition = bare.length >= 2 && transition > 0;
  const pad = withTransition ? transition : 0;
  // 片头/片尾挂着时，首末段的转场窗口和中间段一样需要让出来
  const plans =
    pad > 0
      ? planParagraphs(transcript, audio, {
          ...timeline,
          padLead: pad,
          padTail: pad,
          leadCard: Boolean(introClip),
          tailCard: Boolean(outroClip),
        })
      : bare;

  const contentMs = plans.reduce((sum, p) => sum + p.duration * 1000, 0);

  // 段落过场卡：纯增量插入，后续片段整体右移，不需要改时间轴模型
  const chapterSec = Math.max(0, numberOrZero(cfg.CHAPTER_DURATION, 2));
  const useChapters = !cards && chapterSec > 0 && plans.length > 1;
  let chapterCount = 0;
  let chapterMs = 0;
  /** 上一段是不是卡片：卡片前后都用 fade，正片之间保持原来的轮换转场 */
  let afterCard = false;

  const clips: string[] = [];
  const transitionStyles: string[] = [];
  /** 与 clips 一一对应：段落给字幕，卡片给 null（卡片自带大字，不能再叠一遍） */
  const cueSets: (SubtitleCue[] | null)[] = [];

  /** 片段入列时顺带记下它与前一片段之间的转场风格 */
  const addClip = (file: string, style?: string, cues: SubtitleCue[] | null = null): void => {
    if (clips.length > 0) transitionStyles.push(style ?? xfadeStyle(mode, clips.length, seed));
    clips.push(file);
    cueSets.push(cues);
  };

  if (introClip) addClip(introClip);

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;

    const materialItem = material.items.find((item) => item.paragraph === plan.index) ?? material.items[i];
    if (!materialItem) throw userError("composeMissingClip", 500, { n: plan.index });

    const materialPaths: string[] = [];
    /*
     * 这一段的画面可能是实拍，也可能叠了一层信息。
     *
     * 有素材时不替换画面：素材照常渲染（保留运镜），信息层做成透明 VP9 叠上去。
     * 只有素材缺失时才退化成「纯卡片整段替代」——那种情况卡片自己就是最终画面。
     */
    const infoSpec = materialItem.infoCard;
    let overlayLayer: string | undefined;
    let cardAsWhole = false;

    if (infoSpec) {
      const hasMaterial =
        !materialItem.fallback && Boolean(materialItem.videoPath) && fs.existsSync(materialItem.videoPath ?? "");
      ctx.markStage("compose", "running", stageText("infoLayer", { i: i + 1 }));
      /*
       * 信息层要跟着旁白逐条上屏：把本段的分句时间交给它，
       * 卡片上的要点各自算出「第几秒出现」。分句时间本来就为字幕算过，直接用。
       */
      const sentences = plan.sentences.map((sentence) => ({ text: sentence.text, start: sentence.start }));

      if (hasMaterial) {
        // 叠层：素材当底，信息层透明覆盖
        const layerPath = await ensureCardLayer(ctx, infoSpec, cardTotal, plan.duration, sentences);
        if (layerPath) {
          overlayLayer = layerPath;
          ctx.log(
            logText("infoLayerOverlay", {
              n: plan.index,
              title: infoSpec.title,
              kind: infoSpec.compositionId,
            }),
          );
        } else {
          missingCards++;
          ctx.log(logText("infoLayerMissing", { n: plan.index }), "warn");
        }
      } else {
        // 没有可用素材：整段用卡片顶上（卡片自带背景）
        const file = await ensureCardVideo(ctx, infoSpec, cardTotal, plan.duration, sentences);
        if (file) {
          materialPaths.push(file);
          cardAsWhole = true;
          ctx.log(logText("infoCardReplaces", { n: plan.index, title: infoSpec.title }));
        } else {
          missingCards++;
          ctx.log(logText("infoCardFallback", { n: plan.index }), "warn");
        }
      }
    }

    // 没有整段卡片时才挑素材：有素材就正常渲染，没素材就出设计卡兜底
    if (materialPaths.length === 0) {
      if (materialItem.fallback || !materialItem.videoPath || !fs.existsSync(materialItem.videoPath)) {
        materialPaths.push(await renderFallbackCard(ctx, plan, clipsDir, fps));
      } else {
        materialPaths.push(
          materialItem.videoPath,
          ...(materialItem.shots ?? []).map((shot) => shot.videoPath).filter((file) => fs.existsSync(file)),
        );
      }
    }

    // 过场卡插在本段之前，后续片段整体右移即可，音频与字幕都在各自片段内部
    if (cards) {
      const chapterSpec = cardChapters.get(plan.index);
      if (chapterSpec) {
        ctx.markStage("compose", "running", stageText("chapterTransition", { i: i + 1 }));
        const file = await ensureCardVideo(ctx, chapterSpec, cardTotal);
        if (file) {
          addClip(file, "fade");
          afterCard = true;
          chapterCount++;
          chapterMs += (await clipSeconds(file, chapterSpec.durationSec)) * 1000;
        } else {
          missingCards++;
          ctx.log(logText("chapterMissing", { n: i + 1, title: chapterSpec.title }), "error");
        }
      }
    } else if (useChapters && i > 0) {
      const chapterFile = path.join(clipsDir, `chapter-${i}.mp4`);
      let ok = fs.existsSync(chapterFile) && fs.statSync(chapterFile).size > 0;

      if (!ok) {
        ctx.markStage("compose", "running", stageText("chapterTransition", { i: i + 1 }));
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
        ctx.log(logText("chapterSkipped", { n: i + 1 }), "warn");
      }
    }

    ctx.markStage("compose", "running", stageText("progress", { i: plan.index, total: plans.length }));
    ctx.log(
      logText("sectionCompose", {
        n: plan.index,
        sec: plan.duration.toFixed(1),
        lines: plan.sentences.length,
        shots:
          materialPaths.length > 1
            ? { zh: `，${materialPaths.length} 个镜头`, en: `, ${materialPaths.length} shots` }
            : "",
      }),
    );

    let lastPercent = -1;
    const clip = await renderParagraph(
      ctx,
      plan,
      materialPaths,
      clipsDir,
      (ratio) => {
        const percent = Math.floor((ratio * 100) / 10) * 10;
        if (percent !== lastPercent) {
          lastPercent = percent;
          ctx.markStage(
            "compose",
            "running",
            stageText("progressPercent", { i: plan.index, total: plans.length, percent }),
          );
        }
      },
      cardAsWhole,
      overlayLayer,
      seed,
    );
    addClip(clip, afterCard ? "fade" : undefined, plan.cues);
    afterCard = false;
  }

  if (outroClip) addClip(outroClip);

  const totalDurationMs = contentMs + introSec * 1000 + outroActualSec * 1000 + chapterMs;

  if (chapterCount > 0) {
    ctx.log(
      cards
        ? logText("chapterInsertedCards", { n: chapterCount, sec: (chapterMs / 1000).toFixed(1) })
        : logText("chapterInsertedPlain", { n: chapterCount, sec: chapterSec }),
    );
  }

  ctx.markStage("compose", "running", stageText("merging"));

  // 字幕整片一次性烧上去：片段本身是纯画面，改字号或文案只需重走这一步
  const subsFile = path.join(subsDir, "all.ass");
  const layerFile = path.join(subsDir, "layer.webm");
  const fontSize = subtitleFontSize(cfg, ctx.options);
  const style = assOptions(ctx.options.width, ctx.options.height, fontSize);
  const wantRemotion = (cfg.SUBTITLE_RENDER ?? "").trim().toLowerCase() === "remotion";

  const buildSubs = async (starts: number[]): Promise<SubsLayer | null> => {
    const merged: SubtitleCue[] = [];
    cueSets.forEach((cues, i) => {
      if (!cues) return;
      const offset = starts[i] ?? 0;
      for (const cue of cues) {
        merged.push({ ...cue, start: cue.start + offset, end: cue.end + offset });
      }
    });
    if (merged.length === 0) return null;

    if (wantRemotion) {
      // 折行交给后端算，两条路径的断行结果才会逐字一致
      const cues = merged.map((cue) => ({
        lines: layoutCueText(cue.text, style).split("\\N"),
        start: cue.start,
        end: cue.end,
        style: cue.style,
      }));
      const ok = await renderSubtitleLayer({
        cues,
        fps,
        durationSec: totalDurationMs / 1000,
        output: layerFile,
        signal: ctx.signal,
        ...style,
      });
      if (ok) return { file: layerFile, kind: "webm" };
      ctx.log(logText("remotionSubtitleUnavailable", { reason: lastRenderErrorMessage() }), "warn");
    }

    fs.writeFileSync(subsFile, buildAss(merged, style), "utf-8");
    return { file: "subs/all.ass", kind: "ass" };
  };

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
    if (!bgm) ctx.log(logText("bgmFailed"), "warn");
  } else {
    ctx.log(logText("bgmOff"));
  }

  // 音效与 BGM 独立：关掉 BGM 也可以保留转场音效
  let sfx: SfxFiles | null = null;
  if (bool(cfg.SFX_ENABLED, true)) {
    const [whoosh, impact] = await Promise.all([ensureSfx("whoosh"), ensureSfx("impact")]);
    if (whoosh || impact) {
      sfx = { whoosh, impact, volume: Math.min(1, numberOrZero(cfg.SFX_VOLUME, 0.2)) };
    } else {
      ctx.log(logText("sfxFailed"), "warn");
    }
  }

  ctx.log(
    logText("mergeSummary", {
      n: clips.length,
      bgm: bgm
        ? {
            zh: ` 并混入${bgmCustom ? "自定义" : "程序合成"} BGM`,
            en: ` with ${bgmCustom ? "custom" : "generated"} BGM`,
          }
        : "",
      transition: withTransitions
        ? {
            zh: `，转场 ${transition}s（${mode === "mixed" ? "轮换" : "淡入淡出"}）`,
            en: `, ${transition}s transitions (${mode === "mixed" ? "alternating" : "crossfade"})`,
          }
        : "",
      sfx: sfx ? { zh: "，已加转场音效", en: ", transition sound effects added" } : "",
    }),
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
    buildSubs,
    transition,
    transitionMode: mode,
    transitionStyles,
    seed,
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
    ctx.log(logText("missingCards", { n: missingCards }), "error");
  }
  // 合完才写完成标记：指纹 + 文件戳，下次复用前两样都要对得上
  fs.writeFileSync(marker, `${fingerprint}\n${outputStamp(output)}`, "utf-8");

  const missingNote = missingCards > 0 ? ` / 缺 ${missingCards} 张版式卡` : "";
  ctx.markStage("compose", "done", `${clips.length} 段 / ${(totalDurationMs / 1000).toFixed(1)}s${missingNote}`, {
    sections: clips.length,
    seconds: Number((totalDurationMs / 1000).toFixed(1)),
    // 缺卡提示也要结构化，否则前端按 counts 现拼时会把这段丢掉
    ...(missingCards > 0 ? { missingCards } : {}),
  });
  return output;
}
