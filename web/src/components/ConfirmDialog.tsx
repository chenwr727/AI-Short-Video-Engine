import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n";

/** 文案：要么是词典键，要么是接口返回的成品文本 */
type Text = MessageKey | { raw: string };

interface DialogProps {
  title: MessageKey;
  body: Text;
  confirmLabel: MessageKey;
  /** 会丢数据的操作用警示色 */
  danger: boolean;
  /** 只有确认按钮（替身 window.alert） */
  alertOnly: boolean;
  onResolve: (ok: boolean) => void;
}

/**
 * 模态框，替代原生 confirm() / alert()。
 * 原生框由系统绘制，配色和字体跟界面无关。这里复用 --aisv-* 令牌。
 */
function Dialog({ title, body, confirmLabel, danger, alertOnly, onResolve }: DialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onResolve(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return createPortal(
    <div className="dialog-mask" onClick={() => onResolve(false)}>
      <div
        className="dialog"
        role={alertOnly ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title" id="dialog-title">
          {t(title)}
        </h2>
        <p className="dialog-body" id="dialog-body">
          {typeof body === "string" ? t(body) : body.raw}
        </p>
        <div className="dialog-actions">
          {!alertOnly && (
            <button type="button" className="dialog-btn" onClick={() => onResolve(false)}>
              {t("common.cancel")}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`dialog-btn${danger ? " dialog-btn-danger" : " dialog-btn-primary"}`}
            onClick={() => onResolve(true)}
          >
            {t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmRequest {
  title: MessageKey;
  body: Text;
  confirmLabel: MessageKey;
  danger: boolean;
  alertOnly: boolean;
  resolve: (ok: boolean) => void;
}

interface ConfirmOptions {
  title: MessageKey;
  body: Text;
  confirmLabel?: MessageKey;
  danger?: boolean;
}

/**
 * 确认框与提示框。和 window.confirm 一样「等着拿结果」，只是改成 await：
 *
 *   if (!(await confirm({ title: "script.regenerateConfirmTitle", body: "script.regenerateConfirmBody" }))) return;
 *   await alert({ title: "common.operationFailed", body: { raw: message } });
 *
 * 必须在组件里调用，并把返回的 dialog 渲染出来。
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const open = useCallback(
    (options: ConfirmOptions, alertOnly: boolean) =>
      new Promise<boolean>((resolve) => {
        setRequest({
          title: options.title,
          body: options.body,
          confirmLabel: options.confirmLabel ?? "common.continue",
          danger: options.danger ?? false,
          alertOnly,
          resolve,
        });
      }),
    [],
  );

  const confirm = useCallback((options: ConfirmOptions) => open(options, false), [open]);

  const alert = useCallback((options: ConfirmOptions) => open(options, true), [open]);

  const resolve = useCallback((ok: boolean) => {
    setRequest((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const dialog: ReactNode = request ? (
    <Dialog
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel}
      danger={request.danger}
      alertOnly={request.alertOnly}
      onResolve={resolve}
    />
  ) : null;

  return { confirm, alert, dialog };
}
