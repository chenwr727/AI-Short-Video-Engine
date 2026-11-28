import type { Phase } from "../phases";
import { indexOf, stepsFor } from "../phases";
import { useT } from "../i18n";

interface Props {
  current: Phase;
  reached: number;
  doneThrough: number;
  onSelect: (phase: Phase) => void;
  /** 当前页有正在写任务状态的请求时锁住，避免切页后回来被旧快照盖掉 */
  navLocked?: boolean;
}

/** 顶部步骤条：已完成打勾，已到达可点回 */
export function StepBar({ current, reached, doneThrough, onSelect, navLocked }: Props) {
  const t = useT();
  const steps = stepsFor();
  const cur = indexOf(current);

  return (
    <div className="stepper-wrap">
      <ol className="stepper">
        {steps.map((step, index) => {
          const active = index === cur;
          const done = index < doneThrough;
          const clickable = index <= reached && !active && !navLocked;
          return (
            <li key={step.id} className={`step${active ? " active" : ""}${done ? " done" : ""}`}>
              {index > 0 && <span className={`step-line${index <= reached ? " on" : ""}`} />}
              <button
                type="button"
                className="step-btn"
                disabled={!clickable}
                onClick={() => onSelect(step.id)}
                title={clickable ? `${t(step.desc)} · ${t("steps.backTo", { step: t(step.label) })}` : t(step.desc)}
              >
                <span className="step-dot">{done && !active ? "✓" : index + 1}</span>
                <span className="step-label">{t(step.label)}</span>
                <span className="step-desc">{t(step.desc)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
