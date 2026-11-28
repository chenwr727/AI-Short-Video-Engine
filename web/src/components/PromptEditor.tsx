import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushPrompt, getPrompt, getPrompts, resetPrompt, savePrompt } from "../api";
import { useLanguage, useT } from "../i18n";
import type { PromptDoc, PromptField, PromptSummary, PromptValue } from "../types";

interface PromptEditorProps {
  onClose: () => void;
  /** 独立窗口形态：无遮罩、撑满窗口 */
  standalone?: boolean;
}

interface FieldStatus {
  error: string;
  saving: boolean;
  dirty: boolean;
  savedAt: number;
  ready: boolean;
  overridden: boolean;
}

interface FieldEditorProps {
  doc: PromptDoc;
  field: PromptField;
  showLabel: boolean;
  onSaved: (value: PromptValue) => void;
  onStatus: (id: string, status: FieldStatus) => void;
}

const fieldId = (file: string, key: string) => `${file}\u0000${key}`;

/** 一个字段一个编辑器：同一文件有 1~2 个字段时，各自独立加载、防抖保存 */
function FieldEditor({ doc, field, showLabel, onSaved, onStatus }: FieldEditorProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(0);

  const dirty = loaded && draft !== saved;
  const latest = useRef({ file: doc.file, key: field.key, draft, dirty });
  useEffect(() => {
    latest.current = { file: doc.file, key: field.key, draft, dirty };
  }, [doc.file, field.key, draft, dirty]);

  useEffect(() => {
    let alive = true;
    setError("");
    (async () => {
      try {
        const data = await getPrompt(doc.file, field.key);
        if (!alive) return;
        setDraft(data.value);
        setSaved(data.value);
        setOverridden(data.overridden);
        setLoaded(true);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc.file, field.key]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      setError("");
      void savePrompt(doc.file, field.key, draft)
        .then((data) => {
          setSaved(data.value);
          setOverridden(data.overridden);
          setSavedAt(Date.now());
          onSaved(data);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setSaving(false));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, doc.file, field.key, onSaved]);

  useEffect(() => {
    onStatus(fieldId(doc.file, field.key), { error, saving, dirty, savedAt, ready: loaded, overridden });
  }, [doc.file, field.key, error, saving, dirty, savedAt, loaded, overridden, onStatus]);

  useEffect(() => {
    const flush = () => {
      const current = latest.current;
      if (current.dirty) flushPrompt(current.file, current.key, current.draft);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  async function restore() {
    setSaving(true);
    setError("");
    try {
      const data = await resetPrompt(doc.file, field.key);
      setDraft(data.value);
      setSaved(data.value);
      setOverridden(data.overridden);
      setSavedAt(Date.now());
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pm-field">
      <div className="pm-field-head">
        {showLabel && <span className="pm-field-label">{field.label}</span>}
        {showLabel &&
          (overridden ? (
            <span className="pm-badge">{t("common.customized")}</span>
          ) : (
            <span className="pm-badge muted">{t("prompts.builtin")}</span>
          ))}
        <button type="button" className="pm-reset" disabled={!overridden || saving} onClick={() => void restore()}>
          {t("prompts.reset")}
        </button>
      </div>
      {field.hint && <p className="hint pm-desc">{field.hint}</p>}
      <div className={`pm-editor${loaded ? "" : " busy"}`}>
        <textarea
          className="pm-textarea"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <span className="pm-count">{t("prompts.chars", { n: draft.length })}</span>
      </div>
    </div>
  );
}

/**
 * 提示词编辑：内置默认 + data/prompts 覆盖层，改完自动保存。
 *
 * 左侧是一级文件列表；右侧显示这个文件的全部字段，
 * 卡片类文件带 system / user 两个字段时就是两个文本框。
 */
export function PromptEditor({ onClose, standalone = false }: PromptEditorProps) {
  const t = useT();
  // 导航里的标题、说明由后端按 Accept-Language 展开，语言变了要重拉
  const language = useLanguage();
  const [docs, setDocs] = useState<PromptDoc[]>([]);
  const [values, setValues] = useState<PromptSummary[]>([]);
  const [file, setFile] = useState("");
  const [statuses, setStatuses] = useState<Record<string, FieldStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const doc = useMemo(() => docs.find((item) => item.file === file), [docs, file]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getPrompts();
        if (!alive) return;
        setDocs(data.docs);
        setValues(data.values);
        setFile((prev) => prev || data.docs[0]?.file || "");
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

  const handleSaved = useCallback((value: PromptValue) => {
    setValues((prev) =>
      prev.map((item) =>
        item.file === value.file && item.key === value.key
          ? { ...item, value: value.value, overridden: value.overridden }
          : item,
      ),
    );
  }, []);

  const handleStatus = useCallback((id: string, status: FieldStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const states =
    doc?.fields.map((f) => statuses[fieldId(doc.file, f.key)]).filter((s): s is FieldStatus => Boolean(s)) ?? [];
  const ready = Boolean(doc) && states.length === (doc?.fields.length ?? 0) && states.every((s) => s.ready);
  const statusError = error || states.find((s) => s.error)?.error || "";
  const statusText =
    error || !ready || statusError
      ? null
      : states.some((s) => s.saving)
        ? t("prompts.saving")
        : states.some((s) => s.dirty)
          ? t("common.unsaved")
          : states.some((s) => s.savedAt)
            ? t("prompts.autoSaved")
            : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const content = (
    <div className="panel">
      <h1 className="nav-title">{t("prompts.title")}</h1>

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
          {docs.map((item) => {
            const active = item.file === file;
            const customized = values.some((v) => v.file === item.file && v.overridden);
            return (
              <button
                type="button"
                key={item.file}
                className={`nav-cell${active ? " active" : ""}`}
                onClick={() => setFile(item.file)}
                title={item.description}
              >
                <span className="nav-label">{item.title}</span>
                {customized && <span className="nav-dot" aria-label={t("common.customized")} />}
              </button>
            );
          })}
        </div>
      </nav>

      <div className={`options${loading || !ready ? " busy" : ""}`}>
        {loading && !doc ? (
          <p className="hint">{statusError ? t("common.failed") : t("common.loading")}</p>
        ) : doc ? (
          <>
            <div className="pm-title">
              <span>{doc.title}</span>
              {doc.fields.length === 1 &&
                (states[0]?.overridden ? (
                  <span className="pm-badge">{t("common.customized")}</span>
                ) : (
                  <span className="pm-badge muted">{t("prompts.builtin")}</span>
                ))}
            </div>
            {doc.description && <p className="hint pm-desc">{doc.description}</p>}
            <div className="pm-fields">
              {doc.fields.map((field) => (
                <FieldEditor
                  key={`${doc.file}\u0000${field.key}`}
                  doc={doc}
                  field={field}
                  showLabel={doc.fields.length > 1}
                  onSaved={handleSaved}
                  onStatus={handleStatus}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {statusText && <span className="status">{statusText}</span>}
      {statusError && <span className="status err">{statusError}</span>}
    </div>
  );

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
