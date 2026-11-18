import { bridge } from "../bridge";
import type { Health, TaskState } from "../types";

interface StatusBarProps {
  health: Health | null;
  task: TaskState | null;
}

/** 底部状态栏 */
export function StatusBar({ health, task }: StatusBarProps) {
  const desktop = Boolean(bridge());

  return (
    <footer className="statusbar">
      <span className="sb-item sb-brand">AI 短视频生成器</span>
      {health ? (
        <>
          <span className="sb-sep" />
          <span className="sb-item" title={health.outDir}>
            输出：{health.outDir}
          </span>
          <span className="sb-sep" />
          <span className="sb-item" title={health.dataDir}>
            数据：{health.dataDir}
          </span>
        </>
      ) : (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-muted">正在连接后端…</span>
        </>
      )}

      <span className="sb-grow" />

      {task && (
        <span className="sb-item" title={task.workspace}>
          当前任务：{task.id}
        </span>
      )}
      {desktop && (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-muted">{bridge()?.platform === "darwin" ? "⌘, 设置" : "Ctrl+, 设置"}</span>
        </>
      )}
      {health && (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-muted">v{health.version}</span>
        </>
      )}
    </footer>
  );
}
