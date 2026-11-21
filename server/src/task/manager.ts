import fs from "node:fs";
import path from "node:path";
import { autoSubtitleFontSize, cardAccentPalette, loadConfig } from "../config.js";
import { newWorkspace } from "../paths.js";
import { persistConfirmed, runScriptStages, sentenceCount } from "../pipeline/script.js";
import { runTtsStage, transcriptFingerprint } from "../pipeline/tts.js";
import { runMaterialStage, saveMaterialManifest, searchCandidates } from "../pipeline/material.js";
import { isTemplateFor } from "../card-templates.js";
import {
  cardsEnabled,
  cleanCardText,
  ensureCardStill,
  nextAccent,
  normalizeCard,
  rewriteCardTitle,
  runCardsStage,
} from "../pipeline/cards.js";
import { runComposeStage } from "../pipeline/compose.js";
import { resolveMusicFile } from "../services/bgm.js";
import { downloadMaterial } from "../services/material.js";
import { lastRenderErrorMessage } from "../services/remotion.js";
import { loadLatestTask, saveTaskState } from "./store.js";
import type {
  AudioManifest,
  CardManifest,
  CardPrefs,
  CardSpec,
  GenerateOptions,
  LogLine,
  MaterialInfo,
  MaterialItem,
  RawTranscript,
  PromptSource,
  RenderPatch,
  StageState,
  StageStatus,
  TaskContext,
  TaskEvent,
  TaskState,
  TaskStatus,
  Transcript,
} from "../types.js";

export const STAGE_DEFS: { id: string; label: string }[] = [
  { id: "fetch", label: "获取内容" },
  { id: "write", label: "生成草稿" },
  { id: "rewrite", label: "改写剧本" },
  { id: "split", label: "拆分台词" },
  { id: "tts", label: "合成配音" },
  { id: "material", label: "匹配素材" },
  { id: "cards", label: "生成版式" },
  { id: "compose", label: "合成视频" },
];

const MAX_LOGS = 300;

const STAGE_ORDER = STAGE_DEFS.map((def) => def.id);

export class TaskError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TaskError";
    this.statusCode = statusCode;
  }
}

type Listener = (event: TaskEvent) => void;

export interface MaterialReplacement extends MaterialInfo {
  paragraph: number;
}

export interface CardPatch {
  title?: string;
  label?: string;
  accent?: string;
  durationSec?: number;
  handle?: string;
  /** 换模板，必须是该卡片类型白名单里的 composition */
  compositionId?: string;
}

export interface CardsBatchPatch {
  /** 统一主色 */
  accent?: string;
  /** 只改章节卡的时长 */
  chapterDurationSec?: number;
}

