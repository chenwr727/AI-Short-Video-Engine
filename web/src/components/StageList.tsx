import { useEffect, useRef, useState } from "react";
import { useLanguage, useT, type Language } from "../i18n";
import type { MessageKey } from "../i18n";
import type { LogLine, StageState } from "../types";

const ICON: Record<StageState["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  skipped: "—",
};

/**
 * 阶段名按 id 取词，不用后端存进任务里的 label。
 *
 * 任务数据会落盘，里面那份中文是生成当时写死的；
 * 界面语言变了它不会跟着变，旧任务还会永远显示中文。
 * 由前端按 id 现取，两种语言都正确，旧任务也能切过来。
 */
const STAGE_LABEL: Record<string, MessageKey> = {
  fetch: "stage.fetch",
  write: "stage.write",
  rewrite: "stage.rewrite",
  split: "stage.split",
  tts: "stage.tts",
  material: "stage.material",
  cards: "stage.cards",
  compose: "stage.compose",
};

/** 只给已结束的阶段算耗时 */
function cost(stage: StageState): string {
  if (!stage.startedAt || !stage.endedAt) return "";
  const sec = Math.max(0, (stage.endedAt - stage.startedAt) / 1000);
  if (sec < 1) return "";
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

/** 阶段摘要：有 counts 就按当前语言现拼，固定说法用写入时的语言 */
function summary(stage: StageState, t: (key: MessageKey, vars?: Record<string, string | number>) => string) {
  const c = stage.counts;
  if (!c) return stage.message;

  // 合成阶段可能还有「缺 N 张版式卡」的附加说明，和主摘要拼在一起
  const missing = c.missingCards ? t("stage.summary.missingCards", { n: c.missingCards }) : "";

  let main: string;
  if (c.sections !== undefined && c.seconds !== undefined) {
    main = t("stage.summary.sectionsSeconds", { n: c.sections, sec: c.seconds });
  } else if (c.sections !== undefined && c.sentences !== undefined) {
    main = t("stage.summary.sectionsSentences", { n: c.sections, sent: c.sentences });
  } else if (c.sections !== undefined) {
    main = t("stage.summary.sections", { n: c.sections });
  } else if (c.chars !== undefined) {
    main = t("stage.summary.chars", { n: c.chars });
  } else if (c.cards !== undefined) {
    main = t("stage.summary.cards", { n: c.cards });
  } else {
    return stage.message;
  }

  return missing ? `${main}${missing}` : main;
}

export function StageList({ stages }: { stages: StageState[] }) {
  const t = useT();
  if (stages.length === 0) return null;
  return (
    <ol className="stages">
      {stages.map((stage) => {
        const spent = cost(stage);
        const key = STAGE_LABEL[stage.id];
        const text = summary(stage, t);
        return (
          <li key={stage.id} className={`stage ${stage.status}`}>
            <span className="stage-icon">{ICON[stage.status]}</span>
            <span className="stage-label">{key ? t(key) : stage.label}</span>
            {text && <span className="stage-msg">{text}</span>}
            {spent && <span className="stage-cost">{spent}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function time(iso: string, language: Language): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour12: false });
}

/** 日志面板，自动滚到底部，任务级日志始终显示 */
export function LogPanel({
  logs,
  tall,
  stages,
  collapsible,
  expanded,
  label,
  since,
}: {
  logs: LogLine[];
  tall?: boolean;
  stages?: string[];
  collapsible?: boolean;
  /** 由页面控制展开：生成中展开，跑完收起 */
  expanded?: boolean;
  label?: string;
  /**
   * 只显示这个时刻之后的日志。
   * 重跑时会话那头的 stage 可能缺失，仅靠 stages 过滤会漏掉上一轮的残留行。
   */
  since?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const t = useT();
  const language = useLanguage();
  const fresh = since === undefined ? logs : logs.filter((line) => Date.parse(line.time) >= since);
  const shown = stages ? fresh.filter((line) => !line.stage || stages.includes(line.stage)) : fresh;
  const hasError = shown.some((line) => line.level === "error");

  // 展开由阶段决定，但有报错时始终撑开
  const [open, setOpen] = useState(Boolean(expanded) || hasError);
  useEffect(() => {
    setOpen(Boolean(expanded) || hasError);
  }, [expanded, hasError]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown.length]);

  const body = (
    <div className={`log${tall ? " log-tall" : ""}`} ref={ref}>
      {shown.length === 0 && <div className="log-empty">{t("stage.noLog")}</div>}
      {shown.map((line, index) => (
        <div key={index} className={`log-line ${line.level}`}>
          <span className="log-time">{time(line.time, language)}</span>
          <span className="log-text">{line.text}</span>
        </div>
      ))}
    </div>
  );

  if (!collapsible) return body;

  return (
    <details className="log-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {label ?? t("render.log")}
        {t("stage.count", { n: shown.length })}
        {hasError && <span className="pill error">{t("stage.hasError")}</span>}
      </summary>
      {body}
    </details>
  );
}
