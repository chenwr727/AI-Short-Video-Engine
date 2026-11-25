import { useEffect, useMemo, useState } from "react";
import { getPrompt, getPrompts, resetPrompt, savePrompt } from "../api";
import type { PromptDoc, PromptSummary } from "../types";

interface PromptEditorProps {
  onClose: () => void;
  /** 独立窗口形态：无遮罩、无自绘关闭钮，交给系统标题栏 */
  standalone?: boolean;
}

/** 设置 → 提示词：内置默认 + data/prompts 覆盖层，保存后立即生效 */
export function PromptEditor({ onClose, standalone = false }: PromptEditorProps) {
  const [docs, setDocs] = useState<PromptDoc[]>([]);
  const [values, setValues] = useState<PromptSummary[]>([]);
  const [file, setFile] = useState("");
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState("");
  const [overridden, setOverridden] = useState(false);
  // draft 对应的是哪个键；切换时 draft 还是旧内容，不能拿它算 dirty
  const [loadedId, setLoadedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

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
        const first = data.docs[0];
        if (first) {
          setFile(first.file);
          setKey(first.fields[0]?.key ?? "");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 换键时拉详情，拿到内置默认值
  useEffect(() => {
    if (!file || !key) return;
    let alive = true;
    const target = idOf(file, key);
    setError("");
    setSaved("");
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

  async function onSave() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await savePrompt(file, key, draft);
      setDraft(data.value);
      setOverridden(data.overridden);
      syncValues(data);
      setSaved("已保存，下一次写稿生效");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    if (!window.confirm(`把「${doc?.title ?? ""} · ${field?.label ?? ""}」恢复成内置默认？当前修改会丢失。`)) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await resetPrompt(file, key);
      setDraft(data.value);
      setOverridden(data.overridden);
      syncValues(data);
      setSaved("已恢复内置默认");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function switchTo(nextFile: string, nextKey: string) {
    if (dirty && !window.confirm("当前修改还没保存，切换后会丢失。继续？")) return;
    setFile(nextFile);
    setKey(nextKey);
  }

  const head = (
    <div className="pm-head">
      <div>
        <h2>提示词</h2>
        <p className="hint">改动写进数据目录的 prompts/ 下，覆盖随包内置的默认值，保存后立刻生效。</p>
      </div>
      {!standalone && (
        <button type="button" className="pm-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );

  const content = (
    <>
      {head}

      <div className="pm-body">
        <nav className="pm-nav">
          {docs.map((item) => (
            <div className="pm-group" key={item.file}>
              <div className="pm-group-name">{item.title}</div>
              {item.fields.map((f) => {
                const summary = values.find((v) => v.file === item.file && v.key === f.key);
                const active = item.file === file && f.key === key;
                return (
                  <button
                    type="button"
                    key={f.key}
                    className={`pm-nav-item${active ? " on" : ""}`}
                    onClick={() => switchTo(item.file, f.key)}
                  >
                    <span>{f.label}</span>
                    {summary?.overridden && (
                      <span className="pm-dot" title="已自定义">
                        ·
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="pm-main">
          {loading || !ready ? (
            <p className="hint">{error ? "读取失败" : "读取中…"}</p>
          ) : (
            <>
              <div className="pm-title">
                <span>
                  {doc?.title} · {field?.label}
                </span>
                {overridden ? (
                  <span className="pm-badge">已自定义</span>
                ) : (
                  <span className="pm-badge muted">内置默认</span>
                )}
              </div>
              {doc?.description && <p className="hint pm-desc">{doc.description}</p>}
              {field?.hint && <p className="hint pm-desc">{field.hint}</p>}

              <div className="pm-editor">
                <span className="pm-count">{draft.length} 字</span>
                <textarea
                  className="pm-textarea"
                  value={draft}
                  spellCheck={false}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pm-actions">
        <span className="pm-status">
          {error ? <span className="pm-err">{error}</span> : !ready ? null : saved || (dirty && "有未保存修改")}
        </span>
        <button
          type="button"
          className="pm-btn link"
          onClick={() => void onReset()}
          disabled={busy || !ready || (!overridden && !dirty)}
        >
          恢复默认值
        </button>
        <button type="button" className="pm-btn" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="pm-btn primary"
          onClick={() => void onSave()}
          disabled={busy || !ready || !dirty}
        >
          保存
        </button>
      </div>
    </>
  );

  // 独立窗口：撑满窗口，不画遮罩
  if (standalone) {
    return (
      <div className="pm-window" role="dialog" aria-label="提示词">
        {content}
      </div>
    );
  }

  return (
    <div className="pm-overlay" role="dialog" aria-modal="true" aria-label="提示词">
      <div className="pm-dialog">{content}</div>
    </div>
  );
}
