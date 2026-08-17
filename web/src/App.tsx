import { useEffect, useState } from "react";
import { useQueryStore } from "./store/useQueryStore";
import { ImageGrid } from "./components/ImageGrid";
import { FilterBar } from "./components/FilterBar";
import { FilterSheet } from "./components/FilterSheet";

export function App() {
  const init = useQueryStore((s) => s.init);
  const [filterOpen, setFilterOpen] = useState(false);
  const [directoriesOpen, setDirectoriesOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <FilterBar onOpenFilter={() => setFilterOpen(true)} onOpenDirectories={() => setDirectoriesOpen(true)} />
      <ImageGrid />
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} />
      {directoriesOpen && (
        <div style={sheetStyle}>
          <span>場所（Task 9 で実装）</span>
          <button type="button" onClick={() => setDirectoriesOpen(false)} style={closeButtonStyle}>
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

const sheetStyle: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: `12px 12px env(safe-area-inset-bottom, 12px)`,
  background: "var(--surface-raised)",
  borderTop: "1px solid var(--border)",
  color: "var(--text)",
};

const closeButtonStyle: React.CSSProperties = {
  minHeight: "var(--tap)",
  minWidth: "var(--tap)",
  padding: "0 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};
