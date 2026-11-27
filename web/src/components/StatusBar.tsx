import { bridge } from "../bridge";
import { useT } from "../i18n";
import type { Health, TaskState } from "../types";

interface StatusBarProps {
  health: Health | null;
  task: TaskState | null;
}

/** 底部状态栏 */
export function StatusBar({ health, task }: StatusBarProps) {
  const t = useT();
  const desktop = Boolean(bridge());

  return (
    <footer className="statusbar">
      <span className="sb-item sb-brand">{t("app.name")}</span>
      {!health && (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-muted">{t("app.connecting")}</span>
        </>
      )}

      <span className="sb-grow" />

      {task && (
        <span className="sb-item" title={task.workspace}>
          {t("status.current")}
          {task.id}
        </span>
      )}
      {desktop && (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-muted">
            {bridge()?.platform === "darwin" ? t("app.settingsHintMac") : t("app.settingsHint")}
          </span>
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
