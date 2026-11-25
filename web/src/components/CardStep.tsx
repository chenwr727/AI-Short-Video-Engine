import { useEffect, useState } from "react";
import { cardStillUrl } from "../api";
import { CARD_STAGE_IDS } from "../phases";
import type { CardPrefs, CardSpec, Meta, TaskState } from "../types";
import { CardPlayer } from "./CardPlayer";
import { ConfigSection, Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";

interface CardStepProps {
  task: TaskState;
  busy: boolean;
  error: string;
  meta: Meta | null;
  /** 还没生成时先选好的配色 / 时长随请求带给后端 */
  onGenerate: (prefs: CardPrefs) => void;
  /** 换一批可带上当前时长选择，否则沿用服务端记住的值 */
  onRegenerate: (prefs?: CardPrefs) => void;
  onRewrite: (id: string, mode: "text" | "accent") => void;
  /** 保存成功返回 true；失败由调用方提示，返回 false */
  onUpdate: (id: string, patch: CardDraft) => Promise<boolean>;
  onBatch: (patch: CardPrefs) => void;
  onRemove: (id: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
}

export interface CardDraft {
  title: string;
  label: string;
  accent: string;
  durationSec: number;
  handle: string;
  compositionId: string;
}

const KIND_TEXT: Record<CardSpec["kind"], string> = {
  intro: "片头",
  chapter: "章节",
  outro: "片尾",
  quote: "设计卡",
};

const DURATION_PRESETS = [1.5, 2, 2.5, 3];

/** 后端没返回 maxChapters 时的兜底，与 cards.ts 的 MAX_CHAPTER_CARDS 一致 */
const MAX_CHAPTER_FALLBACK = 6;

/** 允许输入空值或半个数字，失焦或回车才提交，避免每敲一个字符发一次请求 */
function DurationInput({
  id,
  value,
  missing = false,
  disabled,
  onCommit,
}: {
  id: string;
  /** null 表示多张卡取值不一致 */
  value: number | null;
  /** 这份版式里没有这类卡 */
  missing?: boolean;
  disabled?: boolean;
  onCommit: (seconds: number) => void;
}) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);

  // 外部值变了（切换任务、批量应用回写）才覆盖输入框
  useEffect(() => {
    setText(shown);
  }, [shown]);

  function commit() {
    const raw = text.trim();
    // 留空表示不指定，不动原有取值
    if (!raw) {
      setText(shown);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setText(shown);
      return;
    }
    const clamped = Math.min(15, Math.round(parsed * 10) / 10);
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  const placeholder = value === null ? "各卡不同" : missing ? "无此卡" : "0";

  return (
    <input
      id={id}
      className="text-input"
      type="number"
      min={0}
      max={15}
      step={0.5}
      value={text}
      placeholder={placeholder}
      title={
        value === null
          ? "这份版式里几张卡时长不同。填一个数会把这类卡统一成这个时长。"
          : missing
            ? "这份版式里没有这类卡。填一个大于 0 的秒数会新建出来。"
            : "0 表示不出这类卡"
      }
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function draftOf(spec: CardSpec): CardDraft {
  return {
    title: spec.title,
    label: spec.label,
    accent: spec.accent,
    durationSec: spec.durationSec,
    handle: spec.handle ?? "",
    compositionId: spec.compositionId,
  };
}

export function CardStep(props: CardStepProps) {
  const {
    task,
    busy,
    error,
    meta,
    onGenerate,
    onRegenerate,
    onRewrite,
    onUpdate,
    onBatch,
    onRemove,
    onConfirm,
    onRetry,
    onCancel,
    onBack,
  } = props;

  const manifest = task.cards;
  const awaiting = task.status === "awaiting_cards";
  const generating = task.status === "running";
  const failed = task.status === "failed" || task.status === "cancelled";
  // 改完后端会自动回到待确认
  const editable = Boolean(manifest) && (awaiting || task.status === "cards_ready" || task.status === "completed");
  const items = manifest?.items ?? [];

  const stepStage: StepStage = failed ? "failed" : generating ? "running" : manifest ? "ready" : "setup";
  const layout = stepLayout(stepStage, Boolean(manifest));

  /** 全部卡片取值一致时返回该值，用来给批量按钮加选中态 */
  function shared<T>(values: T[]): T | null {
    if (values.length === 0) return null;
    return values.every((value) => value === values[0]) ? (values[0] as T) : null;
  }
  const sharedAccent = shared(items.map((item) => item.accent.toLowerCase()));
  const defaults = meta?.cardDefaults;

  // 还没生成版式时，这几个控件当「生成参数」用：改动只记在本地，点「开始生成版式」一起提交
  const [preset, setPreset] = useState<CardPrefs>({});
  const canPreset = !busy && (editable || (awaiting && !manifest));
  const accentPick = sharedAccent ?? (manifest ? null : (preset.accent ?? task.cardPrefs?.accent ?? null));

  // 缺这类卡时 missing 为真，与「几张卡取值不同」（value 为 null）区分开
  function secOf(
    kind: "intro" | "chapter" | "outro",
    key: "introDurationSec" | "chapterDurationSec" | "outroDurationSec",
    fallback: number | undefined,
  ): { value: number | null; missing: boolean } {
    if (manifest) {
      const own = items.filter((item) => item.kind === kind).map((item) => item.durationSec);
      if (own.length === 0) return { value: 0, missing: true };
      return { value: shared(own), missing: false };
    }
    return { value: preset[key] ?? task.cardPrefs?.[key] ?? fallback ?? 0, missing: false };
  }
  const introPick = secOf("intro", "introDurationSec", defaults?.introSec);
  const chapterPick = secOf("chapter", "chapterDurationSec", defaults?.chapterSec);
  const outroPick = secOf("outro", "outroDurationSec", defaults?.outroSec);
  const paramsSummary = [
    `片头 ${introPick.value ? `${introPick.value}s` : "关"}`,
    `章节 ${chapterPick.value ? `${chapterPick.value}s` : "关"}`,
    `片尾 ${outroPick.value ? `${outroPick.value}s` : "关"}`,
  ].join(" · ");

  function pickAccent(color: string) {
    if (manifest) {
      onBatch({ accent: color });
      return;
    }
    setPreset((prev) => ({ ...prev, accent: color.toLowerCase() }));
  }

  function commitSec(key: keyof CardPrefs, seconds: number) {
    if (manifest) {
      onBatch({ [key]: seconds });
      return;
    }
    setPreset((prev) => ({ ...prev, [key]: seconds }));
  }

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);

  const width = task.options.width;
  const height = task.options.height;
  const fps = task.options.fps || 24;
  const total = task.transcript?.paragraphs.length ?? 1;
  const accents = meta?.cardAccents ?? ["#ff5a3c"];
  const templatesOf = (kind: CardSpec["kind"]) => meta?.cardTemplates?.[kind] ?? [];

  function templateName(spec: CardSpec): string {
    return templatesOf(spec.kind).find((template) => template.id === spec.compositionId)?.name ?? spec.compositionId;
  }

  function switchTemplate(spec: CardSpec) {
    const list = templatesOf(spec.kind);
    if (list.length < 2) return;
    const index = list.findIndex((template) => template.id === spec.compositionId);
    const next = list[(index + 1) % list.length];
    if (!next) return;
    onUpdate(spec.id, { ...draftOf(spec), compositionId: next.id });
  }

  function startEdit(spec: CardSpec) {
    setEditing(spec.id);
    setDraft(draftOf(spec));
  }

  function change(patch: Partial<CardDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save(id: string) {
    if (!draft) return;
    const ok = await onUpdate(id, draft);
    if (!ok) return;
    setEditing(null);
    setDraft(null);
  }

  return (
    <Panel
      title="版式确认"
      desc={
        awaiting && !manifest
          ? "素材已确认。点右下角「开始生成版式」，AI 会按当前配置挑模板并写文案；生成后每张卡都能改文案、时长和配色。"
          : awaiting
            ? "预览就是最终渲染的同一套组件：改标题、时长、配色都会立刻重绘。满意后确认，确认完再合成。"
            : generating
              ? "正在让 AI 设计版式，完成后会在这里逐张列出来。"
              : failed
                ? (task.error ?? "版式生成没成功，可以重试。")
                : editable
                  ? "这份版式已经确认过。改动任意一张卡都会自动回到待确认状态，改完再点「下一步：成片预览」重新合成。"
                  : "版式还没生成，先在上一步把素材确认完。"
      }
      fill
    >
      <ConfigSection title="版式参数" summary={paramsSummary} open={layout.configOpen} resetKey={stepStage}>
        <div className="row row-3">
          <div className="field">
            <label htmlFor="card-intro-sec">
              片头（秒）<span className="hint">0 = 不出片头</span>
            </label>
            <DurationInput
              id="card-intro-sec"
              value={introPick.value}
              missing={introPick.missing}
              disabled={!canPreset}
              onCommit={(seconds) => commitSec("introDurationSec", seconds)}
            />
          </div>

          <div className="field">
            <label htmlFor="card-chapter-sec">
              章节卡（秒）<span className="hint">0 = 不出章节卡</span>
            </label>
            <DurationInput
              id="card-chapter-sec"
              value={chapterPick.value}
              missing={chapterPick.missing}
              disabled={!canPreset}
              onCommit={(seconds) => commitSec("chapterDurationSec", seconds)}
            />
          </div>

          <div className="field">
            <label htmlFor="card-outro-sec">
              片尾（秒）<span className="hint">0 = 不出片尾</span>
            </label>
            <DurationInput
              id="card-outro-sec"
              value={outroPick.value}
              missing={outroPick.missing}
              disabled={!canPreset}
              onCommit={(seconds) => commitSec("outroDurationSec", seconds)}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>统一配色</label>
            <div className="card-swatches">
              {accents.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch${accentPick === color.toLowerCase() ? " on" : ""}`}
                  style={{ background: color }}
                  title={manifest ? `全部卡片用 ${color}` : `生成时用 ${color}`}
                  aria-label={color}
                  aria-pressed={accentPick === color.toLowerCase()}
                  disabled={!canPreset}
                  onClick={() => pickAccent(color)}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="hint">
          {manifest
            ? `时长改的是现有卡片，留空表示各卡取值不一。章节卡最多 ${Math.min(
                defaults?.maxChapters ?? MAX_CHAPTER_FALLBACK,
                total - 1,
              )} 张；只想改一张，用卡片上的「编辑」。`
            : `这里是这次任务的参数，初值来自设置页${
                defaults?.auto ? "（三个卡片开关都没开，按这些时长出一份默认清单）" : ""
              }。想长期改，去设置页；改这里只影响这一条任务。`}
        </p>
      </ConfigSection>

      <div className="panel-scroll">
        <StageList stages={task.stages.filter((stage) => CARD_STAGE_IDS.includes(stage.id))} />

        <LogPanel
          logs={task.logs}
          stages={CARD_STAGE_IDS}
          collapsible
          expanded={layout.logOpen}
          tall={layout.logOpen}
        />

        {!manifest && stepStage === "setup" && <p className="hint">版式还没生成：点右下角「开始生成版式」。</p>}

        {manifest && items.length === 0 && (
          <p className="hint">卡片都删了：成片只保留正文段落。可以点「换一批」再要一版。</p>
        )}

        {layout.showResult && items.length > 0 && (
          <div className="card-list">
            {items.map((item) => {
              const live = editing === item.id && draft ? { ...item, ...draft } : item;
              return (
                <div className="card-block" key={item.id}>
                  <div className="card-media">
                    {/* 播放器没量到尺寸时垫底，避免整块黑 */}
                    <img
                      className="card-poster"
                      src={cardStillUrl(item.id, item.fingerprint)}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                    <CardPlayer
                      spec={live}
                      width={width}
                      height={height}
                      fps={fps}
                      total={total}
                      durationSec={live.durationSec}
                    />
                  </div>

                  <div className="card-info">
                    <div className="card-head">
                      <span className="pill info">{KIND_TEXT[item.kind]}</span>
                      {item.paragraph && <span className="card-para">第 {item.paragraph} 段</span>}
                      <span className="card-para">{templateName(live)}</span>
                      <span className="card-time">{live.durationSec}s</span>
                      <span className="card-accent" style={{ background: live.accent }} title={live.accent} />
                    </div>

                    {editing === item.id && draft ? (
                      <div className="card-form">
                        <div className="field">
                          <label htmlFor={`card-title-${item.id}`}>
                            标题（{Array.from(draft.title).length}/{item.kind === "chapter" ? 12 : 14}）
                          </label>
                          <input
                            id={`card-title-${item.id}`}
                            value={draft.title}
                            maxLength={item.kind === "chapter" ? 12 : 14}
                            onChange={(event) => change({ title: event.target.value })}
                          />
                        </div>

                        <div className="row">
                          <div className="field">
                            <label htmlFor={`card-label-${item.id}`}>角标</label>
                            <input
                              id={`card-label-${item.id}`}
                              value={draft.label}
                              maxLength={10}
                              onChange={(event) => change({ label: event.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`card-duration-${item.id}`}>时长（秒）</label>
                            <input
                              id={`card-duration-${item.id}`}
                              type="number"
                              min={0.5}
                              max={15}
                              step={0.5}
                              value={draft.durationSec}
                              onChange={(event) => change({ durationSec: Number(event.target.value) })}
                            />
                          </div>
                        </div>

                        <div className="card-presets">
                          {DURATION_PRESETS.map((seconds) => (
                            <button
                              key={seconds}
                              type="button"
                              className={`chip${draft.durationSec === seconds ? " on" : ""}`}
                              onClick={() => change({ durationSec: seconds })}
                            >
                              {seconds}s
                            </button>
                          ))}
                        </div>

                        <div className="field">
                          <label>配色</label>
                          <div className="card-swatches">
                            {accents.map((color) => (
                              <button
                                key={color}
                                type="button"
                                className={`swatch${draft.accent.toLowerCase() === color.toLowerCase() ? " on" : ""}`}
                                style={{ background: color }}
                                title={color}
                                aria-label={color}
                                onClick={() => change({ accent: color })}
                              />
                            ))}
                          </div>
                        </div>

                        {item.kind === "outro" && (
                          <div className="field">
                            <label htmlFor={`card-handle-${item.id}`}>账号</label>
                            <input
                              id={`card-handle-${item.id}`}
                              value={draft.handle}
                              maxLength={24}
                              onChange={(event) => change({ handle: event.target.value })}
                            />
                          </div>
                        )}

                        <div className="card-actions">
                          <button className="primary" type="button" disabled={busy} onClick={() => void save(item.id)}>
                            保存
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditing(null);
                              setDraft(null);
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="card-title">{live.title}</div>
                        {live.handle && <div className="card-handle">{live.handle}</div>}
                        {editable && (
                          <div className="card-actions">
                            <button className="secondary" type="button" disabled={busy} onClick={() => startEdit(item)}>
                              编辑
                            </button>
                            {templatesOf(item.kind).length > 1 && (
                              <button
                                className="secondary"
                                type="button"
                                disabled={busy}
                                onClick={() => switchTemplate(item)}
                                title="在同一卡片类型的模板之间切换"
                              >
                                换模板
                              </button>
                            )}
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => onRewrite(item.id, "text")}
                              title="让 AI 重写这张卡的文案"
                            >
                              换文案
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => onRewrite(item.id, "accent")}
                            >
                              换配色
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => onRemove(item.id)}
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {layout.showResult && manifest?.style && <p className="hint">风格：{manifest.style}</p>}

        {failed && (
          <div className="alert">
            {task.error ?? (task.status === "cancelled" ? "已停止，可以点「继续」接着生成。" : "生成版式失败")}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        {generating && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            停止生成
          </button>
        )}
        {editable && !generating && (
          <button className="secondary" type="button" disabled={busy} onClick={() => onRegenerate(preset)}>
            换一批（重新生成）
          </button>
        )}
        {awaiting && !manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onGenerate(preset)}>
            开始生成版式
          </button>
        )}
        {awaiting && manifest && (
          <button className="primary" type="button" disabled={busy} onClick={onConfirm}>
            下一步：成片预览
          </button>
        )}
        {failed && (
          <button className="primary" type="button" disabled={busy} onClick={onRetry}>
            重试失败步骤
          </button>
        )}
      </div>
    </Panel>
  );
}
