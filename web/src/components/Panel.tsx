import type { ReactNode } from "react";

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
