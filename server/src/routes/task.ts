import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { autoSubtitleFontSize, loadConfig, normalizeSpeaker, num, numberOrZero, speakerNames } from "../config.js";
import { MATERIAL_SOURCES, PROMPT_SOURCES, RESOLUTIONS, ttsEngines } from "../meta.js";
import { TaskError, taskManager, type MaterialReplacement } from "../task/manager.js";
import type {
  GenerateOptions,
  MaterialSource,
  PromptSource,
  RawTranscript,
  RenderPatch,
  TtsEngine,
} from "../types.js";

interface GenerateBody {
  input?: string;
  promptSource?: string;
  speakers?: { main?: string; guest?: string };
  ttsEngine?: string;
  voice?: string;
  materialSource?: string;
  resolution?: string;
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof TaskError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(500).send({ error: message });
}

function parseOptions(body: GenerateBody): GenerateOptions {
  const cfg = loadConfig();

  const promptSource = (PROMPT_SOURCES.find((o) => o.id === body.promptSource)?.id ?? "podcast") as PromptSource;

  const speakerDefaults = speakerNames(cfg);
  const speakers = {
    main: normalizeSpeaker(body.speakers?.main, speakerDefaults.main),
    guest: normalizeSpeaker(body.speakers?.guest, speakerDefaults.guest),
  };

  const engines = ttsEngines(cfg);
  const engine = engines.find((e) => e.id === body.ttsEngine) ?? engines[0];
  if (!engine) throw new TaskError("没有可用的 TTS 引擎", 500);
  const voice = engine.voices.find((v) => v.id === body.voice)?.id ?? engine.voices[0]?.id;
  if (!voice) throw new TaskError(`TTS 引擎 ${engine.id} 没有可用音色`, 500);

  const materialSource = (
    MATERIAL_SOURCES.find((o) => o.id === body.materialSource)?.id ??
    MATERIAL_SOURCES[0]?.id ??
    "pixabay"
  ) as MaterialSource;

  const resolutionId = RESOLUTIONS.find((r) => r.id === body.resolution)?.id ?? RESOLUTIONS[0]?.id ?? "1080x1920";
  const [w, h] = resolutionId.split("x").map((v) => Number(v));
  const width = w || num(cfg.VIDEO_WIDTH, 1080);

  return {
    promptSource,
    speakers,
    ttsEngine: engine.id as TtsEngine,
    voice,
    materialSource,
    width,
    height: h || num(cfg.VIDEO_HEIGHT, 1920),
    fps: num(cfg.FPS, 24),
    ttsSpeed: Number(cfg.TTS_SPEED) || 1.1,
    // 存成具体 px：成片页直接显示算出来的字号，不再是「0 = 自动」
    subtitleFontSize: numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0) || autoSubtitleFontSize(width),
  };
}

interface ConfirmBody {
  transcript?: RawTranscript;
  options?: {
    ttsEngine?: string;
    voices?: Record<string, string>;
    /** 配音语速，1 = 原速；只接受 0.5~2.0 */
    ttsSpeed?: number;
    materialSource?: string;
    resolution?: string;
  };
}

interface RenderBody {
  subtitleFontSize?: number;
  bgmEnabled?: boolean;
  bgmVolume?: number;
  bgmFile?: string;
}

/** 成片页的渲染参数：不合法的直接忽略，保留配置默认值 */
function parseRenderPatch(body: RenderBody): RenderPatch {
  const patch: RenderPatch = {};

  const size = Number(body.subtitleFontSize);
  if (Number.isFinite(size) && size >= 0 && size <= 200) patch.subtitleFontSize = Math.round(size);
  if (typeof body.bgmEnabled === "boolean") patch.bgmEnabled = body.bgmEnabled;

  const volume = Number(body.bgmVolume);
  if (Number.isFinite(volume) && volume >= 0 && volume <= 2) patch.bgmVolume = volume;

  patch.bgmFile = typeof body.bgmFile === "string" ? body.bgmFile.trim() : "";
  return patch;
}

/** 素材页选定的素材来源与分辨率，只接受当前配置里真实存在的项 */
function parseMaterialPatch(body: { materialSource?: string; resolution?: string }): Partial<GenerateOptions> {
  const patch: Partial<GenerateOptions> = {};

  const material = MATERIAL_SOURCES.find((o) => o.id === body.materialSource);
  if (material) patch.materialSource = material.id as MaterialSource;

  const resolution = RESOLUTIONS.find((r) => r.id === body.resolution);
  if (resolution) {
    const [w, h] = resolution.id.split("x").map((v) => Number(v));
    if (w && h) {
      patch.width = w;
      patch.height = h;
    }
  }

  return patch;
}

