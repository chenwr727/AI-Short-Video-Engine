import fs from "node:fs";
import path from "node:path";
import { autoSubtitleFontSize } from "../config.js";
import { newWorkspace } from "../paths.js";
import { persistConfirmed, runScriptStages, sentenceCount } from "../pipeline/script.js";
import { runTtsStage } from "../pipeline/tts.js";
import { runMaterialStage, saveMaterialManifest, searchCandidates } from "../pipeline/material.js";
import { runComposeStage } from "../pipeline/compose.js";
import { resolveMusicFile } from "../services/bgm.js";
import { downloadMaterial } from "../services/material.js";
import type {
  AudioManifest,
  GenerateOptions,
  LogLine,
  MaterialInfo,
  MaterialItem,
  RawTranscript,
  RenderPatch,
  StageState,
  StageStatus,
  TaskContext,
  TaskEvent,
  TaskState,
  TaskStatus,
  Transcript,
} from "../types.js";

/** 全流程阶段；M1 只跑到 split，后面三个阶段留给后续里程碑 */
export const STAGE_DEFS: { id: string; label: string }[] = [
  { id: "fetch", label: "获取内容" },
  { id: "write", label: "生成草稿" },
  { id: "rewrite", label: "改写剧本" },
  { id: "split", label: "拆分台词" },
  { id: "tts", label: "合成配音" },
  { id: "material", label: "匹配素材" },
  { id: "compose", label: "合成视频" },
];

const MAX_LOGS = 300;

export class TaskError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TaskError";
    this.statusCode = statusCode;
  }
}

type Listener = (event: TaskEvent) => void;

/** 手动更换素材时前端回传的候选（带所属段号） */
export interface MaterialReplacement extends MaterialInfo {
  paragraph: number;
}

class TaskManager {
  private state: TaskState | null = null;
  private controller: AbortController | null = null;
  private listeners = new Set<Listener>();
  /** 当前正在跑的阶段，用来给日志打标记，前端好按页面过滤 */
  private currentStageId: string | null = null;

