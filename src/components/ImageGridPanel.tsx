import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { ImageViewer } from "./ImageViewer";

const MIN_CELL = 160; // セル最小幅(px)。これを基準に列数を決める。
const GAP = 6;
const NAME_H = 34; // ファイル名2行分の高さ(px)（line-height 1.3 × 11px × 2行 + 余白）

export function ImageGridPanel() {
  const results = useQueryStore((s) => s.results);
  const showFilename = useQueryStore((s) => s.showFilename);

  const selectedIndex = useViewerStore((s) => s.selectedIndex);
  const selectImage = useViewerStore((s) => s.select);
  const openViewer = useViewerStore((s) => s.open);

  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
  const cellSize = columns > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL;
  const rowCount = Math.ceil(results.length / columns);
  const rowHeight = cellSize + (showFilename ? NAME_H : 0) + GAP;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  if (width === 0) {
    return <div className="image-grid" ref={parentRef} />;
  }

  if (results.length === 0) {
    return (
      <div className="image-grid" ref={parentRef}>
        <p className="placeholder-note">該当する画像がありません</p>
      </div>
    );
  }

  return (
    <div
      className="image-grid"
      ref={parentRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && results[selectedIndex]) {
          e.preventDefault();
          openViewer(selectedIndex);
        }
      }}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vrow) => {
          const start = vrow.index * columns;
          const items = results.slice(start, start + columns);
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
              {items.map((img, col) => {
                const globalIndex = start + col;
                return (
                  <div
                    key={img.id}
                    className={
                      globalIndex === selectedIndex ? "thumb-cell selected" : "thumb-cell"
                    }
                    onClick={() => selectImage(globalIndex)}
                    onDoubleClick={() => openViewer(globalIndex)}
                  >
                    <div className="thumb-square" style={{ height: cellSize }}>
                      {img.thumb_path ? (
                        <img
                          src={convertFileSrc(img.thumb_path)}
                          alt={img.filename}
                          loading="lazy"
                        />
                      ) : (
                        <div className="thumb-missing">▦</div>
                      )}
                    </div>
                    {showFilename && (
                      <div className="thumb-name" title={img.filename}>
                        {img.filename}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <ImageViewer />
    </div>
  );
}
