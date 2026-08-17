import { useEffect } from "react";
import { useQueryStore } from "./store/useQueryStore";
import { ImageGrid } from "./components/ImageGrid";

export function App() {
  const init = useQueryStore((s) => s.init);
  const total = useQueryStore((s) => s.total);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: `env(safe-area-inset-top, 0px) 12px 8px`,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{total} 枚</span>
      </header>
      <ImageGrid />
    </div>
  );
}