  getState(): TaskState | null {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 单任务：已有任务在跑或在等确认时拒绝新任务 */
  start(input: string, options: GenerateOptions, force = false): TaskState {
    const current = this.state;
    if (
      !force &&
      current &&
      (current.status === "running" || current.status === "awaiting_script" || current.status === "awaiting_material")
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
      stages: STAGE_DEFS.map((d) => ({ ...d, status: "pending" as StageStatus })),
      logs: [],
      transcript: null,
      audio: null,
      material: null,
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

  /**
   * 用同一份输入重新生成剧本：老任务先掐掉，换新工作目录重跑，避免命中剧本缓存。
   * speakers 是「文案脚本」页改过的角色名，空值沿用任务原来的设置。
   */
  regenerate(speakers?: { main?: string; guest?: string }): TaskState {
    const state = this.requireState();
    const options: GenerateOptions = {
      ...state.options,
      speakers: {
        main: speakers?.main || state.options.speakers.main,
        guest: speakers?.guest || state.options.speakers.guest,
      },
    };

    this.controller?.abort();
    this.controller = null;

    return this.start(state.input, options, true);
  }

  /** 确认剧本（可带前端编辑后的版本与配音/素材设置），进入下一步 */
  confirm(raw?: RawTranscript, patch?: Partial<GenerateOptions>): TaskState {
    const state = this.requireState();
    if (state.status !== "awaiting_script") {
      throw new TaskError("当前任务不在等待确认状态", 400);
    }

    const transcript = raw ? persistConfirmed(state.workspace, raw) : state.transcript;
    if (!transcript) throw new TaskError("剧本为空，无法确认", 400);

    // 进入配音阶段，之前写稿的日志不再挂到新阶段上
    this.currentStageId = null;

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

  /** 匹配素材（第四步的动作）；素材已经匹配过则拒绝 */
  matchMaterial(patch?: Partial<GenerateOptions>): TaskState {
    const state = this.requireState();
    if (state.status !== "awaiting_material") {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }
    if (state.material) throw new TaskError("素材已经匹配过了", 400);
    if (!state.transcript || !state.audio) {
      throw new TaskError("配音还没完成，无法匹配素材", 400);
    }

    if (patch) {
      state.options = { ...state.options, ...patch };
      this.log(`素材来源：${state.options.materialSource}`, "info", "material");
    }

    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("running");
    this.log("开始按台词匹配素材…", "info", "material");
    this.emit();
    void this.executeMatch(controller, state.transcript, state.audio);
    return state;
  }

  /** 素材确认：只保存手动替换与分辨率，不自动合成（渲染参数在成片预览页定） */
  async confirmMaterial(items?: MaterialReplacement[], patch?: Partial<GenerateOptions>): Promise<TaskState> {
    const state = this.requireState();
    if ((state.status !== "awaiting_material" && state.status !== "material_ready") || !state.material) {
      throw new TaskError("当前任务不在等待素材确认状态", 400);
    }

    // 可能还有一次候选检索在跑，先掐掉
    this.controller?.abort();

    if (patch) {
      const before = state.options;
      state.options = { ...state.options, ...patch };
      if (state.options.width !== before.width || state.options.height !== before.height) {
        // 分辨率变了，按旧尺寸渲染的片段不能再用
        fs.rmSync(path.join(state.workspace, "clips"), { recursive: true, force: true });
        fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
      }
      if (state.options.width !== before.width) {
        // 字号没被手动改过（仍等于按旧画宽算出的默认值）就跟着新分辨率重算
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

    // 素材定稿后停在「待生成成片」，让用户在成片预览页选字号/BGM 再生成
    state.result = null;
    this.setStatus("material_ready");
    this.log("素材已确认，去「成片预览」设置字幕与 BGM 后生成成片", "info", "compose");
    this.emit();
    return state;
  }

  /**
   * 成片预览页点「生成成片 / 重新生成」：按当前渲染参数合成。
   * 只重跑合成，配音、素材和分段片段都命中缓存；字号变了才需要重渲染片段。
   */
  render(patch?: RenderPatch): TaskState {
    const state = this.requireState();
    if (!state.transcript || !state.audio || !state.material) {
      throw new TaskError("还没有可合成的内容，先跑完素材确认", 400);
    }
    if (state.status === "running") {
      throw new TaskError("正在合成，等这一版出来再改参数", 409);
    }

    const before = state.options;
    const next: GenerateOptions = { ...before };
    if (patch?.subtitleFontSize !== undefined) next.subtitleFontSize = patch.subtitleFontSize;
    if (patch?.bgmEnabled !== undefined) next.bgmEnabled = patch.bgmEnabled;
    if (patch?.bgmVolume !== undefined) next.bgmVolume = patch.bgmVolume;
    if (patch?.bgmFile !== undefined) next.bgmFile = patch.bgmFile.trim() || undefined;

    // 关掉 BGM 时把自定义音乐一起清掉，避免下次打开后被残留路径影响
    if (next.bgmEnabled === false) next.bgmFile = undefined;

    // 先在请求里挡掉明显的路径/格式错误，别让用户等一整轮合成才发现
    if (next.bgmFile) {
      const resolved = resolveMusicFile(next.bgmFile);
      if (!resolved.file) throw new TaskError(resolved.reason ?? "音乐文件不可用", 400);
    }

    state.options = next;
    state.result = null;
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    // 字幕烧进了分段片段，字号一改这些片段就得重渲染
    if ((before.subtitleFontSize ?? 0) !== (next.subtitleFontSize ?? 0)) {
      fs.rmSync(path.join(state.workspace, "clips"), { recursive: true, force: true });
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

  /** 重新检索某一段的候选素材，供手动更换 */
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

  /**
   * 重试失败的任务：不换工作目录，已完成的阶段直接命中缓存，
   * 从「还缺什么」的位置接着跑（缺成片→合成，缺素材→配音+素材，缺剧本→重写剧本）。
   */
  retry(): TaskState {
    const state = this.requireState();
    if (state.status !== "failed") {
      throw new TaskError("只有失败的任务可以重试", 400);
    }

    this.controller?.abort();

    for (const stage of state.stages) {
      if (stage.status === "failed") {
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
    this.log("重试未完成的步骤（已完成的阶段会命中缓存）");
    this.emit();

    if (state.material) void this.executeCompose(controller);
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
      state.status !== "awaiting_material"
    ) {
      throw new TaskError("任务已结束，无需取消", 400);
    }
    this.controller?.abort();
    this.setStatus("cancelled");
    this.log("任务已取消", "warn");
    this.emit();
    return state;
  }

  // ---------------------------------------------------------------- 内部

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
      if (!this.state) return;
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

  /** 配音：只跑 TTS，完成后停在「素材确认」，素材由第四步自己触发匹配 */
  private async executeTts(controller: AbortController, transcript: Transcript): Promise<void> {
    const ctx = this.makeCtx(controller);
    if (!ctx) return;

    try {
      const manifest = await runTtsStage(ctx, transcript);
      if (!this.state) return;
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

  /** 匹配素材：第四步点「开始匹配素材」时触发，完成后仍停在素材确认 */
  private async executeMatch(
    controller: AbortController,
    transcript: Transcript,
    audio: AudioManifest,
  ): Promise<void> {
    const ctx = this.makeCtx(controller);
    if (!ctx) return;

    try {
      const material = await runMaterialStage(ctx, transcript, audio);
      if (!this.state) return;
      this.state.material = material;
      this.setStatus("awaiting_material");
      this.log(`素材已就绪：${material.items.length} 段`);
      this.log("素材已匹配，确认后开始合成视频");
      this.emit();
    } catch (error) {
      this.fail(error, controller);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** 把前端选定的替换素材下载下来并写回清单 */
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
    // 成片缓存作废，否则合成阶段会直接复用旧视频
    fs.rmSync(path.join(state.workspace, "_output.mp4"), { force: true });
    this.emit();
  }

  private async executeCompose(controller: AbortController): Promise<void> {
    const ctx = this.makeCtx(controller);
    const state = this.state;
    if (!ctx || !state) return;

    const { transcript, audio, material } = state;
    try {
      if (!transcript || !audio || !material) throw new Error("缺少剧本、配音或素材，无法合成");
      const output = await runComposeStage(ctx, transcript, audio, material);
      if (!this.state) return;
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

  /** controller 用来识别「已被新任务取代的旧任务」，避免它把失败状态写到新任务上 */
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

  /** stage 传了就按它归页，否则跟着当前正在跑的阶段走 */
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
      // 阶段跑起来后，后续日志都归到它名下（阶段结束也不清，方便带上收尾那几句）
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
    const event: TaskEvent = { type: "snapshot", state: this.state };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者异常不应影响其他订阅者
      }
    }
  }
}

export const taskManager = new TaskManager();
