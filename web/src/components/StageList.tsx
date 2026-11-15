import { useEffect, useRef } from "react";
import type { LogLine, StageState } from "../types";

const ICON: Record<StageState["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  skipped: "—",
};

export function StageList({ stages }: { stages: StageState[] }) {
  if (stages.length === 0) return null;
  return (
    <ol className="stages">
      {stages.map((stage) => (
        <li key={stage.id} className={`stage ${stage.status}`}>
          <span className="stage-icon">{ICON[stage.status]}</span>
          <span className="stage-label">{stage.label}</span>
          {stage.message && <span className="stage-msg">{stage.message}</span>}
        </li>
      ))}
    </ol>
  );
}

function time(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * 日志面板：自动滚到底部；tall 用于进度步里更高的日志区。
 * stages 传入后只显示这些阶段的日志，任务级日志（没打阶段标记的）始终显示。
 */
export function LogPanel({ logs, tall, stages }: { logs: LogLine[]; tall?: boolean; stages?: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shown = stages ? logs.filter((line) => !line.stage || stages.includes(line.stage)) : logs;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown.length]);

  return (
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
}
