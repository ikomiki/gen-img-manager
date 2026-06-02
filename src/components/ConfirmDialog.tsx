import { useEffect, useRef } from "react";

interface Props {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 実行中はボタンを無効化する（二度押し防止）。 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 再利用可能な確認モーダル。破壊的操作向けに:
 * - 初期フォーカスはキャンセル
 * - Esc でキャンセル（Enter による即実行はしない）
 * - 確認ボタンは危険色（danger-btn）
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "キャンセル",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3>{title}</h3>
        <div className="confirm-body">{body}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className="danger-btn" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
