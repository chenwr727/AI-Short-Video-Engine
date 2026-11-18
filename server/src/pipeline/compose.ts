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
import { probeVideo } from "../services/probe.js";
import { buildAss, charsPerLine, type SubtitleCue } from "../services/subtitle.js";
import type { AudioManifest, GenerateOptions, MaterialManifest, TaskContext, Transcript } from "../types.js";

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
const SUBTITLE_STYLE_VERSION = 3;
const CLIP_CRF = "18";
const CLIP_PRESET = "veryfast";
const CLIP_SIG_SUFFIX = ".json";

interface RenderOptions {
  bgmVolume: number;
  bgmFadeIn: number;
  bgmFadeOut: number;
  videoFadeIn: number;
  videoFadeOut: number;
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
function planParagraphs(transcript: Transcript, audio: AudioManifest, o: TimelineOptions): ParagraphPlan[] {
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
function clipSignature(plan: ParagraphPlan, materialPath: string, width: number, height: number, fps: number, fontSize: number): string {
  let material = "";
  try {
    const stat = fs.statSync(materialPath);
    material = `${path.basename(materialPath)}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    material = path.basename(materialPath);
  }

  return JSON.stringify({
    material,
    width,
    height,
    fps,
    fontSize,
    style: SUBTITLE_STYLE_VERSION,
    duration: Number(plan.duration.toFixed(3)),
    sentences: plan.sentences.map((s) => [s.file, Number(s.start.toFixed(3))]),
    cues: plan.cues.map((c) => [c.text, Number(c.start.toFixed(3)), Number(c.end.toFixed(3)), c.style]),
  });
}

async function renderParagraph(
  ctx: TaskContext,
  plan: ParagraphPlan,
  materialPath: string,
  subsDir: string,
  clipsDir: string,
  onProgress: (ratio: number) => void,
): Promise<string> {
  const cfg = loadConfig();
  const fps = ctx.options.fps > 0 ? ctx.options.fps : num(cfg.FPS, 24);
  const { width, height } = ctx.options;
  const fontSize = subtitleFontSize(cfg, ctx.options);

  const clipFile = path.join(clipsDir, `${plan.index}.mp4`);
  const sigFile = path.join(clipsDir, `${plan.index}.mp4${CLIP_SIG_SUFFIX}`);
  const signature = clipSignature(plan, materialPath, width, height, fps, fontSize);

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

  const args: string[] = ["-stream_loop", "-1", "-i", materialPath];
  for (const sentence of plan.sentences) {
    args.push("-i", path.join(ctx.workspace, sentence.file));
  }

  const filters: string[] = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},ass=subs/${plan.index}.ass[v]`,
  ];

  const audioLabels: string[] = [];
  plan.sentences.forEach((sentence, index) => {
    const delayMs = Math.round(sentence.start * 1000);
    filters.push(
      `[${index + 1}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[a${index}]`,
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

interface MergeOptions {
  ctx: TaskContext;
  clips: string[];
  /** 0 表示直接拼接 */
  transition: number;
  output: string;
  encode: string[];
  bgm: string | null;
  totalDurationMs: number;
  render: RenderOptions;
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
  const { ctx, clips, transition, output, encode, bgm, totalDurationMs, render } = options;

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
  for (let k = 1; k < clips.length; k++) {
    const offset = Math.max(0, elapsed - fade);
    filters.push(
      `[${videoLabel}][v${k}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[vx${k}]`,
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

  if (bgm) {
    args.push("-stream_loop", "-1", "-i", bgm);
    filters.push(`[${clips.length}:a]${bgmChain(render, outputSec)}[b]`);
    filters.push(`[${audioLabel}][b]amix=inputs=2:duration=first:normalize=0[aout]`);
    audioLabel = "aout";
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, ...encode);
  if (bgm) args.push("-shortest");
  args.push(output);

  await runFfmpeg(args, { cwd: ctx.workspace, signal: ctx.signal, totalMs: outputSec * 1000 });
}

/** concat 拼接，无需后处理时直接流拷贝 */
async function mergeByConcat(options: MergeOptions): Promise<void> {
  const { ctx, clips, output, encode, bgm, totalDurationMs, render } = options;

  const listFile = path.join(ctx.workspace, "listfile.txt");
  fs.writeFileSync(
    listFile,
    `${clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n")}\n`,
    "utf-8",
  );

  const needFilter = Boolean(bgm) || render.videoFadeIn > 0 || render.videoFadeOut > 0;
  if (!needFilter) {
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output], {
      cwd: ctx.workspace,
      signal: ctx.signal,
      totalMs: totalDurationMs,
    });
    return;
  }

  const durations = await clipDurations(ctx, clips, totalDurationMs);
  const outputSec = Math.max(0.1, durations.reduce((sum, d) => sum + d, 0));
  const videoChain = videoFadeChain(render, outputSec);

  const args: string[] = ["-f", "concat", "-safe", "0", "-i", listFile];
  const filters: string[] = [`[0:v]${videoChain.length > 0 ? videoChain.join(",") : "null"}[v]`];

  let audioMap = "0:a";
  if (bgm) {
    args.push("-stream_loop", "-1", "-i", bgm);
    filters.push(`[1:a]${bgmChain(render, outputSec)}[b]`);
    filters.push("[0:a][b]amix=inputs=2:duration=first:normalize=0[a]");
    audioMap = "[a]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", audioMap, ...encode);
  if (bgm) args.push("-shortest");
  args.push(output);

  await runFfmpeg(args, { cwd: ctx.workspace, signal: ctx.signal, totalMs: totalDurationMs });
}

/** 分段渲染 → 合并 → 混入 BGM */
export async function runComposeStage(
  ctx: TaskContext,
  transcript: Transcript,
  audio: AudioManifest,
  material: MaterialManifest,
): Promise<string> {
  const output = path.join(ctx.workspace, "_output.mp4");
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    ctx.log("复用已生成的成片（_output.mp4）");
    ctx.markStage("compose", "skipped", "命中缓存");
    return output;
  }

  ctx.markStage("compose", "running");
  const clipsDir = ensureDir(path.join(ctx.workspace, "clips"));
  const subsDir = ensureDir(path.join(ctx.workspace, "subs"));

  const cfg = loadConfig();
  const transition = numberOrZero(cfg.TRANSITION_DURATION, 0);
  const timeline = {
    titleDuration: numberOrZero(cfg.TITLE_DURATION, 0),
    interval: numberOrZero(cfg.SUBTITLE_INTERVAL, 0),
  };

  // 多段且有转场时才补首尾留白
  const bare = planParagraphs(transcript, audio, { ...timeline, padLead: 0, padTail: 0 });
  if (bare.length === 0) throw new Error("没有可合成的段落");

  const withTransition = bare.length >= 2 && transition > 0;
  const pad = withTransition ? transition : 0;
  const plans =
    pad > 0 ? planParagraphs(transcript, audio, { ...timeline, padLead: pad, padTail: pad }) : bare;

  const totalDurationMs = plans.reduce((sum, p) => sum + p.duration * 1000, 0);
  const clips: string[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;

    const materialItem = material.items.find((item) => item.paragraph === plan.index) ?? material.items[i];
    if (!materialItem) throw new Error(`第 ${plan.index} 段缺少素材`);

    ctx.markStage("compose", "running", `第 ${plan.index}/${plans.length} 段`);
    ctx.log(`合成第 ${plan.index} 段（${plan.duration.toFixed(1)}s，${plan.sentences.length} 句）`);

    let lastPercent = -1;
    const clip = await renderParagraph(ctx, plan, materialItem.videoPath, subsDir, clipsDir, (ratio) => {
      const percent = Math.floor((ratio * 100) / 10) * 10;
      if (percent !== lastPercent) {
        lastPercent = percent;
        ctx.markStage("compose", "running", `第 ${plan.index}/${plans.length} 段 ${percent}%`);
      }
    });
    clips.push(clip);
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

  ctx.log(
    `合并 ${clips.length} 个片段${bgm ? ` 并混入${bgmCustom ? "自定义" : "程序合成"} BGM` : ""}${
      withTransitions ? `，转场 ${transition}s` : ""
    }`,
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

  const mergeOptions: MergeOptions = { ctx, clips, transition, output, encode, bgm, totalDurationMs, render };
  if (withTransitions) await mergeWithTransitions(mergeOptions);
  else await mergeByConcat(mergeOptions);

  ctx.markStage("compose", "done", `${clips.length} 段 / ${(totalDurationMs / 1000).toFixed(1)}s`);
  return output;
}
