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
import { buildAss, type SubtitleCue } from "../services/subtitle.js";
import type { AudioManifest, GenerateOptions, MaterialManifest, TaskContext, Transcript } from "../types.js";

/** 字幕使用系统字体（不再打包字体文件）；Windows 自带微软雅黑，其他平台由 libass 回退 */
const SUBTITLE_FONT = "Microsoft YaHei";
const SUBTITLE_POSITION_RATIO = 0.667;
const SUBTITLE_STROKE = 1;
const TITLE_STROKE = 2;
const TITLE_DURATION = 0.5;
const SUBTITLE_INTERVAL = 0.2;
/** BGM_VOLUME 只是兜底默认值，实际取配置项 BGM_VOLUME */
const BGM_VOLUME = 0.1;

/** 渲染参数：全部可在配置文件/环境变量里改，这里只负责合并默认值 */
interface RenderOptions {
  bgmVolume: number;
  bgmFadeIn: number;
  bgmFadeOut: number;
  videoFadeIn: number;
  videoFadeOut: number;
}

/** 任务级参数（成片页里改的）优先，其次配置项，最后内置默认 */
function renderOptions(cfg: AppConfig, options: GenerateOptions): RenderOptions {
  return {
    bgmVolume: options.bgmVolume ?? numberOrZero(cfg.BGM_VOLUME, BGM_VOLUME),
    bgmFadeIn: numberOrZero(cfg.AUDIO_FADE_IN, 0),
    bgmFadeOut: numberOrZero(cfg.AUDIO_FADE_OUT, 0),
    videoFadeIn: numberOrZero(cfg.VIDEO_FADE_IN, 0),
    videoFadeOut: numberOrZero(cfg.VIDEO_FADE_OUT, 0),
  };
}

/** 字幕字号：成片页填了就优先，否则用配置项；0/自动都在这里解析成具体 px */
function subtitleFontSize(cfg: AppConfig, options: GenerateOptions): number {
  const size = options.subtitleFontSize ?? numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0);
  return size > 0 ? size : autoSubtitleFontSize(options.width);
}

/** 淡入淡出不能吃掉整段画面，最多用掉时长的 1/3 */
function clampFade(value: number, durationSec: number): number {
  if (value <= 0) return 0;
  return Math.min(value, Math.max(0.1, durationSec / 3));
}

/** 画面淡入淡出（作用在合并后的视频轨上） */
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

/** BGM 音量 + 淡入淡出：只作用在音乐轨上，不动人声 */
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
}

/** 复刻 Python 的时间轴：首段首句前插标题 0.5s，其余每句前留 0.2s 间隔 */
function planParagraphs(transcript: Transcript, audio: AudioManifest): ParagraphPlan[] {
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
          if (title) cues.push({ text: title, start: 0, end: TITLE_DURATION, style: "Title" });
          cursor += TITLE_DURATION;
        } else {
          cursor += SUBTITLE_INTERVAL;
        }

        const start = cursor;
        sentences.push({ file: info.file, text: info.text, start });
        cues.push({ text: info.text, start, end: start + info.duration, style: "Subtitle" });
        cursor = start + info.duration;
      }
    }

    if (sentences.length > 0) {
      plans.push({ index: pi + 1, sentences, cues, duration: cursor });
    }
  }

  return plans;
}

