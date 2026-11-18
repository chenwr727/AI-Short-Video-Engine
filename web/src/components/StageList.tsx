import { useEffect, useRef, useState } from "react";
import type { LogLine, StageState } from "../types";

const ICON: Record<StageState["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  skipped: "—",
};

/** 只给已结束的阶段算耗时 */
function cost(stage: StageState): string {
  if (!stage.startedAt || !stage.endedAt) return "";
  const sec = Math.max(0, (stage.endedAt - stage.startedAt) / 1000);
  if (sec < 1) return "";
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

export function StageList({ stages }: { stages: StageState[] }) {
  if (stages.length === 0) return null;
  return (
    <ol className="stages">
      {stages.map((stage) => {
        const spent = cost(stage);
        return (
          <li key={stage.id} className={`stage ${stage.status}`}>
            <span className="stage-icon">{ICON[stage.status]}</span>
            <span className="stage-label">{stage.label}</span>
            {stage.message && <span className="stage-msg">{stage.message}</span>}
            {spent && <span className="stage-cost">{spent}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function time(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

/** 日志面板，自动滚到底部，任务级日志始终显示 */
export function LogPanel({
  logs,
  tall,
  stages,
  collapsible,
  label,
}: {
  logs: LogLine[];
  tall?: boolean;
  stages?: string[];
  collapsible?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shown = stages ? logs.filter((line) => !line.stage || stages.includes(line.stage)) : logs;
  const hasError = shown.some((line) => line.level === "error");

  // 出错时只自动展开一次，绑 hasError 会在收起后又被撑开
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hasError) setOpen(true);
  }, [hasError]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown.length]);

  const body = (
    <div className={`log${tall ? " log-tall" : ""}`} ref={ref}>
      {shown.length === 0 && <div className="log-empty">暂无日志</div>}
      {shown.map((line, index) => (
        <div key={index} className={`log-line ${line.level}`}>
          <span className="log-time">{time(line.time)}</span>
          <span className="log-text">{line.text}</span>
        </div>
      ))}
    </div>
  );

  if (!collapsible) return body;

  return (
    <details className="log-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {label ?? "运行日志"}（{shown.length} 条）
        {hasError && <span className="pill error">有报错</span>}
      </summary>
      {body}
    </details>
  );
}
