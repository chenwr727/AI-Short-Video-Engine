import type { Phase } from "../phases";
import { STEPS, STEP_INDEX } from "../phases";

interface Props {
  current: Phase;
  reached: number;
  doneThrough: number;
  onSelect: (phase: Phase) => void;
}

/** 顶部步骤条：已完成打勾，已到达可点回 */
export function StepBar({ current, reached, doneThrough, onSelect }: Props) {
  const cur = STEP_INDEX[current];

  return (
    <div className="stepper-wrap">
      <ol className="stepper">
        {STEPS.map((step, index) => {
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
