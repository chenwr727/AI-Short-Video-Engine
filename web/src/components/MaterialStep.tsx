import { useState } from "react";
import { materialPreviewUrl, searchMaterial } from "../api";
import { MATERIAL_STAGE_IDS } from "../phases";
import type { MaterialInfo, MaterialItem, Meta, TaskState } from "../types";
import { ConfigSection, Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";
import type { RenderFormState } from "./stepTypes";

interface MaterialStepProps {
  task: TaskState;
  busy: boolean;
  error: string;
  /** 手动换过的素材，放在上层以免切步骤丢失 */
  picked: Record<number, MaterialInfo>;
  onPickedChange: (next: Record<number, MaterialInfo>) => void;
  onConfirm: (items: (MaterialInfo & { paragraph: number })[]) => void;
  /** force 表示已匹配过也重来 */
  onMatch: (force?: boolean) => void;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
  meta: Meta | null;
  form: RenderFormState;
  onFormChange: (patch: Partial<RenderFormState>) => void;
  /** 启用版式阶段时，确认按钮指向「版式确认」 */
  nextLabel?: string;
}

/** 第四步：选来源与分辨率 → 匹配素材 → 逐段确认 */
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
    onCancel,
    onBack,
    meta,
    form,
    onFormChange,
    nextLabel,
  } = props;
  const manifest = task.material;
  const awaiting = task.status === "awaiting_material" || task.status === "material_ready";
  const editable = awaiting || task.status === "completed";
  // running 也可能是 compose 在跑
  const materialStage = task.stages.find((stage) => stage.id === "material");
  const matching = task.status === "running" && materialStage?.status === "running";
  const pending = task.status === "running";
  const failed = task.status === "failed" || task.status === "cancelled";
  const cancelled = task.status === "cancelled";
  // 失败或停止且无素材时，允许换来源重来
  const canMatchAgain = failed && !manifest && Boolean(task.audio);

  const stepStage: StepStage = failed
    ? "failed"
    : matching || (pending && !manifest)
      ? "running"
      : manifest
        ? "ready"
        : "setup";
  const layout = stepLayout(stepStage, Boolean(manifest));

  const sourceHint = meta?.materialSources.find((option) => option.id === form.materialSource)?.description;
  const sourceLabel =
    meta?.materialSources.find((option) => option.id === form.materialSource)?.label ?? form.materialSource;
  const resolutionLabel = meta?.resolutions.find((option) => option.id === form.resolution)?.label ?? form.resolution;

  const [panel, setPanel] = useState<{ paragraph: number; list: MaterialInfo[] } | null>(null);
  const [searching, setSearching] = useState(0);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  const replacements = Object.entries(picked).map(([paragraph, candidate]) => ({
    ...candidate,
    paragraph: Number(paragraph),
  }));

  async function findMore(item: MaterialItem) {
    setSearching(item.paragraph);
    setNote(null);
    try {
      const list = await searchMaterial(item.paragraph, item.searchTerms);
      setPanel({ paragraph: item.paragraph, list });
      if (list.length === 0) setNote({ text: `第 ${item.paragraph} 段没有检索到新的候选素材。` });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setSearching(0);
    }
  }

  function pick(item: MaterialItem, candidate: MaterialInfo) {
    onPickedChange({ ...picked, [item.paragraph]: candidate });
    setPanel(null);
    setNote({ text: `第 ${item.paragraph} 段已选好新素材，点「下一步：成片预览」后生效。` });
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
          ? awaiting
            ? "每段都配好视频了：点开看看，不满意就换一个；确认后去「成片预览」设字幕与 BGM 再生成。"
            : "成片已生成，每段用的就是下面的素材。想换素材，点上面的「重新生成」按新来源重做。"
          : matching
            ? "正在按台词检索并下载素材，完成后会在这里逐段列出来。"
            : awaiting
              ? "配音已完成，点「开始匹配素材」，AI 会按每段台词找可用的视频素材。"
              : failed
                ? (task.error ?? "素材匹配没成功，可以换个来源重试。")
                : "配音还没完成，素材匹配会在配音结束后开始。"
      }
      fill
    >
      <ConfigSection title="素材来源与分辨率" summary={`${sourceLabel} · ${resolutionLabel}`} open={layout.configOpen}>
        <div className="row">
          <div className="field">
            <label htmlFor="material-source">素材来源</label>
            <select
              id="material-source"
              value={form.materialSource}
              onChange={(event) => onFormChange({ materialSource: event.target.value })}
              disabled={busy || pending || (!editable && !canMatchAgain)}
            >
              {meta?.materialSources.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {sourceHint && <span className="field-hint">{sourceHint}</span>}
          </div>
          <div className="field">
            <label htmlFor="resolution">分辨率</label>
            <select
              id="resolution"
              value={form.resolution}
              onChange={(event) => onFormChange({ resolution: event.target.value })}
              disabled={busy || pending || (!editable && !canMatchAgain)}
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
            ? "改完上面的来源或分辨率，点「重新生成」会按新设置重做素材；已匹配的素材与成片会一起作废。"
            : canMatchAgain
              ? cancelled
                ? "已停止，之前匹配出来的素材不完整。点「继续」接着补齐没匹配的段落。"
                : "上次匹配没成功。可以换个素材来源或分辨率，再点「用新来源重新匹配」。"
              : "素材来源决定从哪个站检索；分辨率决定成片尺寸。"}
        </p>
      </ConfigSection>

      <div className="panel-scroll">
        <StageList stages={task.stages.filter((stage) => MATERIAL_STAGE_IDS.includes(stage.id))} />

        <LogPanel
          logs={task.logs}
          stages={MATERIAL_STAGE_IDS}
          collapsible
          expanded={layout.logOpen}
          tall={layout.logOpen}
        />

        {layout.showResult && manifest ? (
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
                        第 {item.paragraph} 段{candidate && <span className="pill info">待替换</span>}
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
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => undo(item.paragraph)}
                            >
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
        ) : stepStage === "setup" ? (
          <p className="hint">素材还没匹配出来。</p>
        ) : null}

        {note && <p className={`hint${note.bad ? " hint-warn" : ""}`}>{note.text}</p>}
        {failed && (
          <div className="alert">
            {task.error ??
              (task.status === "cancelled"
                ? "已停止。已下好的素材留在本地，点「继续」只补没完成的段落。"
                : "匹配素材失败")}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        {matching && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            停止匹配
          </button>
        )}
        {(manifest || matching) && !matching && (
          <button className="secondary" type="button" disabled={busy} onClick={() => onMatch(true)}>
            重新生成
          </button>
        )}
        {awaiting && !manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            开始匹配素材
          </button>
        )}
        {awaiting && manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onConfirm(replacements)}>
            {(() => {
              const next = nextLabel ?? "下一步：成片预览";
              return replacements.length > 0 ? `${next}（已换 ${replacements.length} 段）` : next;
            })()}
          </button>
        )}
        {task.status === "completed" && (
          <button className="primary" type="button" disabled={busy} onClick={onBack}>
            返回成片预览
          </button>
        )}

        {/* 停止后按原来源补齐 */}
        {cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={onRetry}>
            继续
          </button>
        )}
        {canMatchAgain && !cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            用新来源重新匹配
          </button>
        )}
        {failed && !manifest && task.status === "failed" && (
          <button className={canMatchAgain ? "secondary" : "primary"} type="button" disabled={busy} onClick={onRetry}>
            重试失败步骤
          </button>
        )}
      </div>
    </Panel>
  );
}
