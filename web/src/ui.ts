import type { CSSProperties } from "react";

export const buttonStyle: CSSProperties = {
  minHeight: "var(--tap)",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};

export const inputStyle: CSSProperties = {
  minHeight: "var(--tap)",
  padding: "0 12px",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
};
