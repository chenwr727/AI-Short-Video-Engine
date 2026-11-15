import type { Phase } from "../phases";
import { STEPS, STEP_INDEX } from "../phases";

interface Props {
  current: Phase;
  reached: number;
  following: boolean;
  target: Phase | null;
  onSelect: (phase: Phase) => void;
  onFollow: () => void;
}

/** 顶部步骤条：已完成步骤显示对勾，已到达的步骤可点回去看 */
export function StepBar({ current, reached, following, target, onSelect, onFollow }: Props) {
  const cur = STEP_INDEX[current];
  const targetLabel = target ? STEPS.find((step) => step.id === target)?.label : "";

  return (
    <div className="stepper-wrap">
      <ol className="stepper">
        {STEPS.map((step, index) => {
          const active = index === cur;
          const done = index < cur && index <= reached;
          const clickable = index <= reached && !active;
          return (
            <li key={step.id} className={`step${active ? " active" : ""}${done ? " done" : ""}`}>
              {index > 0 && <span className={`step-line${index <= cur ? " on" : ""}`} />}
              <button
                type="button"
                className="step-btn"
                disabled={!clickable}
                onClick={() => onSelect(step.id)}
                title={clickable ? `回到「${step.label}」` : step.desc}
              >
                <span className="step-dot">{done ? "✓" : index + 1}</span>
                <span className="step-label">{step.label}</span>
                <span className="step-desc">{step.desc}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {!following && target && target !== current && (
        <button type="button" className="follow-btn" onClick={onFollow}>
          回到最新进度（{targetLabel}）
        </button>
      )}
    </div>
  );
}
