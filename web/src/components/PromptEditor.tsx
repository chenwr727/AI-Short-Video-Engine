import { useEffect, useMemo, useState } from "react";
import { getPrompt, getPrompts, savePrompt } from "../api";
import { useLanguage, useT } from "../i18n";
import type { PromptDoc, PromptSummary } from "../types";

interface PromptEditorProps {
  onClose: () => void;
  /** 独立窗口形态：无遮罩、撑满窗口 */
  standalone?: boolean;
}

/**
 * 提示词编辑：内置默认 + data/prompts 覆盖层，改完自动保存。
 *
 * 骨架与设置页一致：212px 导航 + 内容区的两行网格，
 * 标题占第一行左格，关闭钮占第一行右格。
 */
export function PromptEditor({ onClose, standalone = false }: PromptEditorProps) {
  const t = useT();
  // 导航里的标题、说明由后端按 Accept-Language 展开，语言变了要重拉
  const language = useLanguage();
  const [docs, setDocs] = useState<PromptDoc[]>([]);
  const [values, setValues] = useState<PromptSummary[]>([]);
  const [file, setFile] = useState("");
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState("");
  const [overridden, setOverridden] = useState(false);
  // draft 对应的是哪个键；切换时 draft 还是旧内容，不能拿它算 dirty
  const [loadedId, setLoadedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** 自动保存的状态：正在写 / 刚写完。只用于界面反馈，不阻止编辑 */
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  const doc = useMemo(() => docs.find((item) => item.file === file), [docs, file]);
  const field = useMemo(() => doc?.fields.find((item) => item.key === key), [doc, key]);

  const idOf = (f: string, k: string) => `${f}\u0000${k}`;
  const currentId = idOf(file, key);
  // 详情还没回来时，draft / overridden 都属于上一个键，一律按「未就绪」处理
  const ready = loadedId !== "" && loadedId === currentId;
  const savedValue = useMemo(
    () => values.find((v) => v.file === file && v.key === key)?.value ?? "",
    [values, file, key],
  );
  const dirty = ready && draft !== savedValue;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getPrompts();
        if (!alive) return;
        setDocs(data.docs);
        setValues(data.values);
        // 只有首次加载才定位到第一篇；切语言只是刷新文案，别把用户选的键冲掉
        const first = data.docs[0];
        setFile((prev) => prev || first?.file || "");
        setKey((prev) => prev || first?.fields[0]?.key || "");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [language]);

  // 换键时拉详情，拿到内置默认值
  useEffect(() => {
    if (!file || !key) return;
    let alive = true;
    const target = idOf(file, key);
    setError("");
    setSavedAt(0);
    (async () => {
      try {
        const data = await getPrompt(file, key);
        if (!alive) return;
        setDraft(data.value);
        setOverridden(data.overridden);
        // 只有 draft 归位后才算「已就绪」，否则 dirty 会拿旧内容误判
        setLoadedId(target);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, key]);
  /*
   * 停止输入 1 秒后自动保存。
   *
   * 依赖 draft：每次按键都会重置定时器，所以只在「停下来」之后写一次。
   * 卸载时清掉，避免切走之后旧值又被写回去。
   */
  useEffect(() => {
    if (!dirty || !ready) return;
    const timer = window.setTimeout(() => {
      void writePrompt(file, key, draft);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, ready, draft, file, key]);

  // 关窗口前把没写的落盘
  useEffect(() => {
    if (!dirty || !ready) return;
    const flush = () => {
      void writePrompt(file, key, draft);
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [dirty, ready, draft, file, key]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function syncValues(next: { file: string; key: string; value: string; overridden: boolean }) {
    setValues((prev) =>
      prev.map((item) => (item.file === next.file && item.key === next.key ? { ...item, ...next } : item)),
    );
  }

  /**
   * 把当前草稿写回。
   *
   * 不弹任何提示：成功静默，失败在右下角气泡留一行红字。
   * 写入后不覆盖 draft —— 用户可能已经在继续打字，回填会把新输入冲掉。
   */
  async function writePrompt(targetFile: string, targetKey: string, value: string) {
    setSaving(true);
    setError("");
    try {
      const data = await savePrompt(targetFile, targetKey, value);
      setOverridden(data.overridden);
      syncValues(data);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function switchTo(nextFile: string, nextKey: string) {
    // 切走前把没写的内容落盘，不打断操作、也不弹确认
    if (dirty) void writePrompt(file, key, draft);
    setFile(nextFile);
    setKey(nextKey);
  }

  const statusText = error
    ? null
    : !ready
      ? null
      : saving
        ? t("prompts.saving")
        : dirty
          ? t("common.unsaved")
          : savedAt
            ? t("prompts.autoSaved")
            : null;

  const content = (
    <div className="panel">
      <h1 className="nav-title">{t("prompts.title")}</h1>

      {/* 标题行右侧：和设置页一样，唯一的关闭钮就在面板里 */}
      <div className="header">
        <span className="header-spacer" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <nav className="nav">
        <div className="nav-list">
          {docs.map((item) => (
            <div className="nav-group" key={item.file}>
              {/* 分组名只用来说清「这些是同一个人设下的几段」，不可点 */}
              <div className="nav-group-name">{item.title}</div>
              {item.fields.map((f) => {
                const summary = values.find((v) => v.file === item.file && v.key === f.key);
                const active = item.file === file && f.key === key;
                return (
                  <button
                    type="button"
                    key={f.key}
                    className={`nav-cell${active ? " active" : ""}`}
                    onClick={() => switchTo(item.file, f.key)}
                    title={f.hint || f.label}
                  >
                    <span className="nav-label">{f.label}</span>
                    {summary?.overridden && <span className="nav-dot" aria-label={t("common.customized")} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <div className={`options${loading || !ready ? " busy" : ""}`}>
        {loading && !doc ? (
          <p className="hint">{error ? t("common.failed") : t("common.loading")}</p>
        ) : (
          <>
            <div className="pm-title">
              <span>
                {doc?.title} · {field?.label}
              </span>
              {overridden ? (
                <span className="pm-badge">{t("common.customized")}</span>
              ) : (
                <span className="pm-badge muted">{t("prompts.builtin")}</span>
              )}
            </div>
            {doc?.description && <p className="hint pm-desc">{doc.description}</p>}
            {field?.hint && <p className="hint pm-desc">{field.hint}</p>}

            {/* 字数贴在编辑框右下角，不再单独占一行 */}
            <div className="pm-editor">
              <textarea
                className="pm-textarea"
                value={draft}
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
              />
              <span className="pm-count">{t("prompts.chars", { n: draft.length })}</span>
            </div>
          </>
        )}
      </div>

      {statusText && <span className="status">{statusText}</span>}
      {error && <span className="status err">{error}</span>}
    </div>
  );

  // 独立窗口：撑满窗口，不画遮罩
  if (standalone) {
    return (
      <div className="pm-standalone" role="dialog" aria-label={t("prompts.title")}>
        {content}
      </div>
    );
  }

  return (
    <div className="pm-overlay" role="dialog" aria-modal="true" aria-label={t("prompts.title")}>
      {content}
    </div>
  );
}
