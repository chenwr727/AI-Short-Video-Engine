import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { materialPreviewUrl, searchMaterial, type RenderPatch } from "../api";
import { MATERIAL_STAGE_IDS, RENDER_STAGE_IDS, SCRIPT_STAGE_IDS } from "../phases";
import type {
  AudioManifest,
  Health,
  MaterialInfo,
  MaterialItem,
  Meta,
  RawTranscript,
  TaskState,
  TtsEngineOption,
} from "../types";
import { LogPanel, StageList } from "./StageList";

/** 第一步：只负责内容与脚本风格 */
export interface FormState {
  content: string;
  promptSource: string;
  /** 剧本里的两个角色名，默认值来自配置项，这里可临时改 */
  speakerMain: string;
  speakerGuest: string;
}

/** 第三步：配音引擎、语速、角色音色；素材与分辨率在第四步选 */
export interface RenderFormState {
  ttsEngine: string;
  /** 配音语速，1 = 原速 */
  ttsSpeed: number;
  materialSource: string;
  resolution: string;
  voices: Record<string, string>;
}

/** 常用语速档位；配置里填了别的值会临时插进来 */
const SPEED_OPTIONS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];

function Panel({
  title,
  desc,
  aside,
  children,
}: {
  title: string;
  desc?: string;
  /** 标题右侧的附属信息（如环境状态） */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card step-panel">
      <div className="panel-head">
        <div className="panel-head-text">
          <h2>{title}</h2>
          {desc && <p className="hint">{desc}</p>}
        </div>
        {aside && <div className="panel-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function DepBadges({ health }: { health: Health }) {
  return (
    <div className="dep-badges">
      <span className="badge">
        <span className={health.deps.ffmpeg ? "dot ok" : "dot"} />
        ffmpeg
      </span>
      <span className="badge">
        <span className={health.config.llm.configured ? "dot ok" : "dot"} />
        LLM
      </span>
      <span className="badge">
        <span className={health.config.tts.edge ? "dot ok" : "dot"} />
        Edge 语音
      </span>
      <span className="badge">
        <span className={health.config.tts.dashscope ? "dot ok" : "dot"} />
        DashScope
      </span>
      <span className="badge">
        <span className={health.config.tts.seed ? "dot ok" : "dot"} />
        豆包
      </span>
    </div>
  );
}

interface InputStepProps {
  meta: Meta | null;
  health: Health | null;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  canStart: boolean;
  busy: boolean;
  running: boolean;
  awaiting: boolean;
  error: string;
  onStart: () => void;
  onCancel: () => void;
}

export function InputStep(props: InputStepProps) {
  const { meta, health, form, onChange, canStart, busy, running, awaiting, error, onStart, onCancel } = props;
  const soloStyle = (meta?.promptSources.find((option) => option.id === form.promptSource)?.speakers ?? 2) < 2;

  return (
    <Panel
      title="文案脚本"
      desc="输入网页链接或正文，选定脚本风格，AI 会先生成剧本等你确认。"
      aside={health ? <DepBadges health={health} /> : null}
    >
      <div className="field">
        <label htmlFor="content">内容（网页 URL 或正文）</label>
        <textarea
          id="content"
          value={form.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder="例如：https://36kr.com/p/xxxxx　或直接粘贴文章正文"
          disabled={running || awaiting}
        />
      </div>

      <div className="field">
        <label htmlFor="prompt-source">脚本风格</label>
        <select
          id="prompt-source"
          value={form.promptSource}
          onChange={(event) => onChange({ promptSource: event.target.value })}
          disabled={running || awaiting}
        >
          {meta?.promptSources.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="speaker-main">主讲角色名</label>
          <input
            id="speaker-main"
            className="text-input"
            value={form.speakerMain}
            onChange={(event) => onChange({ speakerMain: event.target.value })}
            placeholder={meta?.speakers.main ?? "小简"}
            maxLength={8}
            disabled={running}
          />
        </div>
        <div className="field">
          <label htmlFor="speaker-guest">追问角色名</label>
          <input
            id="speaker-guest"
            className="text-input"
            value={soloStyle ? "" : form.speakerGuest}
            onChange={(event) => onChange({ speakerGuest: event.target.value })}
            placeholder={soloStyle ? "单人风格不需要" : (meta?.speakers.guest ?? "老陈")}
            maxLength={8}
            disabled={running || soloStyle}
          />
        </div>
      </div>
      <p className="hint">
        {soloStyle
          ? "当前风格是单人讲述，只会用到主讲角色名。"
          : "剧本里的两个角色名，留空则用设置里的默认值。"}
        {awaiting && "改完去「剧本生成」点「重新生成」才会生效。"}
      </p>

      <div className="panel-actions">
        {(running || awaiting) && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消任务
          </button>
        )}
        <button className="primary" type="button" onClick={onStart} disabled={!canStart}>
          {running ? "生成中…" : awaiting ? "请先确认剧本" : "开始生成"}
        </button>
      </div>

      {health && !health.config.llm.configured && (
        <p className="hint">还没配置 LLM API Key：在「文件 → 设置…」（Ctrl+,）里填好并保存即可，后端会自动重启生效。</p>
      )}
      {error && <div className="alert">{error}</div>}
    </Panel>
  );
}

interface ScriptStepProps {
  task: TaskState | null;
  edit: RawTranscript | null;
  onEditChange: (next: RawTranscript) => void;
  onPatchDialogue: (paragraph: number, dialogue: number, value: string) => void;
  onDeleteDialogue: (paragraph: number, dialogue: number) => void;
  busy: boolean;
  error: string;
  onNext: () => void;
  onCancel: () => void;
  onRestart: () => void;
  onRegenerate: () => void;
  /** 失败后接着跑（沿用原工作目录） */
  onRetry: () => void;
  onBack: () => void;
}

export function ScriptStep(props: ScriptStepProps) {
  const {
    task,
    edit,
    onEditChange,
    onPatchDialogue,
    onDeleteDialogue,
    busy,
    error,
    onNext,
    onCancel,
    onRestart,
    onRegenerate,
    onRetry,
    onBack,
  } = props;
  const awaiting = task?.status === "awaiting_script" && Boolean(edit);
  const running = task?.status === "running";
  // 只有"写稿这几步"失败才归这一页管；配音/素材失败不该在这里报错
  const failed = Boolean(
    task?.status === "failed" &&
      task.stages.some((stage) => SCRIPT_STAGE_IDS.includes(stage.id) && stage.status === "failed"),
  );
  const stages = task ? task.stages.filter((stage) => SCRIPT_STAGE_IDS.includes(stage.id)) : [];
  // 剧本已确认（后面的步骤在跑或已失败）时，这里给个只读版本，别让这一页空着
  const transcript = awaiting ? null : (task?.transcript ?? null);
  // 全篇至少留一条台词，否则确认时会因为剧本为空而失败
  const dialogueTotal = edit ? edit.paragraphs.reduce((sum, paragraph) => sum + paragraph.dialogues.length, 0) : 0;

  const regenerateButton = task ? (
    <button
      className="secondary"
      type="button"
      onClick={onRegenerate}
      disabled={busy}
      title="丢弃当前剧本，用同样的内容重新生成"
    >
      重新生成
    </button>
  ) : null;

  return (
    <Panel
      title="剧本生成"
      desc={
        awaiting
          ? "台词可以直接改，用不上的整条可以删掉；点下一步去选配音，确认后才开始合成。"
          : transcript
            ? "剧本已确认并用于配音，这里是当时的版本（只读）。"
            : "AI 正在抓取内容并写剧本，完成后会自动停在这里等确认。"
      }
    >
      <StageList stages={stages} />

      {failed && <div className="alert">{task?.error ?? "剧本生成失败"}</div>}

      {awaiting && edit && (
        <>
          <div className="field">
            <label htmlFor="script-title">标题</label>
            <input
              id="script-title"
              className="text-input"
              value={edit.title}
              onChange={(event) => onEditChange({ ...edit, title: event.target.value })}
            />
          </div>

          {edit.paragraphs.map((paragraph, paragraphIndex) => (
            <div className="paragraph" key={paragraphIndex}>
              <div className="paragraph-head">
                第 {paragraphIndex + 1} 段
                {paragraph.description && <span className="paragraph-desc">{paragraph.description}</span>}
              </div>
              {paragraph.dialogues.map((dialogue, dialogueIndex) => (
                <div className="dialogue" key={dialogueIndex}>
                  <span className="speaker">{dialogue.speaker}</span>
                  <textarea
                    value={dialogue.content}
                    onChange={(event) => onPatchDialogue(paragraphIndex, dialogueIndex, event.target.value)}
                    rows={2}
                  />
                  <button
                    className="line-del"
                    type="button"
                    title={dialogueTotal > 1 ? "删除这条台词" : "剧本至少要留一条台词"}
                    aria-label="删除这条台词"
                    disabled={dialogueTotal <= 1}
                    onClick={() => onDeleteDialogue(paragraphIndex, dialogueIndex)}
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {transcript && (
        <div className="script-readonly">
          {transcript.title && <p className="script-title">{transcript.title}</p>}
          {transcript.paragraphs.map((paragraph, paragraphIndex) => (
            <div className="paragraph" key={paragraphIndex}>
              <div className="paragraph-head">
                第 {paragraphIndex + 1} 段
                {paragraph.description && <span className="paragraph-desc">{paragraph.description}</span>}
              </div>
              {paragraph.dialogues.map((dialogue, dialogueIndex) => (
                <div className="dialogue-readonly" key={dialogueIndex}>
                  <span className="speaker">{dialogue.speaker}</span>
                  <p>{dialogue.contents.join("")}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {task && !awaiting && <LogPanel logs={task.logs} tall stages={SCRIPT_STAGE_IDS} />}

      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        {awaiting ? (
          <>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              返回上一步
            </button>
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              丢弃并取消
            </button>
            {/* 主操作固定在最右，和「返回上一步」靠左的布局约定一致 */}
            <button className="primary" type="button" onClick={onNext} disabled={busy}>
              下一步：配音设置
            </button>
          </>
        ) : failed ? (
          <>
            <button className="secondary" type="button" onClick={onRestart}>
              返回修改文案
            </button>
            {regenerateButton}
            <button className="primary" type="button" onClick={onRetry} disabled={busy}>
              重试失败步骤
            </button>
          </>
        ) : running ? (
          <>
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              取消任务
            </button>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              返回上一步
            </button>
          </>
        ) : (
          <>
            {regenerateButton}
            {task && (
              <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
                返回上一步
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

interface RenderSetupStepProps {
  task: TaskState;
  speakers: string[];
  form: RenderFormState;
  engine: TtsEngineOption | undefined;
  meta: Meta | null;
  busy: boolean;
  error: string;
  onChange: (patch: Partial<RenderFormState>) => void;
  onVoiceChange: (speaker: string, voice: string) => void;
  onStart: () => void;
  onBack: () => void;
  onCancel: () => void;
}

/** 第三步的前半段：每个角色配一个音色，确认后才真正开始合成 */
export function RenderSetupStep(props: RenderSetupStepProps) {
  const { task, speakers, form, engine, meta, busy, error, onChange, onVoiceChange, onStart, onBack, onCancel } = props;

  // 配置里的语速不在常用档位时，临时插一项，别让下拉显示空
  const speedOptions =
    form.ttsSpeed > 0 && !SPEED_OPTIONS.includes(form.ttsSpeed)
      ? [...SPEED_OPTIONS, form.ttsSpeed].sort((a, b) => a - b)
      : SPEED_OPTIONS;

  return (
    <Panel title="配音设置" desc="按角色选择音色；确认后开始配音、找素材并合成成片。">
      <div className="voice-list">
        {speakers.length === 0 && <p className="hint">剧本里还没有角色。</p>}
        {speakers.map((speaker) => (
          <div className="voice-row" key={speaker}>
            <span className="speaker">{speaker}</span>
            <select value={form.voices[speaker] ?? ""} onChange={(event) => onVoiceChange(speaker, event.target.value)}>
              {engine?.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="tts-engine">配音引擎</label>
          <select
            id="tts-engine"
            value={form.ttsEngine}
            onChange={(event) => onChange({ ttsEngine: event.target.value })}
          >
            {meta?.ttsEngines.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="tts-speed">语速</label>
          <select
            id="tts-speed"
            value={String(form.ttsSpeed)}
            onChange={(event) => onChange({ ttsSpeed: Number(event.target.value) })}
          >
            {speedOptions.map((speed) => (
              <option key={speed} value={speed}>
                {speed === 1 ? "1.0 倍速（原速）" : `${speed.toFixed(1)} 倍速`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="hint">素材来源与分辨率在下一步「素材确认」里选。</p>

      <div className="kv">
        <span className="k">剧本</span>
        <span className="v">
          {editSummary(task)} · {speakers.length} 个角色
        </span>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
          取消任务
        </button>
        <button className="primary" type="button" onClick={onStart} disabled={busy || speakers.length === 0}>
          开始配音
        </button>
      </div>
    </Panel>
  );
}

function editSummary(task: TaskState): string {
  const transcript = task.transcript;
  if (!transcript) return "未生成";
  return `${transcript.title || "未命名"} · ${transcript.paragraphs.length} 段`;
}

interface MaterialStepProps {
  task: TaskState;
  busy: boolean;
  error: string;
  /** 手动换过的素材：放在上层，来回切步骤不会丢 */
  picked: Record<number, MaterialInfo>;
  onPickedChange: (next: Record<number, MaterialInfo>) => void;
  onConfirm: (items: (MaterialInfo & { paragraph: number })[]) => void;
  /** 素材还没匹配时，用这个触发匹配 */
  onMatch: () => void;
  /** 匹配失败后接着跑 */
  onRetry: () => void;
  onBack: () => void;
  onCancel: () => void;
  meta: Meta | null;
  /** 素材来源与分辨率：跟着素材页选，合成时生效 */
  form: RenderFormState;
  onFormChange: (patch: Partial<RenderFormState>) => void;
}

/** 第四步：先选来源与分辨率、匹配素材，再逐段预览，确认后才真正合成 */
export function MaterialStep(props: MaterialStepProps) {
  const {
    task,
    busy,
    error,
    picked,
    onPickedChange,
    onConfirm,
    onMatch,
    onRetry,
    onBack,
    onCancel,
    meta,
    form,
    onFormChange,
  } = props;
  const manifest = task.material;
  // material_ready：成片还没生成，回来改素材或分辨率仍然允许
  const awaiting = task.status === "awaiting_material" || task.status === "material_ready";
  const matching = task.status === "running";
  // material_ready 时任务已定稿，没有可取消的后台动作
  const canCancel = task.status === "awaiting_material" || matching;
  const failed = task.status === "failed" || task.status === "cancelled";

  const [panel, setPanel] = useState<{ paragraph: number; list: MaterialInfo[] } | null>(null);
  const [searching, setSearching] = useState(0);
  const [note, setNote] = useState("");

  const replacements = Object.entries(picked).map(([paragraph, candidate]) => ({
    ...candidate,
    paragraph: Number(paragraph),
  }));

  async function findMore(item: MaterialItem) {
    setSearching(item.paragraph);
    setNote("");
    try {
      const list = await searchMaterial(item.paragraph, item.searchTerms);
      setPanel({ paragraph: item.paragraph, list });
      if (list.length === 0) setNote(`第 ${item.paragraph} 段没有检索到新的候选素材。`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(0);
    }
  }

  function pick(item: MaterialItem, candidate: MaterialInfo) {
    onPickedChange({ ...picked, [item.paragraph]: candidate });
    setPanel(null);
    setNote(`第 ${item.paragraph} 段已选好新素材，点「下一步：成片预览」后生效。`);
  }

  function undo(paragraph: number) {
    const next = { ...picked };
    delete next[paragraph];
    onPickedChange(next);
  }

  return (
    <Panel
      title="素材确认"
      desc={
        manifest
          ? "每段都配好视频了：点开看看，不满意就换一个；确认后去「成片预览」设字幕与 BGM 再生成。"
          : awaiting
            ? "配音已完成，点「开始匹配素材」，AI 会按每段台词找可用的视频素材。"
            : matching
              ? "正在按台词检索并下载素材，完成后会在这里逐段列出来。"
              : "这是本片用到的素材片段，任务已定稿。"
      }
    >
      <StageList stages={task.stages.filter((stage) => MATERIAL_STAGE_IDS.includes(stage.id))} />

      <div className="row">
        <div className="field">
          <label htmlFor="material-source">素材来源</label>
          <select
            id="material-source"
            value={form.materialSource}
            onChange={(event) => onFormChange({ materialSource: event.target.value })}
            disabled={!awaiting || busy || matching || Boolean(manifest)}
          >
            {meta?.materialSources.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="resolution">分辨率</label>
          <select
            id="resolution"
            value={form.resolution}
            onChange={(event) => onFormChange({ resolution: event.target.value })}
            disabled={!awaiting || busy || matching}
          >
            {meta?.resolutions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hint">
        {manifest
          ? "素材来源在匹配时就定了；分辨率会用在这次合成上。"
          : "素材来源决定从哪个站检索；分辨率决定成片尺寸。"}
      </p>

      {manifest ? (
        <div className="material-list">
          {manifest.items.map((item) => {
            const candidate = picked[item.paragraph];
            const preview = candidate ? candidate.url : materialPreviewUrl(item.paragraph, item.url);
            const info = candidate ?? item;
            return (
              <div className="material-block" key={item.paragraph}>
                <div className="material-card">
                  <video className="material-video" src={preview} controls preload="metadata" playsInline />
                  <div className="material-info">
                    <div className="material-title">
                      第 {item.paragraph} 段
                      {candidate && <span className="pill info">待替换</span>}
                    </div>
                    <div className="material-tags">{info.tags || `#${info.id}`}</div>
                    <div className="material-meta">
                      {info.duration}s · {info.width}×{info.height} · {manifest.source}
                    </div>
                    {awaiting && (
                      <div className="material-actions">
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || searching === item.paragraph}
                          onClick={() => void findMore(item)}
                        >
                          {searching === item.paragraph ? "检索中…" : "换一个"}
                        </button>
                        {candidate && (
                          <button className="secondary" type="button" disabled={busy} onClick={() => undo(item.paragraph)}>
                            撤销
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {panel?.paragraph === item.paragraph && panel.list.length > 0 && (
                  <div className="candidates">
                    {panel.list.map((entry) => (
                      <button
                        className="candidate"
                        type="button"
                        key={entry.url}
                        disabled={busy}
                        onClick={() => pick(item, entry)}
                        title={entry.tags || `#${entry.id}`}
                      >
                        {entry.imageUrl ? (
                          <img src={entry.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="candidate-empty" />
                        )}
                        <span className="candidate-meta">
                          {entry.duration}s · {entry.width}×{entry.height}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">
          {matching ? "正在匹配素材，进度见上面的阶段列表。" : "素材还没匹配出来。"}
        </p>
      )}

      <LogPanel logs={task.logs} tall stages={MATERIAL_STAGE_IDS} />

      {note && <p className="hint">{note}</p>}
      {failed && (
        <div className="alert">
          {task.error ?? (task.status === "cancelled" ? "任务已取消" : "匹配素材失败")}
        </div>
      )}
      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        {(awaiting || matching || failed) && (
          <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
            返回上一步
          </button>
        )}
        {!awaiting && !matching && !failed && (
          <button className="secondary btn-back" type="button" onClick={onBack}>
            返回上一步
          </button>
        )}
        {canCancel && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消任务
          </button>
        )}
        {/* 主操作固定在最右 */}
        {awaiting && !manifest && (
          <button className="primary" type="button" disabled={busy} onClick={onMatch}>
            开始匹配素材
          </button>
        )}
        {awaiting && manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onConfirm(replacements)}>
            {replacements.length > 0 ? `下一步：成片预览（已换 ${replacements.length} 段）` : "下一步：成片预览"}
          </button>
        )}
        {failed && !manifest && task.status === "failed" && (
          <button className="primary" type="button" disabled={busy} onClick={onRetry}>
            重试失败步骤
          </button>
        )}
      </div>
    </Panel>
  );
}

interface RenderStepProps {
  task: TaskState | null;
  busy: boolean;
  error: string;
  /** 这一页要展示的阶段：阶段列表、日志、摘要都按它过滤 */
  stageIds?: string[];
  onBack: () => void;
  onCancel: () => void;
  onRestart: () => void;
  /** 失败后接着跑（沿用原工作目录，已完成阶段命中缓存） */
  onRetry: () => void;
  /** 切到第四步（素材确认），不会自动开始匹配 */
  onNext: () => void;
  title?: string;
  desc?: string;
}

/** 配音试听：整段顺序播放，也可以单句试听 */
function AudioBoard({ manifest }: { manifest: AudioManifest }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onEnded = () => {
      const next = queueRef.current.shift();
      if (!next) {
        setPlayingKey(null);
        return;
      }
      el.src = `/api/audio/${encodeURIComponent(next)}`;
      void el.play().catch(() => setPlayingKey(null));
    };

    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, []);

  function play(files: string[], key: string) {
    const el = audioRef.current;
    if (!el || files.length === 0) return;
    queueRef.current = files.slice(1);
    el.src = `/api/audio/${encodeURIComponent(files[0] as string)}`;
    setPlayingKey(key);
    void el.play().catch(() => setPlayingKey(null));
  }

  function stop() {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    queueRef.current = [];
    setPlayingKey(null);
  }

  return (
    <div className="audio-board">
      <audio ref={audioRef} preload="none" hidden />
      <div className="audio-board-head">
        <span>
          配音总时长 {manifest.totalDuration.toFixed(1)}s · {manifest.paragraphs.length} 段 · {manifest.model}
        </span>
        {playingKey && (
          <button className="play-btn" type="button" onClick={stop}>
            全部停止
          </button>
        )}
      </div>

      {manifest.paragraphs.map((paragraph) => {
        const lines = paragraph.dialogues.flatMap((dialogue) =>
          dialogue.files.map((file) => ({ ...file, speaker: dialogue.speaker })),
        );
        const key = `p${paragraph.index}`;

        return (
          <details className="audio-para" key={paragraph.index}>
            <summary>
              <span className="audio-para-title">第 {paragraph.index} 段</span>
              <span className="audio-para-meta">
                {paragraph.duration.toFixed(1)}s · {lines.length} 句
              </span>
              <button
                className="play-btn"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  if (playingKey === key) stop();
                  else play(lines.map((line) => line.file), key);
                }}
              >
                {playingKey === key ? "停止" : "播放整段"}
              </button>
            </summary>
            <div className="audio-lines">
              {lines.map((line) => (
                <div className="audio-line" key={line.file}>
                  <span className="speaker">{line.speaker}</span>
                  <span className="audio-text">{line.text}</span>
                  <span className="audio-dur">{line.duration.toFixed(1)}s</span>
                  <button
                    className="play-btn"
                    type="button"
                    onClick={() => (playingKey === line.file ? stop() : play([line.file], line.file))}
                  >
                    {playingKey === line.file ? "停止" : "试听"}
                  </button>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function RenderStep(props: RenderStepProps) {
  const { task, busy, error, onBack, onCancel, onRestart, onRetry, onNext } = props;
  const stageIds = props.stageIds ?? RENDER_STAGE_IDS;
  const title = props.title ?? "配音生成";
  const desc = props.desc ?? "逐句合成配音，中间产物都会落盘，命中缓存会直接复用。";

  if (!task) {
    return (
      <Panel title={title} desc="还没有任务，请先回到第一步生成剧本。">
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            返回第一步
          </button>
        </div>
      </Panel>
    );
  }

  const failed = task.status === "failed" || task.status === "cancelled";
  const running = task.status === "running";
  // 每个页面只展示属于自己的阶段，其他步骤的过程不在这里重复
  const stages = task.stages.filter((stage) => stageIds.includes(stage.id));
  const showAudio = stageIds.includes("tts");
  const showMaterial = stageIds.includes("material");

  return (
    <Panel title={title} desc={desc}>
      <StageList stages={stages} />

      {showAudio && task.audio && <AudioBoard manifest={task.audio} />}

      {showMaterial && task.material && (
        <div className="audio-summary">
          <div className="kv">
            <span className="k">素材来源</span>
            <span className="v">
              {task.material.source} · {task.material.items.length} 段
            </span>
          </div>
          {task.material.items.map((item) => (
            <div className="kv" key={item.paragraph}>
              <span className="k">第 {item.paragraph} 段</span>
              <span className="v">
                {item.tags || `#${item.id}`} · {item.duration}s · {item.width}×{item.height}
              </span>
            </div>
          ))}
        </div>
      )}

      <LogPanel logs={task.logs} tall stages={stageIds} />

      <div className="kv">
        <span className="k">工作目录</span>
        <span className="v">{task.workspace}</span>
      </div>

      {failed && (
        <div className="alert">{task.error ?? (task.status === "cancelled" ? "任务已取消" : "合成失败")}</div>
      )}
      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        {running && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消任务
          </button>
        )}
        {failed && (
          <button
            className={task.status === "failed" ? "secondary" : "primary"}
            type="button"
            onClick={onRestart}
            disabled={busy}
          >
            重新开始
          </button>
        )}
        {/* 主操作固定在最右 */}
        {failed && task.status === "failed" && (
          <button className="primary" type="button" onClick={onRetry} disabled={busy}>
            重试失败步骤
          </button>
        )}
        {/* 只切到素材页，匹配要等那边选好来源再点「开始匹配素材」 */}
        {showAudio && !task.material && task.status === "awaiting_material" && (
          <button className="primary" type="button" onClick={onNext} disabled={busy}>
            下一步：素材确认
          </button>
        )}
        {showAudio && task.material && task.status !== "completed" && (
          <button className="primary" type="button" onClick={onNext} disabled={busy}>
            下一步：素材确认
          </button>
        )}
      </div>
    </Panel>
  );
}

interface ResultStepProps {
  task: TaskState | null;
  busy: boolean;
  error: string;
  meta: Meta | null;
  /** 按当前渲染参数生成/重新生成成片 */
  onRender: (patch: RenderPatch) => void;
  onBack: () => void;
  onRestart: () => void;
  /** 桌面端选本地音乐文件；浏览器里没有，按钮不显示 */
  onPickMusic?: () => Promise<string>;
  /** 桌面端在文件管理器里定位成片；没有就走浏览器下载 */
  onReveal?: (file: string) => void;
}

/** 第五步：先定渲染参数再生成；生成后还能改参数重新生成 */
export function ResultStep(props: ResultStepProps) {
  const { task, busy, error, meta, onRender, onBack, onRestart, onPickMusic, onReveal } = props;
  const options = task?.options;
  const defaults = meta?.render;
  const hasVideo = task?.status === "completed" && Boolean(task.result);
  const rendering = task?.status === "running";

  // 「0 = 自动」只在后端配置里存在，界面上永远显示按画宽算好的具体 px
  const defaultFontSize = defaults?.subtitleFontSize && defaults.subtitleFontSize > 0 ? defaults.subtitleFontSize : 72;
  const shownFontSize = (value?: number) => (value && value > 0 ? value : defaultFontSize);

  const [fontSize, setFontSize] = useState(shownFontSize(options?.subtitleFontSize));
  const [bgmEnabled, setBgmEnabled] = useState(options?.bgmEnabled ?? defaults?.bgmEnabled ?? true);
  const [bgmVolume, setBgmVolume] = useState(options?.bgmVolume ?? defaults?.bgmVolume ?? 0.1);
  const [music, setMusic] = useState(options?.bgmFile ?? "");
  const [picking, setPicking] = useState(false);

  // 任务里已定过参数，或默认值晚到（meta 异步加载）时回填
  useEffect(() => {
    setFontSize(shownFontSize(options?.subtitleFontSize));
    setBgmEnabled(options?.bgmEnabled ?? defaults?.bgmEnabled ?? true);
    setBgmVolume(options?.bgmVolume ?? defaults?.bgmVolume ?? 0.1);
    setMusic(options?.bgmFile ?? "");
  }, [
    options?.subtitleFontSize,
    options?.bgmEnabled,
    options?.bgmVolume,
    options?.bgmFile,
    defaults?.subtitleFontSize,
    defaults?.bgmEnabled,
    defaults?.bgmVolume,
  ]);

  if (!task) {
    return (
      <Panel title="成片预览" desc="成片生成后会出现在这里。">
        <p className="hint">还没有任务，请先生成剧本并完成素材确认。</p>
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            返回第一步
          </button>
        </div>
      </Panel>
    );
  }

  async function pick() {
    if (!onPickMusic) return;
    setPicking(true);
    try {
      const file = await onPickMusic();
      if (file) setMusic(file);
    } finally {
      setPicking(false);
    }
  }

  function render() {
    onRender({
      subtitleFontSize: Math.max(1, Math.min(200, Math.round(Number(fontSize) || defaultFontSize))),
      bgmEnabled,
      bgmVolume: Math.min(2, Math.max(0, Number(bgmVolume) || 0)),
      bgmFile: bgmEnabled ? music.trim() : "",
    });
  }

  return (
    <Panel
      title="成片预览"
      desc={
        hasVideo
          ? "成片已经保存在本地。下面这些参数改完可以重新生成，配音与素材都不用重跑。"
          : "素材已就绪，先设置字幕与背景音乐，再点「生成成片」。"
      }
    >
      {hasVideo ? (
        <video className="player" src="/api/result" controls playsInline />
      ) : (
        <p className="hint">还没有生成成片。</p>
      )}

      {hasVideo && (
        <div className="kv">
          <span className="k">输出文件</span>
          <span className="v">{task.result}</span>
        </div>
      )}
      {task.audio && (
        <div className="kv">
          <span className="k">配音时长</span>
          <span className="v">{task.audio.totalDuration.toFixed(1)} 秒 · {task.audio.model}</span>
        </div>
      )}
      <div className="kv">
        <span className="k">工作目录</span>
        <span className="v">{task.workspace}</span>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="subtitle-size">字幕字号（px）</label>
          <input
            id="subtitle-size"
            className="text-input"
            type="number"
            min={1}
            max={200}
            step={1}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            disabled={rendering || picking}
          />
        </div>
        <div className="field">
          <label htmlFor="bgm-volume">BGM 音量（0–2，默认 0.1）</label>
          <input
            id="bgm-volume"
            className="text-input"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={bgmVolume}
            onChange={(event) => setBgmVolume(Number(event.target.value))}
            disabled={rendering || picking || !bgmEnabled}
          />
        </div>
      </div>

      <div className="field">
        <label className="check" htmlFor="bgm-enabled">
          <input
            id="bgm-enabled"
            type="checkbox"
            checked={bgmEnabled}
            onChange={(event) => setBgmEnabled(event.target.checked)}
            disabled={rendering}
          />
          插入背景音乐（不勾选则只保留配音）
        </label>
      </div>

      {bgmEnabled && (
        <div className="field">
          <label htmlFor="bgm-file">自定义音乐</label>
          <div className="music-picker">
            <input
              id="bgm-file"
              className="text-input"
              value={music}
              onChange={(event) => setMusic(event.target.value)}
              placeholder="留空 = 程序合成的默认 BGM；也可填音乐目录里的文件名"
              disabled={rendering || picking}
            />
            {onPickMusic && (
              <button className="secondary" type="button" onClick={() => void pick()} disabled={rendering || picking}>
                {picking ? "选择中…" : "选择…"}
              </button>
            )}
          </div>
        </div>
      )}
      <p className="hint">
        字幕字号默认按画面宽度算好（{defaultFontSize}px，当前分辨率 {task.options.width}×{task.options.height}），
        可以直接改具体数值。自定义音乐支持 mp3/wav/m4a/aac/ogg/flac。
        改字号会重新渲染分段片段，只改 BGM 则复用片段、仅重跑合并与混音。
      </p>

      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        {/* 主操作固定在最右 */}
        <button className="primary" type="button" onClick={render} disabled={busy || rendering}>
          {busy || rendering ? "合成中…" : hasVideo ? "重新生成" : "生成成片"}
        </button>
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack}>
          返回上一步
        </button>
        <button className="secondary" type="button" onClick={onRestart}>
          再做一条
        </button>
        {hasVideo &&
          (onReveal ? (
            <button className="primary" type="button" onClick={() => onReveal(task.result as string)}>
              在文件夹中显示
            </button>
          ) : (
            <a className="primary link-btn" href="/api/result?download=1">
              下载成片
            </a>
          ))}
      </div>
    </Panel>
  );
}