function assOptions(width: number, height: number, fontSize: number) {
  const subtitleWidth = Math.round(width * SUBTITLE_WIDTH_RATIO);
  const sideMargin = Math.round((width - subtitleWidth) / 2);
  // 字号：正常调用永远给的是具体 px，0 只作兜底（按画宽自动）
  const subtitleSize = fontSize > 0 ? Math.round(fontSize) : autoSubtitleFontSize(width);
  return {
    width,
    height,
    fontName: SUBTITLE_FONT,
    subtitleSize,
    // 标题跟着字幕字号等比放大，改字号时整体比例不变
    titleSize: Math.round(subtitleSize * TITLE_SIZE_RATIO),
    subtitleMarginV: Math.round(height - height * SUBTITLE_POSITION_RATIO),
    titleMarginV: 0,
    marginL: sideMargin,
    marginR: sideMargin,
    subtitleOutline: SUBTITLE_STROKE,
    titleOutline: TITLE_STROKE,
    // 一行最多放几个全角字：字幕区宽度 ÷ 字号（留一点余量给描边）
    maxChars: Math.max(6, Math.floor(subtitleWidth / Math.max(1, subtitleSize))),
  };
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
  const fps = num(cfg.FPS, 24);
  const { width, height } = ctx.options;

  const clipFile = path.join(clipsDir, `${plan.index}.mp4`);
  if (fs.existsSync(clipFile) && fs.statSync(clipFile).size > 0) {
    ctx.log(`复用已渲染片段 ${path.basename(clipFile)}`);
    return clipFile;
  }

  const assFile = path.join(subsDir, `${plan.index}.ass`);
  fs.writeFileSync(assFile, buildAss(plan.cues, assOptions(width, height, subtitleFontSize(cfg, ctx.options))), "utf-8");

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
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[a]`);
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    plan.duration.toFixed(3),
    "-r",
    String(fps),
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
    clipFile,
  );

  await runFfmpeg(args, {
    cwd: ctx.workspace,
    signal: ctx.signal,
    totalMs: plan.duration * 1000,
    onProgress,
  });

  return clipFile;
}

interface MergeOptions {
  ctx: TaskContext;
  clips: string[];
  /** 转场秒数，0 表示直接拼接 */
  transition: number;
  output: string;
  encode: string[];
  bgm: string | null;
  totalDurationMs: number;
  render: RenderOptions;
}

/** 探测片段时长，失败时退化为按总时长均分，避免因 ffprobe 异常中断合成 */
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

/** 用 xfade / acrossfade 把片段带转场地串成一条，可选画面淡入淡出与 BGM（必须重编码） */
async function mergeWithTransitions(options: MergeOptions): Promise<void> {
  const { ctx, clips, transition, output, encode, bgm, totalDurationMs, render } = options;

  const durations = await clipDurations(ctx, clips, totalDurationMs);

  // 转场不能长于最短片段的一半，否则 xfade 会没有可用素材
  const shortest = Math.min(...durations);
  const fade = Math.max(0.1, Math.min(transition, shortest / 2));
  if (fade < transition) {
    ctx.log(`转场 ${transition}s 对最短片段 ${shortest.toFixed(2)}s 过长，已收敛为 ${fade.toFixed(2)}s`, "warn");
  }

  const filters: string[] = [];

  // 统一时间基，xfade 要求两条流的 tb 一致
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

  // 转场会吃掉重叠的部分，成片时长按这个算，淡出起点才不会落在片尾之后
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

/**
 * 不带转场：concat 直接拼接；需要淡入淡出或 BGM 时再套一层滤镜（必须重编码）。
 * 三个开关全关就直接流拷贝，最快。
 */
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

/** 分段渲染 → concat 合并 → 混入 BGM */
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

  const plans = planParagraphs(transcript, audio);
  if (plans.length === 0) throw new Error("没有可合成的段落");

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

  const cfg = loadConfig();
  const render = renderOptions(cfg, ctx.options);
  // 转场允许显式设为 0（num 会把 0 当无效值）
  const transition = numberOrZero(cfg.TRANSITION_DURATION, 0);
  const withTransition = clips.length >= 2 && transition > 0;

  // BGM：成片页的开关优先于配置，关掉就完全不混（即使填了自定义音乐）
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
      withTransition ? `，转场 ${transition}s` : ""
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
  if (withTransition) await mergeWithTransitions(mergeOptions);
  else await mergeByConcat(mergeOptions);

  ctx.markStage("compose", "done", `${clips.length} 段 / ${(totalDurationMs / 1000).toFixed(1)}s`);
  return output;
}
