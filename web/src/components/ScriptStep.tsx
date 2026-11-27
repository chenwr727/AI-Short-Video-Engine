import { SCRIPT_STAGE_IDS } from "../phases";
import { useT } from "../i18n";
import type { Meta, RawTranscript, TaskState } from "../types";
import { ConfigSection, Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";
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
  const t = useT();
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

  const stepStage: StepStage = idle ? "setup" : running ? "running" : failed || cancelled ? "failed" : "ready";
  const layout = stepLayout(stepStage, Boolean(transcript || edit));
  // 至少保留一条台词
  const dialogueTotal = edit ? edit.paragraphs.reduce((sum, paragraph) => sum + paragraph.dialogues.length, 0) : 0;

  const optionsDisabled = running || busy;
  const styleLabel =
    meta?.promptSources.find((option) => option.id === form.promptSource)?.label ?? t("script.styleUnset");

  const regenerateButton = task ? (
    <button
      className="secondary"
      type="button"
      onClick={onRegenerate}
      disabled={busy}
      title={t("script.regenerateHint")}
    >
      {t("common.regenerate")}
    </button>
  ) : null;

  return (
    <Panel
      title={t("steps.script")}
      desc={
        idle
          ? t("script.hint")
          : cancelled
            ? transcript
              ? t("tts.stoppedScript")
              : t("script.stopped")
            : awaiting
              ? t("script.hint2")
              : transcript
                ? t("script.confirmedReadonly")
                : t("script.running")
      }
      fill
    >
      <ConfigSection
        title={t("script.title")}
        summary={[styleLabel, form.speakerMain || meta?.speakers.main, form.speakerGuest || meta?.speakers.guest]
          .filter(Boolean)
          .join(" · ")}
        open={layout.configOpen}
      >
        <ScriptOptions meta={meta} form={form} onChange={onFormChange} disabled={optionsDisabled} />
        {awaiting && <p className="hint options-hint">{t("script.regenerateHint2")}</p>}
      </ConfigSection>

      {failed && <div className="alert">{task?.error ?? t("error.scriptGen")}</div>}

      <div className="panel-scroll">
        <StageList stages={stages} />

        {task && (
          <LogPanel
            logs={task.logs}
            stages={SCRIPT_STAGE_IDS}
            since={task.runStartedAt}
            collapsible
            expanded={layout.logOpen}
            tall={layout.logOpen}
          />
        )}

        {layout.showResult && awaiting && edit && (
          <>
            <div className="field">
              <label htmlFor="script-title">{t("script.titleLabel")}</label>
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
                  {t("tts.paragraph", { n: paragraphIndex + 1 })}
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
                      title={dialogueTotal > 1 ? t("script.deleteLine") : t("script.needLine")}
                      aria-label={t("script.deleteLine")}
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

        {layout.showResult && transcript && (
          <div>
            {transcript.title && <p className="script-title">{transcript.title}</p>}
            {transcript.paragraphs.map((paragraph, paragraphIndex) => (
              <div className="paragraph" key={paragraphIndex}>
                <div className="paragraph-head">
                  {t("tts.paragraph", { n: paragraphIndex + 1 })}
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

        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        {idle ? (
          <>
            <span className="action-hint">{blockedReason ?? ""}</span>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              {t("common.back")}
            </button>
            <button className="primary" type="button" onClick={onStart} disabled={!canStart}>
              {t("script.start")}
            </button>
          </>
        ) : awaiting ? (
          <>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              {t("common.back")}
            </button>
            <button className="primary" type="button" onClick={onNext} disabled={busy}>
              {t("script.nextTts")}
            </button>
          </>
        ) : failed ? (
          <>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              {t("common.back")}
            </button>
            <button className="secondary" type="button" onClick={onRestart}>
              {t("script.clearRestart")}
            </button>
            {regenerateButton}
            <button className="primary" type="button" onClick={onRetry} disabled={busy}>
              {t("common.retry")}
            </button>
          </>
        ) : running ? (
          <>
            {regenerateButton}
            <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
              {t("common.back")}
            </button>
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              {t("script.stopRunning")}
            </button>
          </>
        ) : cancelled ? (
          <>
            <button className="secondary btn-back" type="button" onClick={onBack}>
              {t("common.back")}
            </button>
            <button className="secondary" type="button" onClick={onRestart}>
              {t("script.clearRestart")}
            </button>
            <button className="primary" type="button" onClick={onRetry} disabled={busy}>
              {t("common.continue")}
            </button>
          </>
        ) : (
          <>
            {regenerateButton}
            {task && (
              <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
                {t("common.back")}
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
