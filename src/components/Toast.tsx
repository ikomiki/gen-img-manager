import { useEffect } from "react";
import { useQueryStore } from "../store/useQueryStore";

/** メインウィンドウ共通のトースト。一定時間で自動的に消える。 */
export function Toast() {
  const toast = useQueryStore((s) => s.toast);
  const toastSeq = useQueryStore((s) => s.toastSeq);
  const clearToast = useQueryStore((s) => s.clearToast);

  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => clearToast(), 2000);
    return () => window.clearTimeout(id);
    // toastSeq 変化で再タイマー（同一文言の連続表示に対応）。
  }, [toastSeq, toast, clearToast]);

  if (toast === null) return null;
  return <div className="app-toast">{toast}</div>;
}