class TaskManager {
  private state: TaskState | null = null;
  private controller: AbortController | null = null;
  private listeners = new Set<Listener>();
  private currentStageId: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.restore();
  }

  getState(): TaskState | null {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 单任务模式：未结束时拒绝新任务 */
  start(input: string, options: GenerateOptions, force = false): TaskState {
    const current = this.state;
    if (
      !force &&
      current &&
      (current.status === "running" ||
        current.status === "awaiting_script" ||
        current.status === "awaiting_material" ||
        current.status === "awaiting_cards")
    ) {
      throw new TaskError("已有任务未结束，请等待完成或先取消", 409);
    }
    if (!input.trim()) throw new TaskError("内容不能为空", 400);

    const workspace = newWorkspace();
    const now = new Date().toISOString();
    this.state = {
      id: path.basename(workspace),
      input: input.trim(),
      options,
      workspace,
      status: "running",
      stages: STAGE_DEFS.filter((d) => d.id !== "cards" || cardsEnabled()).map((d) => ({
        ...d,
        status: "pending" as StageStatus,
      })),
      logs: [],
      transcript: null,
      audio: null,
      material: null,
      cards: null,
      cardPrefs: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const controller = new AbortController();
    this.controller = controller;
    this.currentStageId = null;

    this.log(`任务开始：${workspace}`);
    void this.execute(controller);
    return this.state;
  }

  /** 换新工作目录重跑剧本，未传字段沿用原值 */
  regenerate(
    patch: { input?: string; promptSource?: PromptSource; speakers?: { main?: string; guest?: string } } = {},
  ): TaskState {
    const state = this.requireState();
    const options: GenerateOptions = {
      ...state.options,
      promptSource: patch.promptSource ?? state.options.promptSource,
      speakers: {
        main: patch.speakers?.main || state.options.speakers.main,
        guest: patch.speakers?.guest || state.options.speakers.guest,
      },
    };

    const input = patch.input?.trim() || state.input;

    this.controller?.abort();
    this.controller = null;

    return this.start(input, options, true);
  }

  /** 确认剧本，进入配音 */
  confirm(raw?: RawTranscript, patch?: Partial<GenerateOptions>): TaskState {
    const state = this.requireState();
    if (state.status !== "awaiting_script") {
      throw new TaskError("当前任务不在等待确认状态", 400);
    }

    const transcript = raw ? persistConfirmed(state.workspace, raw) : state.transcript;
    if (!transcript) throw new TaskError("剧本为空，无法确认", 400);

    this.currentStageId = null;
    this.clearLogsFrom(state, "tts");

    const before = state.transcript ? transcriptFingerprint(state.transcript) : "";
    if (raw && transcriptFingerprint(transcript) !== before) this.invalidateAfterScript(state);

    if (patch) {
      state.options = { ...state.options, ...patch };
      const voices = Object.values(patch.voiceMap ?? {});
      this.log(
        `配音设置：${state.options.ttsEngine}${voices.length ? ` · ${voices.join("/")}` : ""} · ${state.options.ttsSpeed}× 语速`,
        "info",
        "tts",
      );
    }

    state.transcript = transcript;
    if (raw) this.log("已保存修改后的剧本", "info", "split");
    this.log(`剧本已确认：${transcript.paragraphs.length} 段 / ${sentenceCount(transcript)} 句`, "info", "split");

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("开始生成配音…", "info", "tts");
    this.emit();
    void this.executeTts(controller, transcript);
    return state;
  }

  /** 只重做配音，会中断当前一轮 */
  regenerateTts(patch?: Partial<GenerateOptions>): TaskState {
    const state = this.requireState();
    if (!state.transcript) throw new TaskError("还没有剧本，无法生成配音", 400);

    if (patch) state.options = { ...state.options, ...patch };

    this.controller?.abort();
    this.controller = null;

    this.invalidateAfterScript(state);
    state.error = null;
    this.currentStageId = null;

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log(`重新生成配音：${state.options.ttsEngine} · ${state.options.ttsSpeed}× 语速`, "info", "tts");
    this.emit();
    void this.executeTts(controller, state.transcript);
    return state;
  }

  /** 匹配素材，force 会先作废旧清单与片段 */
  matchMaterial(patch?: Partial<GenerateOptions>, force = false): TaskState {
    const state = this.requireState();
    const retrying = state.status === "failed" || state.status === "cancelled";
    if (state.status === "running" && !force) {
      throw new TaskError("正在生成，等这一轮结束再重来", 409);
    }
    if (!force && state.status !== "awaiting_material" && !retrying) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }
    if (!force && state.material) throw new TaskError("素材已经匹配过了", 400);
    if (!state.transcript || !state.audio) {
      throw new TaskError("配音还没完成，无法匹配素材", 400);
    }

    if (force) {
      this.controller?.abort();
      this.controller = null;
      fs.rmSync(path.join(state.workspace, "_videos.json"), { force: true });
      fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
      fs.rmSync(path.join(state.workspace, "clips"), { recursive: true, force: true });
      fs.rmSync(path.join(state.workspace, "subs"), { recursive: true, force: true });
      state.material = null;
      state.result = null;
      state.error = null;
      for (const stage of state.stages) {
        if (stage.id === "material" || stage.id === "compose") {
          stage.status = "pending";
          stage.message = "";
          stage.startedAt = undefined;
          stage.endedAt = undefined;
        }
      }
    }

    if (retrying) {
      fs.rmSync(path.join(state.workspace, "_videos.json"), { force: true });
      for (const stage of state.stages) {
        if (stage.id === "material" && stage.status === "failed") {
          stage.status = "pending";
          stage.message = "";
          stage.startedAt = undefined;
          stage.endedAt = undefined;
        }
      }
      state.error = null;
    }

    this.clearLogsFrom(state, "material");

    if (patch) {
      const before = state.options;
      state.options = { ...state.options, ...patch };
      if (state.options.width !== before.width) {
        const oldAuto = autoSubtitleFontSize(before.width);
        if ((state.options.subtitleFontSize ?? oldAuto) === oldAuto) {
          state.options.subtitleFontSize = autoSubtitleFontSize(state.options.width);
        }
      }
      this.log(`素材来源：${state.options.materialSource}`, "info", "material");
      this.log(`成片分辨率：${state.options.width}×${state.options.height}`, "info", "material");
    }

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("开始按台词匹配素材…", "info", "material");
    this.emit();
    void this.executeMatch(controller, state.transcript, state.audio);
    return state;
  }

  /** 保存手动替换与分辨率 */
  async confirmMaterial(items?: MaterialReplacement[], patch?: Partial<GenerateOptions>): Promise<TaskState> {
    const state = this.requireState();
    if ((state.status !== "awaiting_material" && state.status !== "material_ready") || !state.material) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }

    this.controller?.abort();

    if (patch) {
      const before = state.options;
      state.options = { ...state.options, ...patch };
      if (state.options.width !== before.width || state.options.height !== before.height) {
        fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
      }
      if (state.options.width !== before.width) {
        const oldAuto = autoSubtitleFontSize(before.width);
        if ((state.options.subtitleFontSize ?? oldAuto) === oldAuto) {
          state.options.subtitleFontSize = autoSubtitleFontSize(state.options.width);
        }
      }
      this.log(`成片分辨率：${state.options.width}×${state.options.height}`, "info", "compose");
    }

    const controller = new AbortController();
    this.controller = controller;
    try {
      if (items?.length) await this.applyMaterialChanges(items, controller.signal);
    } catch (error) {
      if (this.controller === controller) this.controller = null;
      if (error instanceof TaskError) throw error;
      throw new TaskError(`更换素材失败：${error instanceof Error ? error.message : String(error)}`, 500);
    } finally {
      if (this.controller === controller) this.controller = null;
    }

    state.result = null;
    state.cards = null;
    this.emit();

    // 有版式阶段就停在这一步，等用户自己点「开始生成版式」
    if (this.cardStagePresent(state) || cardsEnabled()) {
      // 老任务中途才打开版式时，阶段清单里还没有 cards，补上后前端才会出现这一步
      this.ensureCardsStage(state);
      this.setStatus("awaiting_cards");
      this.log("素材已确认，去「版式确认」点「开始生成版式」", "info", "cards");
      this.emit();
      return state;
    }

    this.setStatus("material_ready");
    this.log("素材已确认，去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
    this.emit();
    return state;
  }

  /** 版式步骤进入后手动触发，跟素材匹配一样由用户发起 */
  generateCards(prefs: CardPrefs = {}): TaskState {
    const state = this.requireState();
    if (!this.cardStagePresent(state)) throw new TaskError("这个任务没有版式步骤", 400);
    if (state.status !== "awaiting_cards") throw new TaskError("当前任务不在等待版式确认状态", 400);
    if (state.cards) throw new TaskError("版式已经生成过了，用「换一批」重新生成", 400);
    if (!state.transcript) throw new TaskError("还没有剧本，无法生成版式", 400);

    this.mergeCardPrefs(state, prefs);
    this.controller?.abort();
    this.controller = null;

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("开始生成版式…", "info", "cards");
    this.emit();
    void this.executeCards(controller, true);
    return state;
  }

  confirmCards(): TaskState {
    const state = this.requireState();
    if (state.status !== "awaiting_cards") {
      throw new TaskError("当前任务不在等待版式确认状态", 400);
    }
    if (!state.cards) {
      throw new TaskError("版式还没生成，先点「开始生成版式」", 400);
    }

    this.controller?.abort();
    this.controller = null;

    this.setStatus("cards_ready");
    // 允许空清单：只有正文的成片
    this.log(
      state.cards.items.length > 0 ? `版式已确认：${state.cards.items.length} 张卡` : "版式已确认：本次不加任何卡片",
      "info",
      "cards",
    );
    this.log("去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
    this.emit();
    return state;
  }

  regenerateCards(prefs: CardPrefs = {}): TaskState {
    const state = this.requireState();
    // material_ready = 老任务补做版式；completed = 成片已出，想换一批版式
    const allowed: TaskState["status"][] = ["awaiting_cards", "cards_ready", "material_ready", "completed"];
    if (!allowed.includes(state.status)) {
      throw new TaskError("当前任务不在等待版式确认状态", 400);
    }
    if (!state.transcript) throw new TaskError("还没有剧本，无法生成版式", 400);

    this.mergeCardPrefs(state, prefs);
    this.controller?.abort();
    this.controller = null;

    this.ensureCardsStage(state);
    this.clearLogsFrom(state, "cards");
    state.result = null;
    // 清空清单，否则页面会凭旧清单判成"已出片"而跳到成片预览
    state.cards = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("重新生成版式…", "info", "cards");
    this.emit();
    void this.executeCards(controller, true);
    return state;
  }

  /** 换文案或换配色；不占用主 controller，避免打断合成 */
  async rewriteCard(id: string, mode: "text" | "accent" = "text"): Promise<TaskState> {
    const state = this.requireState();
    if (!this.canEditCards(state)) {
      throw new TaskError("当前任务不在可编辑版式的状态", 400);
    }
    const manifest = state.cards;
    if (!manifest || !state.transcript) throw new TaskError("版式清单为空", 400);

    const index = manifest.items.findIndex((item) => item.id === id);
    const spec = manifest.items[index];
    if (!spec) throw new TaskError(`没有这张卡：${id}`, 400);

    const controller = new AbortController();
    const ctx = this.makeCtx(controller);
    if (!ctx) throw new TaskError("任务状态异常", 500);

    const cfg = loadConfig();
    const used = manifest.items
      .filter((item) => item.kind === spec.kind && item.id !== spec.id)
      .map((item) => item.title)
      .concat(spec.title);

    const next: CardSpec = { ...spec };
    let changed = false;

    if (mode === "text") {
      const title = await rewriteCardTitle(ctx, state.transcript, spec, used);
      if (title) {
        next.title = title;
        changed = true;
      }
    }

    // 没拿到新文案就换配色兜底
    if (!changed) {
      next.accent = nextAccent(spec, cfg);
      this.log(`配色换成 ${next.accent}`, "info", "cards");
    }

    delete next.videoPath;
    delete next.stillPath;
    manifest.items[index] = normalizeCard(next, cfg, state.options.width, state.options.height, state.options.fps);

    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.reopenCards(state);
    this.log(`「${manifest.items[index]?.title ?? spec.title}」已更新`, "info", "cards");
    this.emit();
    return state;
  }

  removeCard(id: string): TaskState {
    const state = this.requireState();
    if (!this.canEditCards(state)) {
      throw new TaskError("当前任务不在可编辑版式的状态", 400);
    }
    const manifest = state.cards;
    if (!manifest) throw new TaskError("版式清单为空", 400);

    const spec = manifest.items.find((item) => item.id === id);
    if (!spec) throw new TaskError(`没有这张卡：${id}`, 400);

    manifest.items = manifest.items.filter((item) => item.id !== id);
    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.reopenCards(state);
    this.log(
      `已删除${spec.kind === "intro" ? "片头" : spec.kind === "outro" ? "片尾" : `第 ${spec.paragraph} 段过场卡`}`,
      "info",
      "cards",
    );
    this.emit();
    return state;
  }

  updateCard(id: string, patch: CardPatch = {}): TaskState {
    const state = this.requireState();
    if (!this.canEditCards(state)) {
      throw new TaskError("当前任务不在可编辑版式的状态", 400);
    }
    const manifest = state.cards;
    if (!manifest) throw new TaskError("版式清单为空", 400);

    const index = manifest.items.findIndex((item) => item.id === id);
    const spec = manifest.items[index];
    if (!spec) throw new TaskError(`没有这张卡：${id}`, 400);

    const cfg = loadConfig();
    const next: CardSpec = { ...spec };

    if (typeof patch.title === "string") {
      const title = cleanCardText(patch.title, spec.kind === "chapter" ? 12 : 14);
      if (!title) throw new TaskError("标题不能为空", 400);
      next.title = title;
    }
    if (typeof patch.label === "string") {
      next.label = cleanCardText(patch.label, 10) || spec.label;
    }
    if (typeof patch.handle === "string") {
      next.handle = patch.handle.trim().slice(0, 24) || undefined;
    }
    if (typeof patch.accent === "string") {
      const wanted = patch.accent.trim().toLowerCase();
      const hit = cardAccentPalette(cfg).find((color) => color.toLowerCase() === wanted);
      if (!hit) throw new TaskError("配色不在允许的色板里", 400);
      next.accent = hit;
    }
    if (patch.durationSec !== undefined) {
      const value = Number(patch.durationSec);
      if (!Number.isFinite(value) || value < 0.5 || value > 15) {
        throw new TaskError("时长要在 0.5–15 秒之间", 400);
      }
      next.durationSec = Math.round(value * 10) / 10;
    }
    if (typeof patch.compositionId === "string") {
      if (!isTemplateFor(spec.kind, patch.compositionId)) {
        throw new TaskError("这个模板不适用于当前卡片类型", 400);
      }
      next.compositionId = patch.compositionId;
    }

    delete next.videoPath;
    delete next.stillPath;
    manifest.items[index] = normalizeCard(next, cfg, state.options.width, state.options.height, state.options.fps);

    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.reopenCards(state);
    this.log(`「${next.title}」已更新：${next.durationSec}s · ${next.accent}`, "info", "cards");
    this.emit();
    return state;
  }

  applyCardsPatch(patch: CardsBatchPatch): TaskState {
    const state = this.requireState();
    if (!this.canEditCards(state)) {
      throw new TaskError("当前任务不在可编辑版式的状态", 400);
    }
    const manifest = state.cards;
    if (!manifest) throw new TaskError("版式清单为空", 400);

    const cfg = loadConfig();
    const palette = cardAccentPalette(cfg);
    const notes: string[] = [];
    let accent: string | null = null;

    if (typeof patch.accent === "string") {
      const wanted = patch.accent.trim().toLowerCase();
      accent = palette.find((color) => color.toLowerCase() === wanted) ?? null;
      if (!accent) throw new TaskError("配色不在允许的色板里", 400);
      notes.push(`配色 ${accent}`);
    }

    let chapterSec: number | null = null;
    if (patch.chapterDurationSec !== undefined) {
      const value = Number(patch.chapterDurationSec);
      if (!Number.isFinite(value) || value < 0.5 || value > 15) {
        throw new TaskError("时长要在 0.5–15 秒之间", 400);
      }
      chapterSec = Math.round(value * 10) / 10;
      notes.push(`章节 ${chapterSec}s`);
    }

    if (notes.length === 0) throw new TaskError("没有要应用的改动", 400);

    manifest.items = manifest.items.map((spec) => {
      const next: CardSpec = { ...spec };
      if (accent) next.accent = accent;
      if (chapterSec !== null && spec.kind === "chapter") next.durationSec = chapterSec;
      delete next.videoPath;
      delete next.stillPath;
      return normalizeCard(next, cfg, state.options.width, state.options.height, state.options.fps);
    });

    // 手动选过的值记下来，后面「换一批」也按这个来
    const prefs: CardPrefs = { ...(state.cardPrefs ?? {}) };
    if (accent) prefs.accent = accent;
    if (chapterSec !== null) prefs.chapterDurationSec = chapterSec;
    state.cardPrefs = prefs.accent || prefs.chapterDurationSec ? prefs : null;

    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.reopenCards(state);
    this.log(`已批量应用：${notes.join(" · ")}`, "info", "cards");
    this.emit();
    return state;
  }

  async cardStill(id: string): Promise<string> {
    const state = this.requireState();
    const spec = state.cards?.items.find((item) => item.id === id);
    if (!spec) throw new TaskError(`没有这张卡：${id}`, 400);

    const ctx = this.makeCtx(new AbortController());
    if (!ctx) throw new TaskError("任务状态异常", 500);

    const still = await ensureCardStill(ctx, spec, state.transcript?.paragraphs.length ?? 1);
    if (!still) {
      throw new TaskError(`卡片预览渲染失败：${lastRenderErrorMessage() || "未知原因"}`, 500);
    }
    this.emit();
    return still;
  }

  cardVideo(id: string): string {
    const state = this.requireState();
    const spec = state.cards?.items.find((item) => item.id === id);
    if (!spec?.videoPath || !fs.existsSync(spec.videoPath)) {
      throw new TaskError("这张卡还没渲染", 404);
    }
    return spec.videoPath;
  }

  /** 按当前渲染参数合成 */
  render(patch?: RenderPatch): TaskState {
    const state = this.requireState();
    if (!state.transcript || !state.audio || !state.material) {
      throw new TaskError("还没有可合成的内容，先跑完素材确认", 400);
    }
    if (state.status === "running") {
      throw new TaskError("正在合成，等这一版出来再改参数", 409);
    }
    if (state.status === "awaiting_cards") {
      throw new TaskError("先确认版式，再生成成片", 400);
    }
    // 只有这条任务真的带 cards 阶段时才要求先确认版式
    if (this.cardStagePresent(state) && !state.cards) {
      throw new TaskError("还没有生成版式，先跑完「版式确认」", 400);
    }

    const before = state.options;
    const next: GenerateOptions = { ...before };
    if (patch?.subtitleFontSize !== undefined) next.subtitleFontSize = patch.subtitleFontSize;
    if (patch?.bgmEnabled !== undefined) next.bgmEnabled = patch.bgmEnabled;
    if (patch?.bgmVolume !== undefined) next.bgmVolume = patch.bgmVolume;
    if (patch?.bgmFile !== undefined) next.bgmFile = patch.bgmFile.trim() || undefined;

    if (next.bgmEnabled === false) next.bgmFile = undefined;

    if (next.bgmFile) {
      const resolved = resolveMusicFile(next.bgmFile);
      if (!resolved.file) throw new TaskError(resolved.reason ?? "音乐文件不可用", 400);
    }

    state.options = next;
    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.clearLogsFrom(state, "compose");

    if ((before.subtitleFontSize ?? 0) !== (next.subtitleFontSize ?? 0)) {
      this.log("字幕字号变了，分段片段会重新渲染", "info", "compose");
    }

    this.currentStageId = null;
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log(
      `生成成片：字号 ${next.subtitleFontSize ?? 0}（0=自动） · BGM ${next.bgmEnabled === false ? "关" : "开"}${
        next.bgmFile ? ` · ${path.basename(next.bgmFile)}` : ""
      }`,
      "info",
      "compose",
    );
    this.emit();
    void this.executeCompose(controller);
    return state;
  }

  /** 重新检索某段候选素材 */
  async searchMaterial(paragraph: number, terms?: string[]): Promise<MaterialInfo[]> {
    const state = this.requireState();
    if ((state.status !== "awaiting_material" && state.status !== "material_ready") || !state.material) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }
    const current = state.material.items.find((item) => item.paragraph === paragraph);
    if (!current) throw new TaskError(`第 ${paragraph} 段还没有素材`, 400);

    const controller = new AbortController();
    this.controller = controller;
    const ctx = this.makeCtx(controller);
    if (!ctx) throw new TaskError("任务状态异常", 500);

    try {
      const used = new Set(state.material.items.map((item) => item.url));
      const keywords = (terms ?? []).filter((term) => term.trim().length > 0);
      return await searchCandidates(ctx, keywords.length > 0 ? keywords : current.searchTerms, used);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new TaskError("检索已取消", 400);
      throw new TaskError(`检索候选失败：${error instanceof Error ? error.message : String(error)}`, 500);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 沿用工作目录，从缺失的位置接着跑 */
  retry(): TaskState {
    const state = this.requireState();
    if (state.status !== "failed" && state.status !== "cancelled") {
      throw new TaskError("只有失败或已停止的任务可以继续", 400);
    }

    this.controller?.abort();

    for (const stage of state.stages) {
      const abortedMidway = stage.status === "skipped" && stage.message === "已取消";
      if (stage.status === "failed" || abortedMidway) {
        stage.status = "pending";
        stage.message = "";
        stage.startedAt = undefined;
        stage.endedAt = undefined;
      }
    }

    this.currentStageId = null;
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("继续未完成的步骤（已完成的阶段会命中缓存）");
    this.emit();

    if (state.cards) void this.executeCompose(controller);
    else if (state.material && this.cardStagePresent(state)) void this.executeCards(controller);
    else if (state.material) void this.executeCompose(controller);
    else if (state.transcript && state.audio) void this.executeMatch(controller, state.transcript, state.audio);
    else if (state.transcript) void this.executeTts(controller, state.transcript);
    else void this.execute(controller);

    return state;
  }

  cancel(): TaskState {
    const state = this.requireState();
    if (
      state.status !== "running" &&
      state.status !== "awaiting_script" &&
      state.status !== "awaiting_material" &&
      state.status !== "awaiting_cards"
    ) {
      throw new TaskError("任务已结束，无需取消", 400);
    }

    this.controller?.abort();
    this.controller = null;

    for (const stage of state.stages) {
      if (stage.status === "running") {
        stage.status = "skipped";
        stage.message = "已取消";
        stage.endedAt = Date.now();
      }
    }

    this.setStatus("cancelled");
    this.log("任务已取消", "warn");
    this.emit();
    return state;
  }

  /** 作废配音及下游产物；缓存按文件存在与否命中，必须物理删除 */
  private invalidateAfterScript(state: TaskState): void {
    const ws = state.workspace;
    fs.rmSync(path.join(ws, "_durations.json"), { force: true });
    fs.rmSync(path.join(ws, "_videos.json"), { force: true });
    fs.rmSync(path.join(ws, "_output.mp4"), { force: true });
    fs.rmSync(path.join(ws, "_bgm.wav"), { force: true });
    fs.rmSync(path.join(ws, "clips"), { recursive: true, force: true });
    fs.rmSync(path.join(ws, "subs"), { recursive: true, force: true });
    fs.rmSync(path.join(ws, "cards"), { recursive: true, force: true });

    // 逐句音频同名复用，需一并清掉
    try {
      for (const name of fs.readdirSync(ws)) {
        if (/^\d+_\d+_\d+\.(wav|mp3)$/i.test(name)) fs.rmSync(path.join(ws, name), { force: true });
      }
    } catch {
      // 工作目录不存在
    }

    state.audio = null;
    state.material = null;
    state.cards = null;
    state.result = null;
    this.clearLogsFrom(state, "tts");
    for (const stage of state.stages) {
      if (stage.id === "tts" || stage.id === "material" || stage.id === "cards" || stage.id === "compose") {
        stage.status = "pending";
        stage.message = "";
        stage.startedAt = undefined;
        stage.endedAt = undefined;
      }
    }
  }

  /** 清掉某阶段及其下游的日志 */
  private clearLogsFrom(state: TaskState, stageId: string): void {
    const from = STAGE_ORDER.indexOf(stageId);
    if (from < 0) return;
    const stale = new Set(STAGE_ORDER.slice(from));
    state.logs = state.logs.filter((line) => !line.stage || !stale.has(line.stage));
  }

  /** 只作废被替换段落的片段 */
  private invalidateClips(state: TaskState, paragraphs: number[]): void {
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    for (const paragraph of paragraphs) {
      const clip = path.join(state.workspace, "clips", `${paragraph}.mp4`);
      fs.rmSync(clip, { force: true });
      fs.rmSync(`${clip}.json`, { force: true });
      fs.rmSync(path.join(state.workspace, "subs", `${paragraph}.ass`), { force: true });
    }
  }

  /** 恢复上次快照，running 阶段视为中断并标成失败 */
  private restore(): void {
    const state = loadLatestTask();
    if (!state) return;

    // 老快照没有 cards 字段
    state.cards = state.cards ?? null;

    // 开关打开后，旧任务补一个版式阶段，可以在已有素材上补做
    if (cardsEnabled() && state.material && !state.stages.some((stage) => stage.id === "cards")) {
      const def = STAGE_DEFS.find((entry) => entry.id === "cards");
      const at = state.stages.findIndex((stage) => stage.id === "compose");
      if (def) state.stages.splice(at < 0 ? state.stages.length : at, 0, { ...def, status: "pending" });
      if (state.status === "completed" || state.status === "material_ready") state.status = "awaiting_cards";
    }

    if (state.status === "running") {
      for (const stage of state.stages) {
        if (stage.status === "running") {
          stage.status = "failed";
          stage.message = "应用退出时中断";
          stage.endedAt = Date.now();
        }
      }
      state.status = "failed";
      state.error = "上次运行被中断，点「重试失败步骤」接着跑（已完成的阶段会命中缓存）";
    }

    if (state.result && !fs.existsSync(state.result)) {
      state.result = null;
      if (state.status === "completed") state.status = "material_ready";
    }

    if (state.material && state.material.items.some((item) => !fs.existsSync(item.videoPath))) {
      state.material = null;
      state.result = null;
      state.status = state.audio ? "awaiting_material" : "failed";
      if (state.status === "failed") state.error = "上次的配音产物也找不到了，请重新生成";
    }
    if (!state.audio && state.transcript) {
      state.status = state.status === "completed" ? "script_confirmed" : state.status;
    }

    this.state = state;
  }

  /** 攒 400ms 写一次，退出前由 flush 兜底 */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.state) saveTaskState(this.state);
    }, 400);
    this.saveTimer.unref();
  }

  /** 立即落盘 */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.state) saveTaskState(this.state);
  }

  private requireState(): TaskState {
    if (!this.state) throw new TaskError("当前没有任务", 400);
    return this.state;
  }

  private makeCtx(controller: AbortController): TaskContext | null {
    const state = this.state;
    if (!state) return null;
    return {
      input: state.input,
      options: state.options,
      workspace: state.workspace,
      signal: controller.signal,
      log: (text, level) => this.log(text, level),
      markStage: (id, status, message) => this.markStage(id, status, message),
    };
  }

  private async execute(controller: AbortController): Promise<void> {
    const ctx = this.makeCtx(controller);
    if (!ctx) return;

    try {
      const transcript = await runScriptStages(ctx);
      if (!this.state || !this.owns(controller)) return;
      this.state.transcript = transcript;
      this.setStatus("awaiting_script");
      this.log("剧本已生成，确认后进入配音");
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 只跑 TTS */
  private async executeTts(controller: AbortController, transcript: Transcript): Promise<void> {
    const ctx = this.makeCtx(controller);
    if (!ctx) return;

    try {
      const manifest = await runTtsStage(ctx, transcript);
      if (!this.state || !this.owns(controller)) return;
      this.state.audio = manifest;
      this.log(`配音已完成：${manifest.paragraphs.length} 段，总时长 ${manifest.totalDuration.toFixed(1)} 秒`);
      this.setStatus("awaiting_material");
      this.log("配音就绪，去「素材确认」点「开始匹配素材」", "info", "material");
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 匹配素材 */
  private async executeMatch(controller: AbortController, transcript: Transcript, audio: AudioManifest): Promise<void> {
    const ctx = this.makeCtx(controller);
    if (!ctx) return;

    try {
      const material = await runMaterialStage(ctx, transcript, audio);
      if (!this.state || !this.owns(controller)) return;
      // markStage 内部会 emit，先赋值再标阶段
      this.state.material = material;
      this.setStatus("awaiting_material");
      this.markStage("material", "done", `${material.items.length} 段`);
      this.log(`素材已就绪：${material.items.length} 段`);
      this.log("素材已匹配，确认后开始合成视频");
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 下载选定的替换素材并写回清单 */
  private async applyMaterialChanges(next: MaterialReplacement[], signal: AbortSignal): Promise<void> {
    const state = this.requireState();
    const manifest = state.material;
    if (!manifest) throw new TaskError("素材清单为空", 400);

    const byParagraph = new Map(manifest.items.map((item) => [item.paragraph, item]));
    const changed: number[] = [];

    for (const candidate of next) {
      const paragraph = Number(candidate.paragraph);
      const current = byParagraph.get(paragraph);
      if (!current || typeof candidate.url !== "string" || candidate.url.length === 0) continue;
      if (current.url === candidate.url) continue;

      const videoPath = await downloadMaterial(candidate.url, signal);
      const updated: MaterialItem = {
        id: Number(candidate.id ?? current.id),
        url: candidate.url,
        duration: Number(candidate.duration ?? current.duration),
        width: Number(candidate.width ?? current.width),
        height: Number(candidate.height ?? current.height),
        tags: candidate.tags ?? current.tags,
        views: Number(candidate.views ?? current.views),
        isAiGenerated: Boolean(candidate.isAiGenerated),
        imageUrl: candidate.imageUrl ?? current.imageUrl,
        videoPath,
        paragraph,
        searchTerms: current.searchTerms,
      };
      byParagraph.set(paragraph, updated);
      changed.push(paragraph);
      this.log(`第 ${paragraph} 段换成新素材：${updated.tags || updated.id}`);
    }

    if (changed.length === 0) return;

    manifest.items = manifest.items.map((item) => byParagraph.get(item.paragraph) ?? item);
    saveMaterialManifest(state.workspace, manifest);
    this.invalidateClips(state, changed);
    this.emit();
  }

  private cardStagePresent(state: TaskState): boolean {
    return state.stages.some((stage) => stage.id === "cards");
  }

  /** 按 STAGE_DEFS 的顺序补进 cards 阶段，已存在则不动 */
  private ensureCardsStage(state: TaskState): void {
    if (this.cardStagePresent(state)) return;
    const def = STAGE_DEFS.find((stage) => stage.id === "cards");
    if (!def) return;
    const order = STAGE_DEFS.findIndex((stage) => stage.id === "cards");
    const before = state.stages.filter((stage) => STAGE_DEFS.findIndex((d) => d.id === stage.id) < order).length;
    state.stages.splice(before, 0, { ...def, status: "pending" });
  }

  /** 已确认、已出片也允许改，改完自动回到待确认 */
  private canEditCards(state: TaskState): boolean {
    if (!state.cards) return false;
    return state.status === "awaiting_cards" || state.status === "cards_ready" || state.status === "completed";
  }

  /** 合并用户点选的配色与章节时长；没选的继续跟随 AI 与配置 */
  private mergeCardPrefs(state: TaskState, patch: CardPrefs = {}): void {
    const current = state.cardPrefs ?? {};
    const wanted = typeof patch.accent === "string" ? patch.accent.trim().toLowerCase() : "";
    const accent = wanted ? cardAccentPalette(loadConfig()).find((c) => c.toLowerCase() === wanted) : undefined;
    if (wanted && !accent) throw new TaskError("配色不在允许的色板里", 400);

    const rawSec = patch.chapterDurationSec === undefined ? undefined : Number(patch.chapterDurationSec);
    if (rawSec !== undefined && (!Number.isFinite(rawSec) || rawSec < 0.5 || rawSec > 15)) {
      throw new TaskError("时长要在 0.5–15 秒之间", 400);
    }

    const next: CardPrefs = {};
    const finalAccent = accent ?? current.accent;
    const finalSec = rawSec === undefined ? current.chapterDurationSec : Math.round(rawSec * 10) / 10;
    if (finalAccent) next.accent = finalAccent;
    if (finalSec) next.chapterDurationSec = finalSec;
    state.cardPrefs = next.accent || next.chapterDurationSec ? next : null;
  }

  private reopenCards(state: TaskState): void {
    if (state.status === "awaiting_cards") return;
    this.setStatus("awaiting_cards");
    this.log("版式有改动，需要重新确认后再合成", "warn", "cards");
  }

  private async executeCards(controller: AbortController, resetStage = false): Promise<void> {
    const ctx = this.makeCtx(controller);
    const state = this.state;
    if (!ctx || !state?.transcript) return;

    try {
      if (resetStage) {
        for (const stage of state.stages) {
          if (stage.id === "cards") {
            stage.status = "pending";
            stage.message = "";
            stage.startedAt = undefined;
            stage.endedAt = undefined;
          }
        }
      }

      const manifest = await runCardsStage(ctx, state.transcript, state.audio, state.material, state.cardPrefs);
      if (!this.state || !this.owns(controller)) return;
      this.state.cards = manifest;
      this.setStatus("awaiting_cards");
      this.markStage("cards", "done", `${manifest.items.length} 张`);
      this.log("版式已就绪：可以预览、换一个或删掉不要的卡，确认后进入合成");
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private async executeCompose(controller: AbortController): Promise<void> {
    const ctx = this.makeCtx(controller);
    const state = this.state;
    if (!ctx || !state) return;

    const { transcript, audio, material, cards } = state;
    try {
      if (!transcript || !audio || !material) throw new Error("缺少剧本、配音或素材，无法合成");
      const output = await runComposeStage(ctx, transcript, audio, material, cards);
      if (!this.state || !this.owns(controller)) return;
      this.state.result = output;
      this.setStatus("completed");
      this.log(`视频已生成：${output}`);
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 判断流水线是否仍属于当前任务 */
  private owns(controller: AbortController): boolean {
    return this.controller === controller;
  }

  /** 已被取代的旧流水线不再写状态 */
  private fail(error: unknown, controller?: AbortController): void {
    if (controller && this.controller !== controller) return;
    const state = this.state;
    if (!state) return;

    const aborted = error instanceof Error && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);

    for (const stage of state.stages) {
      if (stage.status === "running") {
        stage.status = aborted ? "skipped" : "failed";
        stage.message = aborted ? "已取消" : message.slice(0, 200);
        stage.endedAt = Date.now();
      }
    }

    if (aborted) {
      this.setStatus("cancelled");
      this.log("任务已取消", "warn");
    } else {
      this.setStatus("failed", message);
      this.log(message, "error");
    }
    this.emit();
  }

  /** stage 缺省时归到当前阶段 */
  private log(text: string, level: LogLine["level"] = "info", stage?: string): void {
    if (!this.state) return;
    this.state.logs.push({
      time: new Date().toISOString(),
      level,
      text,
      stage: stage ?? this.currentStageId ?? undefined,
    });
    if (this.state.logs.length > MAX_LOGS) {
      this.state.logs.splice(0, this.state.logs.length - MAX_LOGS);
    }
    this.emit();
  }

  private markStage(id: string, status: StageStatus, message?: string): void {
    const state = this.state;
    if (!state) return;
    const stage: StageState | undefined = state.stages.find((s) => s.id === id);
    if (!stage) return;

    stage.status = status;
    if (message !== undefined) stage.message = message;
    if (status === "running") {
      stage.startedAt = Date.now();
      this.currentStageId = id;
    }
    if (status === "done" || status === "failed" || status === "skipped") stage.endedAt = Date.now();
    this.emit();
  }

  private setStatus(status: TaskStatus, error?: string): void {
    if (!this.state) return;
    this.state.status = status;
    this.state.error = error ?? null;
    this.state.updatedAt = new Date().toISOString();
  }

  private emit(): void {
    if (this.state) this.state.updatedAt = new Date().toISOString();
    this.scheduleSave();
    const event: TaskEvent = { type: "snapshot", state: this.state };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略单个订阅者的异常
      }
    }
  }
}

export const taskManager = new TaskManager();
