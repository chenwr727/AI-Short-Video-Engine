import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  autoSubtitleFontSize,
  cardAccentPalette,
  loadConfig,
  normalizeSpeaker,
  num,
  numberOrZero,
  speakerNames,
} from "../config.js";
import { MATERIAL_SOURCES, PROMPT_SOURCES, RESOLUTIONS, ttsEngines } from "../meta.js";
import { langOf, type Lang } from "../i18n.js";
import { type ErrorKey, errorMessage, TaskError, userError, userText } from "../errors.js";
import { taskManager, type MaterialReplacement } from "../task/manager.js";
import { mimeOf, sendFileWithRange } from "./send.js";
import type {
  CardPrefs,
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
  /** 素材匹配后是否配信息卡，缺省 true */
  autoInfoCards?: boolean;
  resolution?: string;
}

const CARD_ID_PATTERN = /^[a-z0-9-]+$/i;

/** 卡片接口共用：顺手挡掉路径分隔符 */
function requireCardId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!CARD_ID_PATTERN.test(id)) throw userError("cardIdInvalid", 400);
  return id;
}

/** 当前请求该用哪种语言 */
function langOfRequest(reply: FastifyReply): Lang {
  return langOf(reply.request.headers["accept-language"]);
}

/** 只回一句话、不走异常时用 */
function failText(reply: FastifyReply, key: ErrorKey, statusCode: number) {
  return reply.code(statusCode).send({ error: userText(key, langOfRequest(reply)) });
}

function fail(reply: FastifyReply, error: unknown) {
  return reply
    .code(error instanceof TaskError ? error.statusCode : 500)
    .send({ error: errorMessage(error, langOfRequest(reply)) });
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
  if (!engine) throw userError("noTtsEngine", 500);
  const voice = engine.voices.find((v) => v.id === body.voice)?.id ?? engine.voices[0]?.id;
  if (!voice) throw userError("noVoice", 500, { engine: engine.id });

  const materialSource = (MATERIAL_SOURCES.find((o) => o.id === body.materialSource)?.id ??
    MATERIAL_SOURCES[0]?.id ??
    "pixabay") as MaterialSource;

  /*
   * 分辨率只能从 RESOLUTIONS 里选，没有「自定义宽高」这条路 ——
   * 以前这里有 `w || num(cfg.VIDEO_WIDTH, 1080)` 的兜底，但 w 恒有值，
   * 配置项永远读不到，设置页那两个框改了没反应，已经删掉。
   */
  const resolutionId = RESOLUTIONS.find((r) => r.id === body.resolution)?.id ?? RESOLUTIONS[0]?.id ?? "1080x1920";
  const [rw, rh] = resolutionId.split("x").map((v) => Number(v));
  const width = rw || 1080;
  const height = rh || 1920;

  return {
    promptSource,
    speakers,
    ttsEngine: engine.id as TtsEngine,
    voice,
    materialSource,
    // 缺省开启：素材匹配完顺带配信息卡
    autoInfoCards: body.autoInfoCards !== false,
    width,
    height,
    fps: num(cfg.FPS, 24),
    ttsSpeed: Number(cfg.TTS_SPEED) || 1.1,
    // 存成具体 px，便于界面直接显示
    subtitleFontSize: numberOrZero(cfg.SUBTITLE_FONT_SIZE, 0) || autoSubtitleFontSize(width),
  };
}

