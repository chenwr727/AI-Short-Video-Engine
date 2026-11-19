import { SCRIPT_STAGE_IDS } from "../phases";
import type { Meta, RawTranscript, TaskState } from "../types";
import { Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { ScriptOptions } from "./ScriptOptions";
import type { FormState } from "./stepTypes";

interface ScriptStepProps {
  task: TaskState | null;
  edit: RawTranscript | null;
  meta: Meta | null;
  form: FormState;
  onFormChange: (patch: Partial<FormState>) => void;
  canStart: boolean;
  blockedReason?: string;
  onStart: () => void;
  onEditChange: (next: RawTranscript) => void;
  onPatchDialogue: (paragraph: number, dialogue: number, value: string) => void;
  onDeleteDialogue: (paragraph: number, dialogue: number) => void;
  busy: boolean;
  error: string;
  onNext: () => void;
  onRestart: () => void;
  /** 会一并作废配音、素材与成片 */
  onRegenerate: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
}

export function ScriptStep(props: ScriptStepProps) {
  const {
    task,
    edit,
    meta,
    form,
    onFormChange,
    canStart,
    blockedReason,
    onStart,
    onEditChange,
    onPatchDialogue,
    onDeleteDialogue,
    busy,
    error,
    onNext,
    onRestart,
    onRegenerate,
    onRetry,
    onCancel,
    onBack,
  } = props;
  const awaiting = task?.status === "awaiting_script" && Boolean(edit);
  const running = task?.status === "running";
  const cancelled = task?.status === "cancelled";
  const idle = !task;
  // 只看写稿阶段的失败
  const failed = Boolean(
    task?.status === "failed" &&
    task.stages.some((stage) => SCRIPT_STAGE_IDS.includes(stage.id) && stage.status === "failed"),
  );
  const stages = task ? task.stages.filter((stage) => SCRIPT_STAGE_IDS.includes(stage.id)) : [];
  // 已确认时展示只读版本
  const transcript = awaiting ? null : (task?.transcript ?? null);
  // 至少保留一条台词
  const dialogueTotal = edit ? edit.paragraphs.reduce((sum, paragraph) => sum + paragraph.dialogues.length, 0) : 0;

  const optionsDisabled = running || busy;

  const regenerateButton = task ? (
    <button
      className="secondary"
      type="button"
      onClick={onRegenerate}
      disabled={busy}
      title="丢弃当前剧本（含未保存的修改）以及后续配音、素材与成片，按上面的内容、风格与角色名重写"
    >
      重新生成
    </button>
  ) : null;

  return (
    <Panel
      title="剧本生成"
      desc={
        idle
          ? "设定脚本风格与角色名，点「开始生成」后 AI 会抓取内容写稿，完成停在这里等你确认。"
          : cancelled
            ? transcript
              ? "已停止，但剧本已经写好了：点「继续」接着往下跑，已完成的步骤不会重做。"
              : "已停止。抓取和写稿都是分步落盘的，点「继续」会从断掉的那一步接着跑。"
            : awaiting
              ? "台词可以直接改，用不上的整条可以删掉；点下一步去选配音，确认后才开始合成。"
              : transcript
                ? "剧本已确认并用于配音，这里是当时的版本（只读）。"
                : "AI 正在抓取内容并写剧本，完成后会自动停在这里等确认。"
      }
      fill
    >
      {/* 始终渲染，避免布局跳动 */}
      <div className="panel-config">
        <ScriptOptions meta={meta} form={form} onChange={onFormChange} disabled={optionsDisabled} />
        {awaiting && (
          <p className="hint options-hint">
            改完上面的风格或角色名，点「重新生成」会按新设置重写整篇；当前剧本与后面的配音、素材、成片都会作废。
          </p>
        )}
      </div>

      {failed && <div className="alert">{task?.error ?? "剧本生成失败"}</div>}

      {/* 配置固定在顶部，阶段与台词滚动 */}
      <div className="panel-scroll">
        <StageList stages={stages} />

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
          <div>
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
      </div>

      <div className="panel-actions">
        {idle ? (
          <>
            <span className="action-hint">{blockedReason ?? ""}</span>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              返回上一步
            </button>
            <button className="primary" type="button" onClick={onStart} disabled={!canStart}>
              开始生成剧本
            </button>
          </>
        ) : awaiting ? (
          <>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              返回上一步
            </button>
            <button className="primary" type="button" onClick={onNext} disabled={busy}>
              下一步：配音生成
            </button>
          </>
        ) : failed ? (
          <>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              返回上一步
            </button>
            <button className="secondary" type="button" onClick={onRestart}>
              清空并重开
            </button>
            {regenerateButton}
            <button className="primary" type="button" onClick={onRetry} disabled={busy}>
              重试失败步骤
            </button>
          </>
        ) : running ? (
          <>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              返回上一步
            </button>
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              停止生成
            </button>
          </>
        ) : cancelled ? (
          <>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              返回上一步
            </button>
            <button className="secondary" type="button" onClick={onRestart}>
              清空并重开
            </button>
            <button className="primary" type="button" onClick={onRetry} disabled={busy}>
              继续
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
