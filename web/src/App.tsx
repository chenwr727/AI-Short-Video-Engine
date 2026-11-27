import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  confirmMaterial,
  confirmScript,
  getHealth,
  matchMaterial,
  getMeta,
  getTask,
  regenerateScript,
  regenerateTts,
  renderVideo,
  retryTask,
  startGenerate,
  subscribeTask,
  type RenderPatch,
} from "./api";
import { bridge } from "./bridge";
import { useLanguage, useT } from "./i18n";
import type { MessageKey } from "./i18n";
import {
  COMPOSE_STAGE_IDS,
  derivePhase,
  doneThrough,
  indexOf,
  reachedIndex,
  RENDER_STAGE_IDS,
  stalledPhase,
  stepsFor,
  type Phase,
} from "./phases";
import { AppMenu } from "./components/AppMenu";
import { ThemeToggle } from "./components/ThemeToggle";
import { EnvStatus } from "./components/EnvStatus";
import { StatusBar } from "./components/StatusBar";
import { StepBar } from "./components/StepBar";
import { InputStep } from "./components/InputStep";
import { ScriptStep } from "./components/ScriptStep";
import { RenderSetupStep } from "./components/RenderSetupStep";
import { MaterialStep } from "./components/MaterialStep";
import { RenderStep } from "./components/RenderStep";
import { ResultStep } from "./components/ResultStep";
import type { FormState, RenderFormState } from "./components/stepTypes";
import { watchSystemTheme } from "./theme";
import type { CardPrefs, Health, MaterialInfo, Meta, RawTranscript, TaskState, Transcript } from "./types";

const STATUS_TEXT: Record<TaskState["status"], MessageKey> = {
  idle: "app.status.idle",
  running: "app.status.running",
  awaiting_script: "app.status.awaiting_script",
  script_confirmed: "app.status.script_confirmed",
  tts_ready: "app.status.tts_ready",
  material_ready: "app.status.material_ready",
  awaiting_material: "app.status.awaiting_material",
  awaiting_cards: "app.status.awaiting_cards",
  cards_ready: "app.status.cards_ready",
  completed: "app.status.completed",
  failed: "app.status.failed",
  cancelled: "app.status.cancelled",
};

const STATUS_TONE: Record<TaskState["status"], string> = {
  idle: "",
  running: "info",
  awaiting_script: "info",
  script_confirmed: "info",
  tts_ready: "info",
  material_ready: "info",
  awaiting_material: "info",
  awaiting_cards: "info",
  cards_ready: "info",
  completed: "ok",
  failed: "bad",
  cancelled: "",
};

function toRaw(transcript: Transcript): RawTranscript {
  return {
    title: transcript.title,
    paragraphs: transcript.paragraphs.map((paragraph) => ({
      description: paragraph.description,
      dialogues: paragraph.dialogues.map((dialogue) => ({
        speaker: dialogue.speaker,
        content: dialogue.contents.join(""),
      })),
    })),
  };
}

/** 按出场顺序去重 */
function speakersOf(raw: RawTranscript | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const paragraph of raw.paragraphs) {
    for (const dialogue of paragraph.dialogues) seen.add(dialogue.speaker);
  }
  return [...seen];
}

/** 设置保存会重载窗口，草稿暂存 sessionStorage */
const DRAFT_KEY = "aisv.form-draft";

function readDraft(): FormState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    return {
      content: parsed.content ?? "",
      promptSource: parsed.promptSource ?? "",
      speakerMain: parsed.speakerMain ?? "",
      speakerGuest: parsed.speakerGuest ?? "",
    };
  } catch {
    return null;
  }
}

function writeDraft(form: FormState): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    // 隐私模式可能不可写
  }
}

