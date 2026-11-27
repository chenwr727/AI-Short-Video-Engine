import fs from "node:fs";
import path from "node:path";
import { autoSubtitleFontSize, cardAccentPalette, loadConfig, type AppConfig } from "../config.js";
import { newWorkspace } from "../paths.js";
import { persistConfirmed, runScriptStages, sentenceCount } from "../pipeline/script.js";
import { runTtsStage, transcriptFingerprint } from "../pipeline/tts.js";
import { runMaterialStage, saveMaterialManifest, searchCandidates } from "../pipeline/material.js";
import {
  cardsEnabled,
  cardFiles,
  ensureCardStill,
  nextAccent,
  buildCards,
  normalizeCard,
  rewriteCardTitle,
  runCardsStage,
  generateInfoCardForParagraph,
  materialFrameDataUri,
} from "../pipeline/cards.js";
import { runComposeStage } from "../pipeline/compose.js";
import { resolveMusicFile } from "../services/bgm.js";
import { downloadMaterial } from "../services/material.js";
import { lastRenderErrorMessage } from "../services/remotion.js";
import { loadLatestTask, saveTaskState } from "./store.js";
import type {
  AudioManifest,
  CardKind,
  CardPrefs,
  CardSpec,
  GenerateOptions,
  LogLine,
  MaterialInfo,
  MaterialItem,
  MaterialManifest,
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

/**
 * 删文件，失败时退避重试几次。
 *
 * Windows 上正被播放的 mp4 会被读取流占住句柄，rmSync 抛 EPERM。
 * 播放器往往几百毫秒内就释放，重试几次基本能过掉。
 * 返回是否真的删掉了。
 */
function removeWithRetry(file: string, attempts = 4): boolean {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(file, { force: true });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // 不存在也算删干净了
      if (code === "ENOENT") return true;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") return false;
      if (i === attempts - 1) return false;
      // 同步退避：这一步在事件循环外，用短忙等换掉整条流水线的失败
      const until = Date.now() + 120 * (i + 1);
      while (Date.now() < until) {
        /* 等句柄释放 */
      }
    }
  }
  return false;
}

/**
 * 递归删目录，被占用的文件跳过继续删其余的。
 *
 * 目录里可能混着正在被播放的 mp4：直接 rmSync({recursive}) 一撞上就整体失败，
 * 连没被占用的文件也删不掉。这里逐个删，删不掉的重试几次，仍失败就留着。
 */
function removeDirWithRetry(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const target = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      removeDirWithRetry(target);
      continue;
    }
    removeWithRetry(target);
  }
  // 空目录才删得掉；里面还有删不掉的文件就留着
  try {
    fs.rmdirSync(dir);
  } catch {
    /* 剩了删不掉的，忽略 */
  }
}

/** 仅测试用：验证占用兜底不会把删除失败变成异常 */
export const removeWithRetryForTest = removeWithRetry;

/**
 * 点「继续」时该从哪一步接。
 *
 * 只认阶段状态，不看 result / cards / material 这些「上一轮留下的产物」——
 * 用它们做判据会让重新匹配中的任务直接跳去合成，用过期的素材清单出片。
 * 阶段不存在（比如没开版式）不算待补。
 */
