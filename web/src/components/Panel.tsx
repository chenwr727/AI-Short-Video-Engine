import { useState, type ReactNode } from "react";

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
  defaultOpen = true,
  children,
}: {
  title: string;
  /** 收起时显示的一行摘要 */
  summary?: string;
  /** 已有产物时传 false */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`panel-config${open ? "" : " is-collapsed"}`}>
      <button className="config-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="config-caret" aria-hidden="true">
          ▾
        </span>
        <span className="config-name">{title}</span>
        {!open && summary && <span className="config-summary">{summary}</span>}
        <span className="config-action">{open ? "收起" : "展开"}</span>
      </button>
      {open && <div className="config-body">{children}</div>}
    </div>
  );
}
