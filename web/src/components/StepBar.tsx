import type { Phase } from "../phases";
import { indexOf, stepsFor } from "../phases";

interface Props {
  current: Phase;
  reached: number;
  doneThrough: number;
  onSelect: (phase: Phase) => void;
}

/** 顶部步骤条：已完成打勾，已到达可点回 */
export function StepBar({ current, reached, doneThrough, onSelect }: Props) {
  const steps = stepsFor();
  const cur = indexOf(current);

  return (
    <div className="stepper-wrap">
      <ol className="stepper">
        {steps.map((step, index) => {
          const active = index === cur;
          const done = index < doneThrough;
          const clickable = index <= reached && !active;
          return (
            <li key={step.id} className={`step${active ? " active" : ""}${done ? " done" : ""}`}>
              {index > 0 && <span className={`step-line${index <= reached ? " on" : ""}`} />}
              <button
                type="button"
                className="step-btn"
                disabled={!clickable}
                onClick={() => onSelect(step.id)}
                title={clickable ? `回到「${step.label}」` : step.desc}
              >
                <span className="step-dot">{done && !active ? "✓" : index + 1}</span>
                <span className="step-label">{step.label}</span>
                <span className="step-desc">{step.desc}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
