import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  confirmMaterial,
  confirmScript,
  getHealth,
  matchMaterial,
  retryTask,
  getMeta,
  getTask,
  regenerateScript,
  renderVideo,
  startGenerate,
  subscribeTask,
  type RenderPatch,
} from "./api";
import { bridge } from "./bridge";
import {
  COMPOSE_STAGE_IDS,
  derivePhase,
  reachedIndex,
  RENDER_STAGE_IDS,
  STEP_INDEX,
  type Phase,
} from "./phases";
import { AppMenu } from "./components/AppMenu";
import { StepBar } from "./components/StepBar";
import {
  InputStep,
  MaterialStep,
  RenderSetupStep,
  RenderStep,
  ResultStep,
  ScriptStep,
  type FormState,
  type RenderFormState,
} from "./components/steps";
import type { Health, MaterialInfo, Meta, RawTranscript, TaskState, Transcript } from "./types";

const STATUS_TEXT: Record<TaskState["status"], string> = {
  idle: "空闲",
  running: "生成中",
  awaiting_script: "等待确认剧本",
  script_confirmed: "剧本已确认",
  tts_ready: "配音完成",
  material_ready: "素材就绪",
  awaiting_material: "等待确认素材",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/** 状态药丸配色：进行中=蓝，完成=绿，失败=红 */
const STATUS_TONE: Record<TaskState["status"], string> = {
  idle: "",
  running: "info",
  awaiting_script: "info",
  script_confirmed: "info",
  tts_ready: "info",
  material_ready: "info",
  awaiting_material: "info",
  completed: "ok",
  failed: "bad",
  cancelled: "bad",
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

/** 剧本里出现过的角色，按首次出场顺序去重 */
function speakersOf(raw: RawTranscript | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const paragraph of raw.paragraphs) {
    for (const dialogue of paragraph.dialogues) seen.add(dialogue.speaker);
  }
  return [...seen];
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [following, setFollowing] = useState(true);
  const [edit, setEdit] = useState<RawTranscript | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>({
    content: "",
    promptSource: "",
    speakerMain: "",
    speakerGuest: "",
  });
  const [renderForm, setRenderForm] = useState<RenderFormState>({
    ttsEngine: "",
    ttsSpeed: 0,
    materialSource: "",
    resolution: "",
    voices: {},
  });
  // 素材确认页手动换过的片段：放在这里，来回切步骤不会丢
  const [materialPicks, setMaterialPicks] = useState<Record<number, MaterialInfo>>({});
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, m, t] = await Promise.all([getHealth(), getMeta(), getTask()]);
        if (!alive) return;
        setHealth(h);
        setMeta(m);
        setTask(t);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => subscribeTask(setTask), []);

  // 桌面端把页头当标题栏用，需要给系统窗口按钮预留位置
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    document.body.classList.add("electron");
    if (api.platform === "darwin") document.body.classList.add("mac");
  }, []);

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
    setEdit(null);
    setMaterialPicks({});
  }, [task?.id]);

  // 刷新页面/重新打开后任务还在：把任务里已有的素材来源与分辨率回填到表单，
  // 否则素材页会显示成默认值
  useEffect(() => {
    if (!task) return;
    const { width, height, materialSource, ttsEngine, ttsSpeed } = task.options;
    setRenderForm((prev) => ({
      ...prev,
      ttsEngine: prev.ttsEngine || ttsEngine,
      ttsSpeed: prev.ttsSpeed || ttsSpeed,
      materialSource: prev.materialSource || materialSource,
      resolution: prev.resolution || `${width}x${height}`,
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

  // 进入配音设置时按出场顺序轮换分配音色，用户改过的保留
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

  // 只在「向前」推进；用户点步骤条回看时暂停跟随
  useEffect(() => {
    if (!following || !target) return;
    setPhase((prev) => (STEP_INDEX[target] > STEP_INDEX[prev] ? target : prev));
  }, [target, following]);

  // 换步骤时把内容区滚回顶部：否则上一屏滚到的位置会带过去，看起来像还停在同一页
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [phase]);

  const running = task?.status === "running";
  const awaiting = task?.status === "awaiting_script";
  const reached = reachedIndex(task);
  const canStart =
    Boolean(form.content.trim()) &&
    !running &&
    !awaiting &&
    task?.status !== "awaiting_material" &&
    Boolean(health?.config.llm.configured) &&
    !busy;

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
        resolution: renderForm.resolution,
      });
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
      const state = await confirmMaterial(items, renderForm.resolution);
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

  /** 用同一份输入重跑剧本生成，旧剧本（含未保存的修改）会被丢弃；角色名回到「文案脚本」页改 */
  async function onRegenerate() {
    setBusy(true);
    setError("");
    try {
      setTask(
        await regenerateScript({ main: form.speakerMain.trim(), guest: form.speakerGuest.trim() }),
      );
      setFollowing(true);
      setPhase("script");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    setError("");
    try {
      setTask(await cancelTask());
      setFollowing(false);
      setPhase("input");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 素材确认页：触发按台词匹配素材（带上页面里选定的素材来源） */
  async function onMatchMaterial() {
    setBusy(true);
    setError("");
    try {
      setTask(await matchMaterial(renderForm.materialSource));
      setFollowing(true);
      setPhase("material");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 成片预览页点「生成成片 / 重新生成」：按这页的渲染参数跑合成 */
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

  /** 桌面端弹系统选文件框；浏览器里没有桥，按钮不显示，直接填路径 */
  async function onPickMusic(): Promise<string> {
    const pick = bridge()?.pickMusic;
    return pick ? pick() : "";
  }

  /** 桌面端：成片本来就在本地，直接在文件管理器里定位，不是「下载」 */
  async function onReveal(file: string) {
    const reveal = bridge()?.revealFile;
    if (!reveal) return;
    try {
      const res = await reveal(file);
      if (!res.ok) window.alert(res.error ?? "打开文件位置失败");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  /** 失败后接着跑：沿用原工作目录，已完成的阶段会命中缓存 */
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

  function onRestart() {
    setError("");
    setFollowing(false);
    setPhase("input");
  }

  function onSelect(next: Phase) {
    setFollowing(false);
    setPhase(next);
  }

  /** 返回上一步：只换画面，任务状态与各页已填的内容都保持原样 */
  function goBack(target: Phase) {
    setError("");
    setFollowing(false);
    setPhase(target);
  }

  function onFollow() {
    setFollowing(true);
    if (target) setPhase(target);
  }

  /** 删掉某一条台词；整段删空时把这一段也去掉，避免留下空段 */
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
      <div className="titlebar">
        <span className="tb-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13">
            <path d="M8 5.2l10.5 6.8L8 18.8z" fill="currentColor" />
          </svg>
        </span>
        <AppMenu />
      </div>

      {/* 页头与步骤条常驻顶部，只有下面的任务面板滚动 */}
      <div className="app-top">
        <header className="header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <path d="M8 5.2l10.5 6.8L8 18.8z" fill="currentColor" />
              </svg>
            </span>
            <div className="brand-text">
              <h1>AI 短视频生成器</h1>
              <span className="brand-sub">链接 → 剧本 → 配音 → 素材 → 成片，全流程自动跑</span>
            </div>
          </div>

          <div className="header-meta">
            {task && <span className={`pill ${STATUS_TONE[task.status]}`}>{STATUS_TEXT[task.status]}</span>}
          </div>
        </header>

        <StepBar
          current={phase}
          reached={reached}
          following={following}
          target={target}
          onSelect={onSelect}
          onFollow={onFollow}
        />
      </div>

      {/* 只有这块滚动，页头与步骤条永远钉在上面 */}
      <div className="app-body" ref={bodyRef}>
        {phase === "input" && (
          <InputStep
            meta={meta}
            health={health}
            form={form}
            onChange={onFormChange}
            canStart={canStart}
            busy={busy}
            running={running}
            awaiting={awaiting}
            error={error}
            onStart={onStart}
            onCancel={onCancel}
          />
        )}

        {phase === "script" && (
          <ScriptStep
            task={task}
            edit={edit}
            onEditChange={setEdit}
            onPatchDialogue={patchDialogue}
            onDeleteDialogue={deleteDialogue}
            busy={busy}
            error={error}
            onNext={() => setPhase("render")}
            onCancel={onCancel}
            onRestart={onRestart}
            onRegenerate={onRegenerate}
            onRetry={onRetry}
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
            onCancel={onCancel}
          />
        )}

        {phase === "render" && task?.status !== "awaiting_script" && (
          <RenderStep
            task={task}
            busy={busy}
            error={error}
            stageIds={RENDER_STAGE_IDS}
            onBack={() => goBack("script")}
            onCancel={onCancel}
            onRestart={onRestart}
            onRetry={onRetry}
            onNext={() => goBack("material")}
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
            onMatch={() => void onMatchMaterial()}
            onRetry={onRetry}
            onBack={() => goBack("render")}
            onCancel={onCancel}
            meta={meta}
            form={renderForm}
            onFormChange={onRenderFormChange}
          />
        )}

        {phase === "result" &&
          (task?.status === "completed" || task?.status === "material_ready" || !task ? (
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
              onCancel={onCancel}
              onRestart={onRestart}
              onRetry={onRetry}
              onNext={() => goBack("material")}
              title="合成视频"
              desc="分段渲染 → 拼接 → 混音，完成后自动切到成片。"
            />
          ))}
      </div>
    </div>
  );
}
