import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, onClose, children }: Props) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 10,
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--surface)",
          borderRadius: "12px 12px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "var(--surface)",
          }}
        >
          <strong>{title}</strong>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: "var(--tap)",
              minWidth: "var(--tap)",
              background: "none",
              border: "none",
              color: "var(--text)",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export const buttonStyle: React.CSSProperties = {
  minHeight: "var(--tap)",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};
