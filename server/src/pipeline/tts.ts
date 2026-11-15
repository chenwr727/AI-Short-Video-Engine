import fs from "node:fs";
import path from "node:path";
import { loadConfig, num } from "../config.js";
import { audioDuration, detectAudioExt } from "../services/audio.js";
import { createTtsEngine, type TtsEngineRuntime } from "../services/tts.js";
import type {
  AudioDialogue,
  AudioFileInfo,
  AudioManifest,
  AudioParagraph,
  TaskContext,
  Transcript,
  TtsEngine,
} from "../types.js";
import { voicesFor } from "../voices.js";

const MANIFEST = "_durations.json";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

function existingAudio(dir: string, base: string): string | null {
  for (const ext of ["wav", "mp3"] as const) {
    const file = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(file) && fs.statSync(file).size > 1024) return file;
  }
  return null;
}

function voiceList(engine: TtsEngine): string[] {
  return voicesFor(engine).map((voice) => voice.id);
}

async function synthesizeWithRetry(
  ctx: TaskContext,
  engine: TtsEngineRuntime,
  text: string,
  voice: string,
  retries = 3,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await engine.synthesize({ text, voice, signal: ctx.signal });
    } catch (error) {
      lastError = error;
      if (ctx.signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      ctx.log(`配音失败（第 ${attempt + 1}/${retries} 次）：${message}`, "warn");
      if (attempt < retries - 1) await sleep(2000, ctx.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 配音阶段：按 (段, 对话, 句) 逐条合成，文件名与 Python 版一致（i_j_k.wav）。
 * 已存在的音频直接复用，因此中断后重跑只补缺失的部分。
 */
export async function runTtsStage(ctx: TaskContext, transcript: Transcript): Promise<AudioManifest> {
  const manifestFile = path.join(ctx.workspace, MANIFEST);
  if (fs.existsSync(manifestFile)) {
    const cached = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as AudioManifest;
    ctx.log("复用已生成的配音清单（_durations.json）");
    ctx.markStage("tts", "skipped", "命中缓存");
    return cached;
  }

  ctx.markStage("tts", "running");
  const cfg = loadConfig();
  // 语速以配音页选的为准，没选就用配置里的 TTS_SPEED
  const speed = ctx.options.ttsSpeed > 0 ? ctx.options.ttsSpeed : num(cfg.TTS_SPEED, 1.1);
  const engine = createTtsEngine({ ...cfg, TTS_SPEED: String(speed) }, ctx.options.ttsEngine);
  const voices = voiceList(ctx.options.ttsEngine);
  ctx.log(`配音引擎：${ctx.options.ttsEngine} / ${engine.model} · 语速 ${speed.toFixed(2)}×`);

  // 同一角色固定使用同一音色；前端指定了角色音色就优先用，否则按顺序轮换
  const speakerVoice = new Map<string, string>();
  const preset = ctx.options.voiceMap ?? {};
  let nextVoice = 0;
  for (const paragraph of transcript.paragraphs) {
    for (const dialogue of paragraph.dialogues) {
      if (!speakerVoice.has(dialogue.speaker)) {
        const picked = preset[dialogue.speaker];
        const valid = picked && voices.includes(picked) ? picked : voices[nextVoice % voices.length];
        speakerVoice.set(dialogue.speaker, valid as string);
        nextVoice++;
      }
    }
  }
  ctx.log(`音色分配：${[...speakerVoice].map(([speaker, voice]) => `${speaker}=${voice}`).join("，")}`);

  const paragraphs: AudioParagraph[] = [];
  let totalDuration = 0;

  for (let pi = 0; pi < transcript.paragraphs.length; pi++) {
    const paragraph = transcript.paragraphs[pi];
    if (!paragraph) continue;
    ctx.markStage("tts", "running", `第 ${pi + 1}/${transcript.paragraphs.length} 段`);

    const dialogues: AudioDialogue[] = [];
    let paragraphDuration = 0;

    for (let di = 0; di < paragraph.dialogues.length; di++) {
      const dialogue = paragraph.dialogues[di];
      if (!dialogue) continue;

      const voice = speakerVoice.get(dialogue.speaker) ?? (voices[0] as string);
      const texts = dialogue.contentsTts.length > 0 ? dialogue.contentsTts : dialogue.contents;
      const files: AudioFileInfo[] = [];
      const base = `${pi + 1}_${di + 1}`;

      for (let si = 0; si < texts.length; si++) {
        const text = (texts[si] ?? "").trim();
        if (!text) continue;

        let file = existingAudio(ctx.workspace, `${base}_${si + 1}`);
        if (file) {
          ctx.log(`复用音频 ${path.basename(file)}`);
        } else {
          const buf = await synthesizeWithRetry(ctx, engine, text, voice);
          file = path.join(ctx.workspace, `${base}_${si + 1}.${detectAudioExt(buf)}`);
          fs.writeFileSync(file, buf);
        }

        const duration = await audioDuration(file);
        files.push({ file: path.basename(file), duration, text });
        paragraphDuration += duration;
      }

      const dialogueDuration = files.reduce((sum, f) => sum + f.duration, 0);
      dialogues.push({ speaker: dialogue.speaker, voice, duration: dialogueDuration, files });
      ctx.log(`第 ${pi + 1} 段 · ${dialogue.speaker}（${voice}）：${files.length} 句 / ${dialogueDuration.toFixed(1)}s`);
    }

    paragraphs.push({ index: pi + 1, duration: paragraphDuration, dialogues });
    totalDuration += paragraphDuration;
  }

  const manifest: AudioManifest = {
    engine: ctx.options.ttsEngine,
    model: engine.model,
    paragraphs,
    totalDuration,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");
  ctx.markStage("tts", "done", `${paragraphs.length} 段 / ${totalDuration.toFixed(1)}s`);
  return manifest;
}