/** 确认剧本时下发的配音/素材设置，只接受当前配置里真实存在的项 */
function parseConfirmPatch(body: ConfirmBody): Partial<GenerateOptions> {
  const options = body.options;
  if (!options) return {};

  const patch: Partial<GenerateOptions> = {};

  const engine = ttsEngines(loadConfig()).find((e) => e.id === options.ttsEngine);
  if (engine) {
    patch.ttsEngine = engine.id as TtsEngine;

    const allowed = new Set(engine.voices.map((v) => v.id));
    const voiceMap: Record<string, string> = {};
    for (const [speaker, voice] of Object.entries(options.voices ?? {})) {
      if (allowed.has(voice)) voiceMap[speaker] = voice;
    }
    if (Object.keys(voiceMap).length > 0) patch.voiceMap = voiceMap;

    const fallback = Object.values(voiceMap)[0] ?? engine.voices[0]?.id;
    if (fallback) patch.voice = fallback;
  }

  const speed = Number(options.ttsSpeed);
  if (Number.isFinite(speed) && speed >= 0.5 && speed <= 2) {
    patch.ttsSpeed = Math.round(speed * 100) / 100;
  }

  Object.assign(patch, parseMaterialPatch(options));

  return patch;
}

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: GenerateBody }>("/api/generate", async (req, reply) => {
    try {
      const input = req.body?.input ?? "";
      const options = parseOptions(req.body ?? {});
      const state = taskManager.start(input, options);
      return { state };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/api/task", async () => ({ state: taskManager.getState() }));

  /** 用同一份输入重新生成剧本（会丢弃当前剧本，可带上改过的角色名） */
  app.post<{ Body: { speakers?: { main?: string; guest?: string } } }>("/api/task/regenerate", async (req, reply) => {
    try {
      const speakers = {
        main: normalizeSpeaker(req.body?.speakers?.main, ""),
        guest: normalizeSpeaker(req.body?.speakers?.guest, ""),
      };
      return { state: taskManager.regenerate(speakers) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Body: ConfirmBody }>("/api/task/confirm", async (req, reply) => {
    try {
      const state = taskManager.confirm(req.body?.transcript, parseConfirmPatch(req.body ?? {}));
      return { state };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 素材确认页：按台词检索并匹配素材（素材还没匹配时），可同时指定素材来源 */
  app.post<{ Body: { materialSource?: string } }>("/api/task/material/match", async (req, reply) => {
    try {
      return { state: taskManager.matchMaterial(parseMaterialPatch(req.body ?? {})) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 确认素材（可带手动替换的候选与分辨率），开始合成 */
  app.post<{ Body: { items?: MaterialReplacement[]; resolution?: string } }>("/api/task/material", async (req, reply) => {
    try {
      const state = await taskManager.confirmMaterial(req.body?.items, parseMaterialPatch(req.body ?? {}));
      return { state };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 重新检索某一段的候选素材 */
  app.post<{ Body: { paragraph?: number; terms?: string[] } }>("/api/task/material/search", async (req, reply) => {
    try {
      const paragraph = Number(req.body?.paragraph);
      if (!Number.isFinite(paragraph) || paragraph <= 0) throw new TaskError("段号不合法", 400);
      const candidates = await taskManager.searchMaterial(paragraph, req.body?.terms);
      return { candidates };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 配音试听：工作目录里的 i_j_k.wav / .mp3，支持 Range 以便拖动/连续播放 */
  app.get<{ Params: { file: string } }>("/api/audio/:file", async (req, reply) => {
    const name = path.basename(req.params.file);
    if (!/^\d+_\d+_\d+\.(wav|mp3)$/i.test(name)) {
      return reply.code(400).send({ error: "文件名不合法" });
    }

    const state = taskManager.getState();
    const file = state ? path.join(state.workspace, name) : "";
    if (!file || !fs.existsSync(file)) {
      return reply.code(404).send({ error: "音频不存在" });
    }

    const stat = fs.statSync(file);
    reply.header("Content-Type", name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg");
    reply.header("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
      }
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Content-Length", end - start + 1);
      return reply.send(fs.createReadStream(file, { start, end }));
    }

    reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(file));
  });

  /** 素材确认页：按段号播放当前选中的本地素材 */
  app.get<{ Params: { paragraph: string } }>("/api/material/:paragraph", async (req, reply) => {
    const state = taskManager.getState();
    const paragraph = Number(req.params.paragraph);
    const item = state?.material?.items.find((entry) => entry.paragraph === paragraph);
    if (!item || !item.videoPath || !fs.existsSync(item.videoPath)) {
      return reply.code(404).send({ error: `第 ${req.params.paragraph} 段还没有素材` });
    }

    const file = item.videoPath;
    const stat = fs.statSync(file);
    reply.header("Content-Type", "video/mp4");
    reply.header("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
      }
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Content-Length", end - start + 1);
      return reply.send(fs.createReadStream(file, { start, end }));
    }

    reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(file));
  });

  /** 成片预览页点「生成成片 / 重新生成」：按这页的渲染参数跑合成 */
  app.post<{ Body: RenderBody }>("/api/task/render", async (req, reply) => {
    try {
      return { state: taskManager.render(parseRenderPatch(req.body ?? {})) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 重试失败的任务：不换工作目录，从失败的阶段接着跑 */
  app.post("/api/task/retry", async (_req, reply) => {
    try {
      return { state: taskManager.retry() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/task/cancel", async (_req, reply) => {
    try {
      return { state: taskManager.cancel() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 成片播放/下载，支持 Range 以便前端拖动进度条 */
  app.get<{ Querystring: { download?: string } }>("/api/result", async (req, reply) => {
    const state = taskManager.getState();
    const file = state?.result;
    if (!file || !fs.existsSync(file)) {
      return reply.code(404).send({ error: "还没有生成成片" });
    }

    const stat = fs.statSync(file);
    const filename = `${state.transcript?.title ?? "video"}.mp4`.replace(/[\\/:*?"<>|]/g, "_");
    reply.header("Content-Type", "video/mp4");
    reply.header("Accept-Ranges", "bytes");
    if (req.query.download === "1") {
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
      }
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Content-Length", end - start + 1);
      return reply.send(fs.createReadStream(file, { start, end }));
    }

    reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(file));
  });

  /** SSE：先推一次快照，之后每次状态变化推一次完整快照 */
  app.get("/api/stream", (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write("retry: 3000\n\n");

    const send = (state: unknown) => {
      raw.write(`event: snapshot\ndata: ${JSON.stringify({ state })}\n\n`);
    };

    send(taskManager.getState());
    const unsubscribe = taskManager.subscribe((event) => send(event.state));
    const ping = setInterval(() => raw.write(": ping\n\n"), 20_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