export default function App() {
  const t = useT();
  // 恢复条里的时间按界面语言格式化
  const language = useLanguage();
  const [health, setHealth] = useState<Health | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [following, setFollowing] = useState(true);
  const [edit, setEdit] = useState<RawTranscript | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(
    () =>
      readDraft() ?? {
        content: "",
        promptSource: "",
        speakerMain: "",
        speakerGuest: "",
      },
  );
  const [renderForm, setRenderForm] = useState<RenderFormState>({
    ttsEngine: "",
    ttsSpeed: 0,
    materialSource: "",
    resolution: "",
    autoInfoCards: true,
    voices: {},
  });
  // 手动换过的素材，切换步骤不丢
  const [materialPicks, setMaterialPicks] = useState<Record<number, MaterialInfo>>({});
  /** 版式参数：合并后在素材页配置，确认素材时一并落库 */
  const [cardPrefs, setCardPrefs] = useState<CardPrefs>({});
  // 走到过的最远一步，无任务进度时步骤条靠它
  const [maxStep, setMaxStep] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [resumed, setResumed] = useState<TaskState | null>(null);
  const restartingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, m, t] = await Promise.all([getHealth(), getMeta(), getTask()]);
        if (!alive) return;
        setHealth(h);
        setMeta(m);
        setTask(t);

        // 有快照说明恢复了上次任务，定位到停下的一步
        const resume = stalledPhase(t);
        if (t && resume && resume !== "input") {
          setPhase(resume);
          setFollowing(true);
          setResumed(t);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 清空界面后忽略 SSE 推回来的旧快照
  const ignoreTaskRef = useRef(false);

  useEffect(
    () =>
      subscribeTask(
        (next) => {
          if (ignoreTaskRef.current) return;
          setTask(next);
        },
        // 重连说明后端重启过，配置可能已变
        () => {
          void getHealth()
            .then(setHealth)
            .catch(() => undefined);
        },
      ),
    [],
  );

  // 桌面端页头兼作标题栏
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    document.body.classList.add("electron");
    if (api.platform === "darwin") document.body.classList.add("mac");
  }, []);

  // 偏好是「跟随系统」时，系统深浅一变界面跟着变
  useEffect(() => watchSystemTheme(() => undefined), []);

  useEffect(() => {
    if (!meta) return;
    setForm((prev) => ({
      ...prev,
      promptSource: prev.promptSource || meta.promptSources[0]?.id || "",
      speakerMain: prev.speakerMain || meta.speakers.main,
      speakerGuest: prev.speakerGuest || meta.speakers.guest,
    }));

    setRenderForm((prev) => ({
      ...prev,
      ttsEngine: prev.ttsEngine || meta.ttsEngines[0]?.id || "",
      ttsSpeed: prev.ttsSpeed || meta.ttsSpeed || 1.1,
      materialSource: prev.materialSource || meta.materialSources[0]?.id || "",
      resolution: prev.resolution || meta.resolutions[0]?.id || "",
    }));
  }, [meta]);

  useEffect(() => {
    writeDraft(form);
  }, [form]);

  useEffect(() => {
    setEdit(null);
    setMaterialPicks({});
  }, [task?.id]);

  // 回填任务已有的来源与分辨率，仅填空值
  useEffect(() => {
    if (!task) return;
    const { width, height, materialSource, ttsEngine, ttsSpeed, autoInfoCards } = task.options;
    setRenderForm((prev) => ({
      ...prev,
      ttsEngine: prev.ttsEngine || ttsEngine,
      ttsSpeed: prev.ttsSpeed || ttsSpeed,
      materialSource: prev.materialSource || materialSource,
      resolution: prev.resolution || `${width}x${height}`,
      // 旧任务没有这个字段，缺省按开启处理
      autoInfoCards: autoInfoCards !== false,
    }));
  }, [task]);

  // 只依赖 task?.id，否则快照会覆盖正在输入的输入框
  useEffect(() => {
    if (!task) return;
    const { promptSource, speakers } = task.options;
    setForm((prev) => ({
      content: prev.content || task.input,
      promptSource: promptSource || prev.promptSource,
      speakerMain: speakers.main || prev.speakerMain,
      speakerGuest: speakers.guest || prev.speakerGuest,
    }));
  }, [task?.id]);

  useEffect(() => {
    if (task?.status === "awaiting_script" && task.transcript) {
      setEdit((prev) => prev ?? toRaw(task.transcript as Transcript));
    } else if (task?.status !== "awaiting_script") {
      setEdit(null);
    }
  }, [task?.status, task?.transcript]);

  const renderEngine = useMemo(
    () => meta?.ttsEngines.find((item) => item.id === renderForm.ttsEngine),
    [meta, renderForm.ttsEngine],
  );

  const speakers = useMemo(
    () => speakersOf(edit ?? (task?.transcript ? toRaw(task.transcript) : null)),
    [edit, task?.transcript],
  );

  // 按出场顺序轮换音色，用户改过的保留
  useEffect(() => {
    if (phase !== "render" || task?.status !== "awaiting_script" || speakers.length === 0) return;
    const options = renderEngine?.voices.map((voice) => voice.id) ?? [];
    if (options.length === 0) return;

    setRenderForm((prev) => {
      const next: Record<string, string> = {};
      speakers.forEach((speaker, index) => {
        const current = prev.voices[speaker];
        next[speaker] = current && options.includes(current) ? current : (options[index % options.length] as string);
      });
      return JSON.stringify(next) === JSON.stringify(prev.voices) ? prev : { ...prev, voices: next };
    });
  }, [phase, task?.status, speakers, renderEngine]);

  const target = derivePhase(task);

  // 只向前推进；用户回看时暂停跟随
  useEffect(() => {
    if (!following || !target) return;
    setPhase((prev) => (indexOf(target) > indexOf(prev) ? target : prev));
  }, [target, following]);

  // 换步骤滚回顶部
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [phase]);

  // 记录走过的最远位置
  useEffect(() => {
    setMaxStep((prev) => Math.max(prev, indexOf(phase)));
  }, [phase]);

  const running = task?.status === "running";
  const awaiting = task?.status === "awaiting_script";
  const reached = Math.max(reachedIndex(task), maxStep);
  // 无任务或已取消时没有后端进度，按走到哪算
  const done = task && task.status !== "idle" && task.status !== "cancelled" ? doneThrough(task) : reached;
  const canNext = Boolean(form.content.trim()) && !running && !busy;
  const canStart =
    Boolean(form.content.trim()) &&
    !running &&
    !awaiting &&
    task?.status !== "awaiting_material" &&
    Boolean(health?.config.llm.configured) &&
    !busy;

  /** 灰按钮要有原因提示 */
  const blockedReason = !health
    ? t("app.connecting")
    : running
      ? t("app.busy")
      : !health.config.llm.configured
        ? t("app.noLlmKey")
        : !form.content.trim()
          ? t("app.noContent")
          : "";

  function onFormChange(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function onRenderFormChange(patch: Partial<RenderFormState>) {
    setRenderForm((prev) => ({ ...prev, ...patch }));
  }

  function onVoiceChange(speaker: string, voice: string) {
    setRenderForm((prev) => ({ ...prev, voices: { ...prev.voices, [speaker]: voice } }));
  }

  async function onStart() {
    setBusy(true);
    setError("");
    try {
      const state = await startGenerate({
        input: form.content,
        promptSource: form.promptSource,
        speakers: { main: form.speakerMain.trim(), guest: form.speakerGuest.trim() },
        ttsEngine: renderForm.ttsEngine,
        voice: Object.values(renderForm.voices)[0] ?? renderEngine?.voices[0]?.id ?? "",
        materialSource: renderForm.materialSource,
        autoInfoCards: renderForm.autoInfoCards !== false,
        resolution: renderForm.resolution,
      });
      ignoreTaskRef.current = false;
      setTask(state);
      setFollowing(true);
      setPhase("script");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onStartRender() {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      const state = await confirmScript({
        transcript: edit,
        options: {
          ttsEngine: renderForm.ttsEngine,
          ttsSpeed: renderForm.ttsSpeed,
          voices: renderForm.voices,
          materialSource: renderForm.materialSource,
          autoInfoCards: renderForm.autoInfoCards !== false,
          resolution: renderForm.resolution,
        },
      });
      setTask(state);
      setFollowing(true);
      setPhase("render");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmMaterial(items: (MaterialInfo & { paragraph: number })[]) {
    setBusy(true);
    setError("");
    try {
      /*
       * 版式已并进素材页：后端在确认素材时按 cardPrefs 生成并确认版式，
       * 所以这里只提交参数，返回的状态就已经是 material_ready。
       */
      const state = await confirmMaterial(items, renderForm.resolution, cardPrefs);
      setTask(state);
      setMaterialPicks({});
      setFollowing(true);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmDiscard(message: string): boolean {
    return window.confirm(message);
  }

  /** 重跑剧本，参数取表单当前值 */
  async function onRegenerate() {
    if (task?.transcript && !confirmDiscard(t("script.regenerateConfirm"))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      setTask(
        await regenerateScript({
          input: form.content,
          promptSource: form.promptSource,
          speakers: { main: form.speakerMain.trim(), guest: form.speakerGuest.trim() },
        }),
      );
      setFollowing(true);
      setPhase("script");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onMatchMaterial(force = false) {
    if (force && task?.material && !confirmDiscard(t("material.regenerateConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      setTask(
        await matchMaterial({
          materialSource: renderForm.materialSource,
          resolution: renderForm.resolution,
          autoInfoCards: renderForm.autoInfoCards !== false,
          force,
        }),
      );
      setFollowing(true);
      setPhase("material");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 台词不动，按当前音色设置重做配音 */
  async function onRegenerateTts() {
    if (task?.audio && !confirmDiscard(t("tts.regenerateConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      setTask(
        await regenerateTts({
          ttsEngine: renderForm.ttsEngine,
          ttsSpeed: renderForm.ttsSpeed,
          voices: renderForm.voices,
        }),
      );
      setFollowing(true);
      setPhase("render");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRender(patch: RenderPatch) {
    setBusy(true);
    setError("");
    try {
      setTask(await renderVideo(patch));
      setFollowing(true);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 只有桌面端有桥，浏览器里手动填路径 */
  async function onPickMusic(): Promise<string> {
    const pick = bridge()?.pickMusic;
    return pick ? pick() : "";
  }

  /** 在文件管理器中定位成片 */
  async function onReveal(file: string) {
    const reveal = bridge()?.revealFile;
    if (!reveal) return;
    try {
      const res = await reveal(file);
      if (!res.ok) window.alert(res.error ?? t("result.revealFailed"));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  /** 中断这一轮，保留工作目录可接着跑 */
  async function onCancel() {
    setBusy(true);
    setError("");
    try {
      setTask(await cancelTask());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 失败后接着跑，已完成阶段命中缓存 */
  async function onRetry() {
    setBusy(true);
    setError("");
    try {
      setTask(await retryTask());
      setFollowing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 后端单任务，未结束会挡住新任务；false 表示取消失败 */
  async function discardUnfinished(): Promise<boolean> {
    // 前端状态可能滞后，以服务端为准
    const current = task ?? (await getTask().catch(() => null));
    const status = current?.status;
    if (
      status !== "running" &&
      status !== "awaiting_script" &&
      status !== "awaiting_material" &&
      status !== "awaiting_cards"
    ) {
      return true;
    }
    try {
      await cancelTask();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** 清空当前任务回到第一步，后端任务一并取消 */
  async function onRestart() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setError("");
    // 忽略取消操作推回的旧快照
    ignoreTaskRef.current = true;
    setBusy(true);
    const ok = await discardUnfinished();
    setBusy(false);
    restartingRef.current = false;
    if (!ok) {
      ignoreTaskRef.current = false;
      return;
    }
    setResumed(null);
    setTask(null);
    setEdit(null);
    setMaterialPicks({});
    setFollowing(false);
    setPhase("input");
    setMaxStep(0);
    // 保留参数设置，方便连做同系列
    setForm((prev) => ({ ...prev, content: "" }));
  }

  // 主进程回调，走 ref 才拿得到最新的 onRestart
  const newTaskRef = useRef(onRestart);
  useEffect(() => {
    newTaskRef.current = onRestart;
  });
  useEffect(() => {
    const hook = bridge()?.onNewTask;
    if (!hook) return;
    return hook(() => void newTaskRef.current());
  }, []);

  // 浏览器里没有主进程，退化成开一个独立浏览器窗口
  useEffect(() => {
    const api = bridge();
    if (api) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      window.open("/prompts.html", "aisv-prompts", "width=1040,height=760");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // 切换页面清除报错
  function onSelect(next: Phase) {
    setError("");
    setFollowing(false);
    setPhase(next);
  }

  /** 只切换画面，任务状态与已填内容保持原样 */
  function goBack(target: Phase) {
    setError("");
    setFollowing(false);
    setPhase(target);
  }

  /** 前进恢复自动跟随 */
  function goNext(target: Phase) {
    setError("");
    setFollowing(true);
    setPhase(target);
  }

  /** 删掉一条台词，整段删空时一并去掉该段 */
  function deleteDialogue(paragraphIndex: number, dialogueIndex: number) {
    setEdit((prev) => {
      if (!prev) return prev;
      const paragraphs = prev.paragraphs
        .map((paragraph, pi) =>
          pi !== paragraphIndex
            ? paragraph
            : { ...paragraph, dialogues: paragraph.dialogues.filter((_, di) => di !== dialogueIndex) },
        )
        .filter((paragraph) => paragraph.dialogues.length > 0);
      return { ...prev, paragraphs };
    });
  }

  function patchDialogue(paragraphIndex: number, dialogueIndex: number, value: string) {
    setEdit((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        paragraphs: prev.paragraphs.map((paragraph, pi) =>
          pi !== paragraphIndex
            ? paragraph
            : {
                ...paragraph,
                dialogues: paragraph.dialogues.map((dialogue, di) =>
                  di !== dialogueIndex ? dialogue : { ...dialogue, content: value },
                ),
              },
        ),
      };
    });
  }

  return (
    <div className="app">
      {/* 浏览器里没有菜单，整条不渲染 */}
      {bridge() && (
        <div className="titlebar">
          <div className="tb-inner">
            <AppMenu onNewTask={() => void onRestart()} />
          </div>
        </div>
      )}

      <div className="app-top">
        <header className="header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <path d="M8 5.2l10.5 6.8L8 18.8z" fill="currentColor" />
              </svg>
            </span>
            <div className="brand-text">
              <h1>{t("app.name")}</h1>
              <span className="brand-sub">{t("app.tagline")}</span>
            </div>
          </div>

          <div className="header-meta">
            {/* 桌面端从「外观」菜单切，浏览器里没有菜单栏，用这个 */}
            {!bridge() && <ThemeToggle />}
            <EnvStatus health={health} />
            {task && <span className={`pill ${STATUS_TONE[task.status]}`}>{t(STATUS_TEXT[task.status])}</span>}
          </div>
        </header>

        <StepBar current={phase} reached={reached} doneThrough={done} onSelect={onSelect} />

        {resumed && (
          <div className="resume-bar">
            <span className="resume-text">
              {t("app.resume", {
                time: new Date(resumed.createdAt).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
                  hour12: false,
                }),
                status: t(STATUS_TEXT[resumed.status]),
                step: t(stepsFor()[indexOf(phase)]?.label ?? "steps.content"),
              })}
            </span>
            <button type="button" className="resume-btn" onClick={onRestart}>
              {t("menu.newTask")}
            </button>
            <button
              type="button"
              className="resume-close"
              onClick={() => setResumed(null)}
              aria-label={t("app.dismiss")}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div className="app-body" ref={bodyRef}>
        {phase === "input" && (
          <InputStep
            form={form}
            onChange={onFormChange}
            canNext={canNext}
            running={running}
            awaiting={awaiting}
            error={error}
            busy={busy}
            /* 有剧本才给「重新生成」 */
            canRegenerate={Boolean(task?.transcript)}
            onRegenerate={() => void onRegenerate()}
            onNext={() => goNext("script")}
          />
        )}

        {phase === "script" && (
          <ScriptStep
            task={task}
            edit={edit}
            meta={meta}
            form={form}
            onFormChange={onFormChange}
            canStart={canStart}
            blockedReason={blockedReason}
            onStart={() => void onStart()}
            onEditChange={setEdit}
            onPatchDialogue={patchDialogue}
            onDeleteDialogue={deleteDialogue}
            busy={busy}
            error={error}
            onNext={() => goNext("render")}
            onRestart={onRestart}
            onRegenerate={onRegenerate}
            onRetry={onRetry}
            onCancel={() => void onCancel()}
            onBack={() => goBack("input")}
          />
        )}

        {phase === "render" && task?.status === "awaiting_script" && (
          <RenderSetupStep
            task={task}
            speakers={speakers}
            form={renderForm}
            engine={renderEngine}
            meta={meta}
            busy={busy}
            error={error}
            onChange={onRenderFormChange}
            onVoiceChange={onVoiceChange}
            onStart={onStartRender}
            onBack={() => goBack("script")}
          />
        )}

        {phase === "render" && task?.status !== "awaiting_script" && (
          <RenderStep
            task={task}
            busy={busy}
            error={error}
            stageIds={RENDER_STAGE_IDS}
            onBack={() => goBack("script")}
            onRestart={onRestart}
            onRetry={onRetry}
            onCancel={() => void onCancel()}
            onNext={() => goNext("material")}
            speakers={speakers}
            voices={renderForm}
            engine={renderEngine}
            meta={meta}
            onFormChange={onRenderFormChange}
            onVoiceChange={onVoiceChange}
            onRegenerate={() => void onRegenerateTts()}
          />
        )}

        {phase === "material" && task && (
          <MaterialStep
            task={task}
            busy={busy}
            error={error}
            picked={materialPicks}
            onPickedChange={setMaterialPicks}
            onConfirm={onConfirmMaterial}
            onMatch={(force) => void onMatchMaterial(force)}
            onRetry={onRetry}
            onCancel={() => void onCancel()}
            onBack={() => goBack("render")}
            meta={meta}
            form={renderForm}
            onFormChange={onRenderFormChange}
            onStateChange={setTask}
            cardPrefs={cardPrefs}
            onCardPrefsChange={(patch) => setCardPrefs((prev) => ({ ...prev, ...patch }))}
            cards={task.cards}
            cardDefaults={meta?.cardDefaults}
          />
        )}

        {phase === "result" &&
          (task?.status === "completed" ||
          task?.status === "material_ready" ||
          task?.status === "cards_ready" ||
          !task ? (
            <ResultStep
              task={task}
              busy={busy}
              error={error}
              meta={meta}
              onBack={() => goBack("material")}
              onRestart={onRestart}
              onRender={(patch) => void onRender(patch)}
              onPickMusic={bridge()?.pickMusic ? onPickMusic : undefined}
              onReveal={bridge()?.revealFile ? (file) => void onReveal(file) : undefined}
            />
          ) : (
            <RenderStep
              task={task}
              busy={busy}
              error={error}
              stageIds={COMPOSE_STAGE_IDS}
              onBack={() => goBack("material")}
              onRestart={onRestart}
              onRetry={onRetry}
              onCancel={() => void onCancel()}
              onNext={() => goNext("material")}
              title={t("app.composeTitle")}
              desc={t("tts.running")}
            />
          ))}
      </div>

      <StatusBar health={health} task={task} />
    </div>
  );
}