export function nextResumeStep(state: TaskState): "match" | "cards" | "compose" | "other" {
  const status = (id: string) => state.stages.find((stage) => stage.id === id)?.status;
  const todo = (id: string) => {
    const s = status(id);
    return s !== undefined && s !== "done" && s !== "skipped";
  };

  if (todo("material") && state.transcript && state.audio) return "match";
  if (todo("cards") && state.material) return "cards";
  if (state.material && state.transcript && state.audio) return "compose";
  return "other";
}

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
    state.runStartedAt = Date.now();
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
      this.removeOutput(state.workspace);
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

    // 记下重跑时刻，clearLogsFrom 用它清掉没有 stage 的历史行
    state.runStartedAt = Date.now();
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

  /** 保存手动替换与分辨率；cardPrefs 是素材页里选的版式参数 */
  async confirmMaterial(
    items?: MaterialReplacement[],
    patch?: Partial<GenerateOptions>,
    cardPrefs?: CardPrefs,
  ): Promise<TaskState> {
    const state = this.requireState();
    if ((state.status !== "awaiting_material" && state.status !== "material_ready") || !state.material) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }

    // 版式参数要在生成前落库，runCardsStage 读的是 state.cardPrefs
    if (cardPrefs && Object.keys(cardPrefs).length > 0) this.mergeCardPrefs(state, cardPrefs);

    this.controller?.abort();

    if (patch) {
      const before = state.options;
      state.options = { ...state.options, ...patch };
      if (state.options.width !== before.width || state.options.height !== before.height) {
        this.removeOutput(state.workspace);
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

    /*
     * 版式已并进素材页：确认素材这一步就顺带把版式按配置生成好并确认掉，
     * 不再单独停在「版式确认」等用户再点一次。
     * 生成失败不挡素材 —— 素材已经可用，退回不带卡片的成片即可。
     *
     * 只看当前配置，不看「这个任务有没有 cards 阶段」：
     * 后者是建任务时按当时配置定下的，用户在设置里关掉版式后，
     * 老任务照样会带着 cards 阶段，用 `cardStagePresent(state) ||` 判断等于开关失效。
     * 关掉时要把遗留的 cards 阶段标成 skipped，否则 nextResumeStep 会一直认为
     * 这步没做完，点「继续」就卡在这儿反复重跑。
     */
    if (cardsEnabled()) {
      this.ensureCardsStage(state);
      if (state.transcript) {
        await this.buildAndConfirmCards();
        return state;
      }
      this.setStatus("material_ready");
      this.log("素材已确认，去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
      this.emit();
      return state;
    }

    if (this.cardStagePresent(state)) {
      this.markStage("cards", "skipped", "版式已关闭，本次不出卡片");
      this.log("版式开关已关闭，本次成片不含卡片", "info", "compose");
    }

    this.setStatus("material_ready");
    this.log("素材已确认，去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
    this.emit();
    return state;
  }

  /**
   * 按当前版式参数生成版式并直接标记为已确认。
   *
   * 合并步骤后，用户在素材页选好片头/章节/片尾时长就点「下一步」，
   * 这里把那一步的选择落成实际清单，失败则退化成「本次不加卡片」，
   * 不让用户因为版式问题卡在素材页。
   */
  private async buildAndConfirmCards(): Promise<void> {
    const state = this.requireState();
    if (!state.transcript) return;

    const controller = new AbortController();
    this.controller = controller;
    const ctx = this.makeCtx(controller, "cards");
    if (!ctx) return;

    this.setStatus("running");
    this.markStage("cards", "running");
    this.log("按当前参数生成版式…", "info", "cards");
    this.emit();

    try {
      const manifest = await runCardsStage(ctx, state.transcript, state.audio, state.material, state.cardPrefs);
      if (!this.state || !this.owns(controller)) return;

      state.cards = manifest;
      this.markStage("cards", "done", `${manifest.items.length} 张`);
      this.setStatus("material_ready");
      this.log(
        manifest.items.length > 0 ? `版式已生成并确认：${manifest.items.length} 张卡` : "版式已确认：本次不加任何卡片",
        "info",
        "cards",
      );
      this.log("素材与版式都确认了，去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
      this.emit();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (!this.owns(controller)) return;
      // 版式失败不挡成片：退回不带卡片的版本
      state.cards = null;
      this.setStatus("material_ready");
      this.markStage("cards", "skipped", "生成失败，本次不带卡片");
      this.log(
        `版式生成失败，本次成片不含卡片：${error instanceof Error ? error.message : String(error)}`,
        "warn",
        "cards",
      );
      this.emit();
    } finally {
      if (this.controller === controller) this.controller = null;
    }
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
    const ctx = this.makeCtx(controller, "cards");
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
    this.removeOutput(state.workspace);
    this.reopenCards(state);
    this.log(`「${manifest.items[index]?.title ?? spec.title}」已更新`, "info", "cards");
    this.emit();
    return state;
  }

  async cardStill(id: string): Promise<string> {
    const state = this.requireState();
    /*
     * 卡片有两个来源：
     *   state.material.items[].infoCard —— 素材页逐段指定的信息卡（以它为准）
     *   state.cards.items              —— 版式阶段产出的片头/章节/片尾
     *
     * 素材卡必须优先：版式阶段可能残留同一个 id 的旧规格（比如早先那次
     * 自动生成的信息卡），旧规格没有 bgImage，取到它就会渲染成没有底图的版本。
     */
    const spec =
      state.material?.items.find((item) => item.infoCard?.id === id)?.infoCard ??
      state.cards?.items.find((item) => item.id === id);
    if (!spec) throw new TaskError(`没有这张卡：${id}`, 400);

    /*
     * 已渲好的直接给文件，不进渲染队列。
     * 生成信息卡时就把静帧渲好了，正常路径应该全是这一支 —— 6 张同时请求也不会排队。
     */
    const { still: cached } = cardFiles(state.workspace, spec);
    if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
      spec.stillPath = cached;
      return cached;
    }

    const ctx = this.makeCtx(new AbortController(), "cards");
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
    this.removeOutput(state.workspace);
    state.runStartedAt = Date.now();
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

  /**
   * 一键配置：逐段判断哪几段适合做信息卡，适合的就生成。
   *
   * 每段独立调用一次 AI：「这段讲得清楚吗」必须看这一段自己的台词。
   * 已有的信息卡默认保留，除非 overwrite。
   */
  async applyInfoCardsAuto(
    options: { overwrite?: boolean; onProgress?: (done: number, total: number, paragraph: number) => void } = {},
  ): Promise<{ applied: number[]; skipped: number[]; failed: { paragraph: number; reason: string }[] }> {
    const state = this.requireState();
    if (!state.material) throw new TaskError("还没有素材，先生成素材", 400);
    if (!["awaiting_material", "material_ready", "completed"].includes(state.status)) {
      throw new TaskError("当前任务不可编辑", 400);
    }

    const paragraphs = state.material.items.map((item) => item.paragraph).sort((a, b) => a - b);
    const applied: number[] = [];
    const skipped: number[] = [];
    const failed: { paragraph: number; reason: string }[] = [];
    /*
     * 已用过的主题：逐段独立判断会让相邻段落抽到同一个主角
     * （实测第 1 段和第 6 段都出了「黄仁勋」）。收进来传给后面的段，让它换角度。
     */
    const usedTopics: string[] = state.material.items
      .map((item) => item.infoCard?.title)
      .filter((title): title is string => Boolean(title));

    const pending = options.overwrite
      ? paragraphs.length
      : paragraphs.filter(
          (paragraph) => !state.material?.items.find((entry) => entry.paragraph === paragraph)?.infoCard,
        ).length;
    if (pending > 0) {
      this.log(`开始为 ${pending} 段配信息卡：逐段判断适合做成哪种卡，每段要调一次模型`, "info", "material");
      this.emit();
    }

    for (const [index, paragraph] of paragraphs.entries()) {
      const item = state.material.items.find((entry) => entry.paragraph === paragraph);
      if (!item) {
        skipped.push(paragraph);
        continue;
      }
      if (item.infoCard && !options.overwrite) {
        skipped.push(paragraph);
        options.onProgress?.(index + 1, paragraphs.length, paragraph);
        continue;
      }
      try {
        const card = await this.applyInfoCard(paragraph, undefined, usedTopics);
        if (card) {
          applied.push(paragraph);
          usedTopics.push(card.title);
          // 逐段留痕：配卡要串行调好几次模型，只报总数用户会以为卡住了
          this.log(`第 ${paragraph} 段信息卡：${card.compositionId}「${card.title}」`, "info", "material");
        } else {
          skipped.push(paragraph);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        failed.push({ paragraph, reason: error instanceof Error ? error.message : String(error) });
      }
      options.onProgress?.(index + 1, paragraphs.length, paragraph);
    }

    this.scheduleSave();
    return { applied, skipped, failed };
  }

  /**
   * 给某一段生成信息卡并挂到 item 上。
   *
   * 单独抽出来是因为两条路径共用：用户手动点「加信息卡」，
   * 以及匹配素材时逐段自动配卡（后者此时 state.material 还没有正式清单，
   * 只能拿到单个 item）。返回 null 表示这段内容不适合做卡。
   *
   * 调用方负责 controller 与状态落盘。
   */
  private async generateInfoCardFor(
    item: MaterialItem,
    paragraph: number,
    total: number,
    accent: string,
    usedTopics?: string[],
    template?: string,
  ): Promise<CardSpec | null> {
    const ctx = this.makeCtx(this.controller ?? new AbortController(), "material");
    if (!ctx) return null;

    const audio = this.state?.audio?.paragraphs.find((entry) => entry.index === paragraph);
    const durationSec = Math.max(3, audio?.duration ?? item.duration ?? 5);

    const spec = await generateInfoCardForParagraph(ctx, paragraph, total, durationSec, accent, template, usedTopics);
    if (!spec) return null;

    // 有实拍就抽一帧当底图：素材自带运镜，信息层压在上面画面才是活的。
    // 抽不到（素材丢失等）就退化成纯设计卡，不影响成片。
    if (item.videoPath && fs.existsSync(item.videoPath)) {
      const frame = await materialFrameDataUri(item.videoPath, ctx.options.width, ctx.options.height);
      if (frame) spec.bgImage = frame;
    }

    item.fallback = false;
    /*
     * 顺手把静帧渲好。卡片的预览图是懒渲染的，第一次打开素材页才会现渲，
     * 一张要 6 秒上下；不提前做，用户看到的就是一排「卡片预览生成中」。
     * 这一步失败不影响卡片本身，页面仍可按需重渲，所以只记日志。
     */
    try {
      await ensureCardStill(ctx, spec, total);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      this.log(`第 ${paragraph} 段卡片预览生成失败，稍后打开页面会重试`, "warn", "material");
    }
    return spec;
  }

  /** 把某一段的画面换成信息卡；template 不传则让模型读完这段台词自己挑 */
  async applyInfoCard(paragraph: number, template?: string, usedTopics?: string[]): Promise<CardSpec | null> {
    const state = this.requireState();
    /*
     * 允许完成态也能改：卡片和实拍一样是「素材」，用户看到成片后想换一张卡
     * 是正常诉求，不该逼他重走整条流水线。改完把旧成片作废即可（见下方 invalidateResult）。
     */
    if (state.status !== "awaiting_material" && state.status !== "material_ready" && state.status !== "completed") {
      throw new TaskError("当前任务不在可编辑状态", 400);
    }
    if (!state.material) throw new TaskError(`第 ${paragraph} 段还没有素材`, 400);

    const item = state.material.items.find((entry) => entry.paragraph === paragraph);
    if (!item) throw new TaskError(`第 ${paragraph} 段还没有素材`, 400);

    const controller = new AbortController();
    this.controller = controller;
    const ctx = this.makeCtx(controller, "material");
    if (!ctx) throw new TaskError("任务状态异常", 500);

    try {
      // 主色取色板首位，和版式卡一致：CARD_ACCENT 直接当主色，不必再过一遍色板
      const accent = cardAccentPalette(loadConfig())[0] ?? "#ff5a3c";
      // 信息卡不是章节卡，total 只影响「第几页 / 共几页」这类角标，
      // 传段落总数才和成片一致（素材条目数可能因候选替换而变动）
      const total = state.transcript?.paragraphs.length ?? state.material.items.length;

      const spec = await this.generateInfoCardFor(item, paragraph, total, accent, usedTopics, template);
      if (!spec) return null;

      item.infoCard = spec;
      this.invalidateResult(state);
      this.scheduleSave();
      return spec;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new TaskError("已取消", 400);
      throw new TaskError(`生成信息卡失败：${error instanceof Error ? error.message : String(error)}`, 500);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 撤掉某段的信息卡，回到实拍 */
  clearInfoCard(paragraph: number): void {
    const state = this.requireState();
    if (state.status !== "awaiting_material" && state.status !== "material_ready" && state.status !== "completed") {
      throw new TaskError("当前任务不在可编辑状态", 400);
    }
    const item = state.material?.items.find((entry) => entry.paragraph === paragraph);
    if (!item) throw new TaskError(`第 ${paragraph} 段还没有素材`, 400);
    item.infoCard = undefined;
    this.invalidateResult(state);
    this.scheduleSave();
  }

  /**
   * 卡片变了就把成片作废。
   *
   * 完成态下改卡片时，旧成片已经不代表当前配置，留着会让用户以为「改了没反应」。
   * 只删成片与标记文件，片段缓存留着 —— 指纹链会判断哪些真的需要重渲。
   */
  private invalidateResult(state: TaskState): void {
    if (!state.result) return;
    /*
     * 用 removeWithRetry 而不是裸 rmSync：用户很可能正在预览页播放这条成片，
     * 文件句柄被占着会抛 EPERM，把「换卡」这类操作整个打断。
     * 标记文件先删，这样即使 mp4 暂时删不掉也不会被当成有效成片复用。
     */
    removeWithRetry(`${state.result}.ok`);
    removeWithRetry(state.result);
    state.result = null;
    if (state.status === "completed") state.status = "material_ready";
  }

  async searchMaterial(paragraph: number, terms?: string[]): Promise<MaterialInfo[]> {
    const state = this.requireState();
    if ((state.status !== "awaiting_material" && state.status !== "material_ready") || !state.material) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }
    const current = state.material.items.find((item) => item.paragraph === paragraph);
    if (!current) throw new TaskError(`第 ${paragraph} 段还没有素材`, 400);

    const controller = new AbortController();
    this.controller = controller;
    const ctx = this.makeCtx(controller, "material");
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

    /*
     * 从「第一个没做完的阶段」接着跑，不能只看 result / cards / material 有没有值。
     *
     * 以前写的是 `if (state.cards) executeCompose()`，可 cards 和 material 都是
     * 上一轮留下的：用户这轮正在重新匹配素材（material 停在第 2 段），点「继续」
     * 却因为 cards 非空直接跳去合成，用的是过期的素材清单。
     */
    const next = nextResumeStep(state);
    if (next === "match" && state.transcript && state.audio) {
      void this.executeMatch(controller, state.transcript, state.audio);
    } else if (next === "cards") {
      void this.executeCards(controller);
    } else if (next === "compose" && state.transcript && state.audio && state.material) {
      void this.executeCompose(controller);
    } else if (state.transcript && state.audio) {
      void this.executeMatch(controller, state.transcript, state.audio);
    } else if (state.transcript) {
      void this.executeTts(controller, state.transcript);
    } else {
      void this.execute(controller);
    }

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
    this.removeOutput(ws);
    fs.rmSync(path.join(ws, "_bgm.wav"), { force: true });
    /*
     * clips/ 里的 mp4 可能正被素材页的 <video> 播放着，句柄没释放时递归删会抛
     * EPERM 并中断整个操作。逐个文件重试，删不掉就留着 —— 素材清单和片段签名
     * 都已清空，残留文件不会被复用，只是占点磁盘。
     */
    removeDirWithRetry(path.join(ws, "clips"));
    removeDirWithRetry(path.join(ws, "subs"));
    removeDirWithRetry(path.join(ws, "cards"));

    // 逐句音频同名复用，需一并清掉
    try {
      for (const name of fs.readdirSync(ws)) {
        if (/^\d+_\d+_\d+\.(wav|mp3)$/i.test(name)) fs.rmSync(path.join(ws, name), { force: true });
      }
    } catch {
      // 工作目录不存在，跳过
    }

    state.audio = null;
    state.material = null;
    state.cards = null;
    state.result = null;
    state.runStartedAt = Date.now();
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

  /**
   * 清掉某阶段及其下游的日志。
   *
   * 光按 stage 过滤不够：日志没有显式 stage 时会回落到 currentStageId，
   * 而它在阶段切换时被置空，于是「第 N 段就绪」这类行落了 undefined，
   * 绕过 stale 判断活下来 —— 用户点「重新生成」后旧日志仍挂在页面上。
   * 所以再按时间兜一道：早于本次开跑时刻的行一律清掉。
   */
  private clearLogsFrom(state: TaskState, stageId: string): void {
    const from = STAGE_ORDER.indexOf(stageId);
    if (from < 0) return;
    const stale = new Set(STAGE_ORDER.slice(from));
    const since = state.runStartedAt;
    state.logs = state.logs.filter((line) => {
      if (stale.has(line.stage ?? "")) return false;
      // 没有 stage 的历史行：只保留本次开跑之后写进来的
      if (!line.stage && since) return Date.parse(line.time) >= since;
      return true;
    });
  }

  /**
   * 删成片。
   *
   * Windows 上正在播放的 mp4 被读取流占着句柄，rmSync 会抛 EPERM；让它冒出来
   * 会让「继续 / 重新生成 / 确认素材」整个失败。所以重试几次，仍删不掉就留到下次
   * （指纹比对会发现参数变了，自然重合成，见 compose 的 isComposedOutput）。
   */
  private removeOutput(workspace: string): void {
    const target = path.join(workspace, "_output.mp4");
    const marker = `${target}.ok`;
    removeWithRetry(marker);
    // 标记先删：标记没了，即使文件删不掉也不会被当成有效成片复用
    if (!removeWithRetry(target)) {
      this.log("旧成片被占用，暂时删不掉；合成时会覆盖它", "warn", "compose");
    }
  }

  /** 只作废被替换段落的片段 */
  private invalidateClips(state: TaskState, paragraphs: number[]): void {
    this.removeOutput(state.workspace);
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

  /**
   * 流水线内部的 ctx.log 不带 stage 参数，会回落到 currentStageId。
   * 但 currentStageId 只在 markStage("running") 时赋值；阶段收尾消息常常
   * 先 markStage("done") 再 log，这时它已经不再是当前阶段，那批行就落成 undefined，
   * 重跑时清日志会漏掉它们。
   *
   * 所以给它一个默认 stage 兜底（脚本阶段有 fetch/write/rewrite/split 四个子阶段，
   * 保持 undefined 让它们各自归属；只有单阶段流水线才传 stageId）。
   */
  private makeCtx(controller: AbortController, stageId?: string): TaskContext | null {
    const state = this.state;
    if (!state) return null;
    return {
      input: state.input,
      options: state.options,
      workspace: state.workspace,
      signal: controller.signal,
      // 显式 stageId 优先；否则交给 currentStageId，最后才落到兜底
      log: (text, level) => this.log(text, level, stageId),
      markStage: (id, status, message) => this.markStage(id, status, message),
    };
  }

  private async execute(controller: AbortController): Promise<void> {
    // 脚本阶段在 runScriptStages 内部按 fetch/write/rewrite/split 各自 markStage，
    // 这里不固定 stage，让日志跟 currentStageId 走。
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
    const ctx = this.makeCtx(controller, "tts");
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
    const ctx = this.makeCtx(controller, "material");
    if (!ctx) return;

    try {
      /*
       * 逐段推进：素材一下载好就补这一段的信息卡，然后把这一段推给前端。
       * 早先是「整条素材跑完 → 再统一配卡」，用户要等 1 分多钟才看到第一段，
       * 中途完全不知道里面在干什么。
       */
      const autoCards = this.state?.options.autoInfoCards !== false;
      const usedTopics: string[] = [];
      let carded = 0;
      let cardFailed = 0;

      const material = await runMaterialStage(ctx, transcript, audio, async (item) => {
        if (!this.state || !this.owns(controller)) return;

        /*
         * 每段都重新取 state：runMaterialStage 期间 state.material 还没赋值，
         * 这里先把已完成的段挂成「进行中的清单」，前端才能边跑边显示。
         */
        const state = this.state;
        const partial: MaterialManifest = state.material ?? {
          source: state.options.materialSource,
          signature: "",
          items: [],
        };
        const without = partial.items.filter((entry) => entry.paragraph !== item.paragraph);
        state.material = { ...partial, items: [...without, item].sort((a, b) => a.paragraph - b.paragraph) };

        if (autoCards) {
          const total = transcript.paragraphs.length;
          const accent = cardAccentPalette(loadConfig())[0] ?? "#ff5a3c";
          try {
            const spec = await this.generateInfoCardFor(item, item.paragraph, total, accent, usedTopics);
            if (spec) {
              item.infoCard = spec;
              usedTopics.push(spec.title);
              carded++;
              this.log(`第 ${item.paragraph} 段信息卡：${spec.compositionId}「${spec.title}」`, "info", "material");
            }
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") throw error;
            cardFailed++;
            this.log(
              `第 ${item.paragraph} 段信息卡生成失败，只保留实拍：${error instanceof Error ? error.message : String(error)}`,
              "warn",
              "material",
            );
          }
        }

        this.log(`第 ${item.paragraph} 段就绪`, "info", "material");
        this.emit();
      });

      if (!this.state || !this.owns(controller)) return;
      // markStage 内部会 emit，先赋值再标阶段
      this.state.material = material;
      this.setStatus("awaiting_material");
      this.markStage("material", "done", `${material.items.length} 段`);
      this.log(`素材已就绪：${material.items.length} 段`, "info", "material");
      if (autoCards) {
        this.log(
          carded > 0
            ? `已为 ${carded} 段生成信息卡${cardFailed > 0 ? `，${cardFailed} 段失败` : ""}`
            : "本次没有段落配信息卡",
          "info",
          "material",
        );
      }
      this.log("素材已匹配，确认后开始合成视频", "info", "material");
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
      this.log(`第 ${paragraph} 段换成新素材：${updated.tags || updated.id}`, "info", "material");
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

  /**
   * 已确认、已出片也允许改，改完自动回到待确认。
   *
   * awaiting_material / material_ready 必须算进来：版式已并进素材页，
   * 用户在这页就能直接对片头/章节卡点「换一个」，此时任务状态正是这两个。
   */
  private canEditCards(state: TaskState): boolean {
    if (!state.cards) return false;
    return (
      state.status === "awaiting_cards" ||
      state.status === "cards_ready" ||
      state.status === "completed" ||
      state.status === "awaiting_material" ||
      state.status === "material_ready"
    );
  }

  /** 补建缺失的卡片：只补 wanted 里的类型，规则在 cards.ts 的 buildCards 里 */
  private buildCardsFor(
    cfg: AppConfig,
    state: TaskState,
    wanted: Set<CardKind>,
    secs: Partial<Record<CardKind, number>>,
    accent: string | null,
  ): CardSpec[] {
    const transcript = state.transcript;
    if (!transcript) return [];

    const { width, height, fps } = state.options;
    const palette = cardAccentPalette(cfg);
    const color = accent ?? state.cardPrefs?.accent ?? palette[0] ?? "#ff5a3c";
    return buildCards(cfg, transcript, wanted, secs, color, width, height, fps);
  }

  /**
   * 合并版式页改的配色与时长，没传的沿用旧值。
   * 时长 0 表示这次不出这类卡，判空只能用 undefined，不能用真假值。
   */
  private mergeCardPrefs(state: TaskState, patch: CardPrefs = {}): void {
    const current = state.cardPrefs ?? {};
    const wanted = typeof patch.accent === "string" ? patch.accent.trim().toLowerCase() : "";
    const accent = wanted ? cardAccentPalette(loadConfig()).find((c) => c.toLowerCase() === wanted) : undefined;
    if (wanted && !accent) throw new TaskError("配色不在允许的色板里", 400);

    const pickSec = (raw: number | undefined, fallback: number | undefined, label: string) => {
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 15) {
        throw new TaskError(`${label}时长要在 0–15 秒之间`, 400);
      }
      return Math.round(value * 10) / 10;
    };

    const next: CardPrefs = {};
    const finalAccent = accent ?? current.accent;
    if (finalAccent) next.accent = finalAccent;

    const intro = pickSec(patch.introDurationSec, current.introDurationSec, "片头");
    const chapter = pickSec(patch.chapterDurationSec, current.chapterDurationSec, "章节卡");
    const outro = pickSec(patch.outroDurationSec, current.outroDurationSec, "片尾");
    if (intro !== undefined) next.introDurationSec = intro;
    if (chapter !== undefined) next.chapterDurationSec = chapter;
    if (outro !== undefined) next.outroDurationSec = outro;

    const filled = Object.values(next).some((value) => value !== undefined);
    state.cardPrefs = filled ? next : null;
  }

  /**
   * 版式改完后把任务拉回「待确认」，让成片作废重合成。
   *
   * 版式已并进素材页，用户在 awaiting_material / material_ready 下改卡时
   * 不该把状态改成 awaiting_cards —— 那会让 derivePhase 判成另一个页面，
   * 而且素材本身还是好的，没必要回到「等素材确认」。只在真是版式步骤时才改。
   */
  private reopenCards(state: TaskState): void {
    if (state.status === "awaiting_cards") return;
    if (state.status === "awaiting_material" || state.status === "material_ready") {
      this.log("版式有改动，成片会按新卡片重新合成", "warn", "cards");
      return;
    }
    this.setStatus("awaiting_cards");
    this.log("版式有改动，需要重新确认后再合成", "warn", "cards");
  }

  private async executeCards(controller: AbortController, resetStage = false): Promise<void> {
    const ctx = this.makeCtx(controller, "cards");
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
    const ctx = this.makeCtx(controller, "compose");
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

  private markStage(id: string, status: StageStatus, message?: string, counts?: StageState["counts"]): void {
    const state = this.state;
    if (!state) return;
    const stage: StageState | undefined = state.stages.find((s) => s.id === id);
    if (!stage) return;

    stage.status = status;
    if (message !== undefined) stage.message = message;
    if (counts !== undefined) stage.counts = counts;
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
