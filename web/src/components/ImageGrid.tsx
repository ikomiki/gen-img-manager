import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryStore } from "../store/useQueryStore";
import { thumbUrl } from "../api/images";
import { gridLayout } from "../util/gridLayout";
import { buttonStyle } from "../ui";

const MIN_CELL = 110;
const GAP = 4;

export function ImageGrid() {
  const results = useQueryStore((s) => s.results);
  const loadMore = useQueryStore((s) => s.loadMore);
  const exhausted = useQueryStore((s) => s.exhausted);
  const error = useQueryStore((s) => s.error);

  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { columns, cell } = gridLayout(width, MIN_CELL, GAP);
  const rowCount = Math.ceil(results.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cell + GAP,
    overscan: 4,
  });

  // estimateSize は測定メモの依存に含まれないため、cell が変わっても再計算されない（@tanstack/virtual-core）。
  useEffect(() => {
    rowVirtualizer.measure();
  }, [cell]);

  // 末尾付近まで来たら次のページを取る。
  const items = rowVirtualizer.getVirtualItems();
  const lastRow = items.length > 0 ? items[items.length - 1].index : 0;
  useEffect(() => {
    if (!exhausted && rowCount > 0 && lastRow >= rowCount - 3) {
      void loadMore();
    }
  }, [lastRow, rowCount, exhausted, loadMore]);

  if (error && results.length === 0) {
    return <p style={{ padding: 16, color: "var(--text-dim)" }}>読み込みに失敗しました: {error}</p>;
  }

  return (
    <div
      ref={parentRef}
      style={{
        flex: 1,
        overflowY: "auto",
        background: "var(--bg-media)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vrow) => {
          const start = vrow.index * columns;
          const rowItems = results.slice(start, start + columns);
          return (
            <div
              key={vrow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vrow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowItems.map((img) => (
                <img
                  key={img.id}
                  src={thumbUrl(img.id)}
                  alt={img.filename}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    display: "block",
                    background: "var(--surface)",
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {error && (
        <div style={{ padding: 16, textAlign: "center", color: "var(--text-dim)" }}>
          <p>追加の読み込みに失敗しました: {error}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            style={{ ...buttonStyle, minWidth: "var(--tap)", padding: "0 16px" }}
          >
            再試行
          </button>
        </div>
      )}
    </div>
  );
}