interface ConfirmBody {
  transcript?: RawTranscript;
  options?: {
    ttsEngine?: string;
    voices?: Record<string, string>;
    /** 1 = 原速 */
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

/** 非法字段忽略 */
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

/** 只接受存在的来源与分辨率；autoInfoCards 是布尔开关，显式给了就带上 */
function parseMaterialPatch(body: {
  materialSource?: string;
  resolution?: string;
  autoInfoCards?: boolean;
}): Partial<GenerateOptions> {
  const patch: Partial<GenerateOptions> = {};

  const material = MATERIAL_SOURCES.find((o) => o.id === body.materialSource);
  if (material) patch.materialSource = material.id as MaterialSource;

  if (typeof body.autoInfoCards === "boolean") patch.autoInfoCards = body.autoInfoCards;

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

/**
 * 版式参数：只收 0–15 秒的时长和色板内的配色，其余一律忽略。
 * 合并进素材页后这几个字段和素材一起提交，非法值不该让整次确认失败。
 */
function parseCardPrefs(raw: unknown): CardPrefs {
  const body = (raw ?? {}) as Record<string, unknown>;
  const prefs: CardPrefs = {};

  const readSec = (key: "introDurationSec" | "chapterDurationSec" | "outroDurationSec") => {
    const value = body[key];
    if (value === undefined || value === null || value === "") return;
    const sec = Number(value);
    if (!Number.isFinite(sec) || sec < 0 || sec > 15) return;
    prefs[key] = Math.round(sec * 10) / 10;
  };
  readSec("introDurationSec");
  readSec("chapterDurationSec");
  readSec("outroDurationSec");

  if (typeof body.accent === "string" && body.accent.trim()) {
    const wanted = body.accent.trim().toLowerCase();
    const palette = cardAccentPalette(loadConfig());
    const hit = palette.find((color) => color.toLowerCase() === wanted);
    if (hit) prefs.accent = hit.toLowerCase();
  }

  return prefs;
}

/** 只接受存在的引擎与音色 */
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

  /** 重新生成剧本 */
  app.post<{ Body: { input?: string; promptSource?: string; speakers?: { main?: string; guest?: string } } }>(
    "/api/task/regenerate",
    async (req, reply) => {
      try {
        const speakers = {
          main: normalizeSpeaker(req.body?.speakers?.main, ""),
          guest: normalizeSpeaker(req.body?.speakers?.guest, ""),
        };
        const promptSource = PROMPT_SOURCES.find((o) => o.id === req.body?.promptSource)?.id as
          PromptSource | undefined;
        const input = typeof req.body?.input === "string" ? req.body.input : undefined;
        return { state: taskManager.regenerate({ input, promptSource, speakers }) };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post<{ Body: ConfirmBody }>("/api/task/confirm", async (req, reply) => {
    try {
      const state = taskManager.confirm(req.body?.transcript, parseConfirmPatch(req.body ?? {}));
      return { state };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 按新引擎/音色/语速重做配音 */
  app.post<{ Body: ConfirmBody }>("/api/task/tts/regenerate", async (req, reply) => {
    try {
      return { state: taskManager.regenerateTts(parseConfirmPatch(req.body ?? {})) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 匹配素材，force 表示强制重来 */
  app.post<{ Body: { materialSource?: string; resolution?: string; autoInfoCards?: boolean; force?: boolean } }>(
    "/api/task/material/match",
    async (req, reply) => {
      try {
        return { state: taskManager.matchMaterial(parseMaterialPatch(req.body ?? {}), req.body?.force === true) };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  /** 确认素材；cardPrefs 是素材页里选的片头/章节/片尾参数，一并落到版式清单 */
  app.post<{ Body: { items?: MaterialReplacement[]; resolution?: string; cardPrefs?: CardPrefs } }>(
    "/api/task/material",
    async (req, reply) => {
      try {
        const patch = parseMaterialPatch(req.body ?? {});
        const prefs = parseCardPrefs(req.body?.cardPrefs);
        const state = await taskManager.confirmMaterial(req.body?.items, patch, prefs);
        return { state };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  /** 重新检索某一段的候选素材 */
  app.post<{ Body: { paragraph?: number; terms?: string[] } }>("/api/task/material/search", async (req, reply) => {
    try {
      const paragraph = Number(req.body?.paragraph);
      if (!Number.isFinite(paragraph) || paragraph <= 0) throw userError("badParagraph", 400);
      const candidates = await taskManager.searchMaterial(paragraph, req.body?.terms);
      return { candidates };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 把某段的画面换成信息卡；template 指定时按该模板生成，否则让模型挑 */
  app.post<{ Body: { paragraph?: number; template?: string } }>("/api/task/material/info-card", async (req, reply) => {
    try {
      const paragraph = Number(req.body?.paragraph);
      if (!Number.isFinite(paragraph) || paragraph <= 0) throw userError("badParagraph", 400);
      const template = typeof req.body?.template === "string" ? req.body.template.trim() : "";
      const card = await taskManager.applyInfoCard(paragraph, template || undefined);
      if (!card) return failText(reply, "cardNotFit", 422);
      return { card, state: taskManager.getState() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 一键配置：逐段判断哪几段适合做信息卡，适合的自动生成 */
  app.post<{ Body: { overwrite?: boolean } }>("/api/task/material/info-card/auto", async (req, reply) => {
    try {
      const result = await taskManager.applyInfoCardsAuto({ overwrite: Boolean(req.body?.overwrite) });
      return { ...result, state: taskManager.getState() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 撤掉某段的信息卡，回到实拍素材 */
  app.post<{ Body: { paragraph?: number } }>("/api/task/material/info-card/clear", async (req, reply) => {
    try {
      const paragraph = Number(req.body?.paragraph);
      if (!Number.isFinite(paragraph) || paragraph <= 0) throw userError("badParagraph", 400);
      taskManager.clearInfoCard(paragraph);
      return { state: taskManager.getState() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 试听 i_j_k.wav/mp3，支持 Range */
  app.get<{ Params: { file: string } }>("/api/audio/:file", async (req, reply) => {
    const name = path.basename(req.params.file);
    if (!/^\d+_\d+_\d+\.(wav|mp3)$/i.test(name)) {
      return failText(reply, "badFile", 400);
    }

    const state = taskManager.getState();
    const file = state ? path.join(state.workspace, name) : "";
    if (!file || !fs.existsSync(file)) {
      return failText(reply, "noAudio", 404);
    }

    return sendFileWithRange(reply, file, req.headers.range, { contentType: mimeOf(name) });
  });

  /** 播放某段已选素材 */
  app.get<{ Params: { paragraph: string } }>("/api/material/:paragraph", async (req, reply) => {
    const state = taskManager.getState();
    const paragraph = Number(req.params.paragraph);
    const item = state?.material?.items.find((entry) => entry.paragraph === paragraph);
    if (!item || !item.videoPath || !fs.existsSync(item.videoPath)) {
      return reply.code(404).send({
        error: userText("noMaterialForParagraph", langOfRequest(reply), { n: req.params.paragraph }),
      });
    }

    return sendFileWithRange(reply, item.videoPath, req.headers.range, { contentType: "video/mp4" });
  });

  /** 换一张卡：重写文案或换配色 */
  app.post<{ Body: { id?: string; mode?: string } }>("/api/task/cards/rewrite", async (req, reply) => {
    try {
      const id = requireCardId(req.body?.id);
      const mode = req.body?.mode === "accent" ? "accent" : "text";
      return { state: await taskManager.rewriteCard(id, mode) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 卡片静帧，没渲过就现渲 */
  app.get<{ Params: { id: string } }>("/api/card/:id/still", async (req, reply) => {
    try {
      const id = requireCardId(path.basename(req.params.id));
      const file = await taskManager.cardStill(id);
      return sendFileWithRange(reply, file, req.headers.range, { contentType: "image/png" });
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 已渲染的卡片视频 */
  app.get<{ Params: { id: string } }>("/api/card/:id", async (req, reply) => {
    try {
      const id = requireCardId(path.basename(req.params.id));
      return sendFileWithRange(reply, taskManager.cardVideo(id), req.headers.range, { contentType: "video/mp4" });
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 按渲染参数合成 */
  app.post<{ Body: RenderBody }>("/api/task/render", async (req, reply) => {
    try {
      return { state: taskManager.render(parseRenderPatch(req.body ?? {})) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** 从失败的阶段接着跑 */
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

  /** 成片播放与下载 */
  app.get<{ Querystring: { download?: string } }>("/api/result", async (req, reply) => {
    const state = taskManager.getState();
    const file = state?.result;
    if (!file || !fs.existsSync(file)) {
      return failText(reply, "noVideo", 404);
    }

    const filename = `${state.transcript?.title ?? "video"}.mp4`.replace(/[\\/:*?"<>|]/g, "_");
    return sendFileWithRange(reply, file, req.headers.range, {
      contentType: "video/mp4",
      downloadName: req.query.download === "1" ? filename : undefined,
    });
  });

  /** SSE 快照推送 */
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
