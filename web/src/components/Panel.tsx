import { useEffect, useState, type ReactNode } from "react";

/** 步骤页统一外壳 */
export function Panel({
  title,
  desc,
  aside,
  fill,
  children,
}: {
  title: string;
  desc?: string;
  aside?: ReactNode;
  /** 卡片撑满可视高度 */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`card step-panel${fill ? " panel-fill" : ""}`}>
      <div className="panel-head">
        <div className="panel-head-text">
          <h2>{title}</h2>
          {desc && <p className="hint">{desc}</p>}
        </div>
        {aside && <div className="panel-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** 顶部参数区，可收起把高度让给下面的日志或预览 */
export function ConfigSection({
  title,
  summary,
  open = true,
  children,
}: {
  title: string;
  /** 收起时显示的一行摘要 */
  summary?: string;
  /** 由页面按阶段控制展开，用户点标题可临时覆盖 */
  open?: boolean;
  children: ReactNode;
}) {
  // null = 跟随 open，非 null = 用户手动覆盖
  const [manual, setManual] = useState<boolean | null>(null);

  useEffect(() => {
    setManual(null);
  }, [open]);

  const shown = manual ?? open;

  return (
    <div className={`panel-config${shown ? "" : " is-collapsed"}`}>
      <button className="config-toggle" type="button" aria-expanded={shown} onClick={() => setManual(!shown)}>
        <span className="config-caret" aria-hidden="true">
          ▾
        </span>
        <span className="config-name">{title}</span>
        {!shown && summary && <span className="config-summary">{summary}</span>}
        <span className="config-action">{shown ? "收起" : "展开"}</span>
      </button>
      {shown && <div className="config-body">{children}</div>}
    </div>
  );
}
