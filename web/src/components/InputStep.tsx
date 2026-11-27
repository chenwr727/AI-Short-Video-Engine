import type { FormState } from "./stepTypes";
import { Panel } from "./Panel";
import { useT } from "../i18n";

interface InputStepProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  canNext: boolean;
  running: boolean;
  awaiting: boolean;
  error: string;
  /** 有剧本时才允许整条重跑 */
  canRegenerate: boolean;
  onRegenerate: () => void;
  busy: boolean;
  onNext: () => void;
}

export function InputStep(props: InputStepProps) {
  const t = useT();
  const { form, onChange, canNext, running, awaiting, error, canRegenerate, onRegenerate, busy, onNext } = props;
  const empty = !form.content.trim();

  return (
    <Panel title={t("steps.content")} desc={t("input.hint")} fill>
      <div className="field field-grow">
        <div className="field-head">
          <label htmlFor="content">{t("input.label")}</label>
          {form.content.trim() && (
            <span className="field-count">{t("input.chars", { n: form.content.trim().length })}</span>
          )}
        </div>
        <textarea
          id="content"
          className="textarea-main"
          value={form.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={t("input.placeholder")}
          disabled={running}
        />
        <span className="field-hint">{t("input.subHint")}</span>
      </div>

      {awaiting && <p className="hint">{t("input.afterScript")}</p>}
      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <span className="action-hint">
          {running
            ? t("script.done")
            : awaiting
              ? t("script.confirming")
              : empty
                ? t("input.needContent")
                : t("script.nextHint")}
        </span>
        {canRegenerate && (
          <button
            className="secondary"
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            title={t("input.regenerateHint")}
          >
            {t("common.regenerate")}
          </button>
        )}
        <button className="primary" type="button" onClick={onNext} disabled={!canNext}>
          {t("input.nextHint")}
        </button>
      </div>
    </Panel>
  );
}
