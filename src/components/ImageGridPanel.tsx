import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { moveIndex } from "../util/gridNav";
import { nextUnratedIndex } from "../util/ratingNav";
import { ContextMenu } from "./ContextMenu";
import type { MenuEntry } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
import { revealInFinder } from "../api/images";
import { startSlideshow } from "../api/slideshow";

const MIN_CELL = 160; // セル最小幅(px)。これを基準に列数を決める。
const GAP = 6;
const NAME_H = 34; // ファイル名2行分の高さ(px)（line-height 1.3 × 11px × 2行 + 余白）

export function ImageGridPanel() {
  const results = useQueryStore((s) => s.results);
  const showFilename = useQueryStore((s) => s.showFilename);
  const setRating = useQueryStore((s) => s.setRating);
  const ratingMode = useQueryStore((s) => s.ratingMode);
  const unratedOnly = useQueryStore((s) => s.unratedOnly);
  const { menuState, showMenu, closeMenu } = useContextMenu();

  const selectedIndex = useViewerStore((s) => s.selectedIndex);
  const selectImage = useViewerStore((s) => s.select);
  const openViewer = useViewerStore((s) => s.open);
  const viewerOpen = useViewerStore((s) => s.isOpen);

  const parentRef = useRef<HTMLDivElement>(null);
  const wasViewerOpen = useRef(false);
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

  // ビューアを閉じたら一覧にフォーカスを戻し、選択中の画像へスクロール追従する。
  useEffect(() => {
    if (wasViewerOpen.current && !viewerOpen) {
      parentRef.current?.focus();
      if (selectedIndex >= 0) {
        rowVirtualizer.scrollToIndex(Math.floor(selectedIndex / columns));
      }
    }
    wasViewerOpen.current = viewerOpen;
  }, [viewerOpen, selectedIndex, columns, rowVirtualizer]);

  // グリッドのキーボード操作（ウィンドウレベル。コンテナのフォーカス有無に依存しない）。
  // テキスト入力やボタン等にフォーカスがある場合、およびビューア表示中は無効化する。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerOpen) return;
      // フォーカスが body / グリッド以外（入力欄・ボタン・select 等）にある場合は委ねる。
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== parentRef.current) return;
      const len = results.length;
      if (len === 0) return;
      const cur = selectedIndex < 0 ? 0 : selectedIndex;
      let nextIndex: number | null = null;
      // 1 ページ＝表示中の行数 × 列数。コンテナ高さから可視行数を見積もる。
      const visibleRows = Math.max(
        1,
        Math.floor((parentRef.current?.clientHeight ?? rowHeight) / rowHeight),
      );
      const pageDelta = visibleRows * columns;
      switch (e.key) {
        case "ArrowRight":
          nextIndex = Math.min(cur + 1, len - 1);
          break;
        case "ArrowLeft":
          nextIndex = Math.max(cur - 1, 0);
          break;
        case "ArrowDown":
          // 上下は表示行（列数分）で移動。
          nextIndex = Math.min(cur + columns, len - 1);
          break;
        case "ArrowUp":
          nextIndex = Math.max(cur - columns, 0);
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = len - 1;
          break;
        case "PageDown":
          nextIndex = moveIndex(cur, len, pageDelta);
          break;
        case "PageUp":
          nextIndex = moveIndex(cur, len, -pageDelta);
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5": {
          e.preventDefault();
          const target = results[cur];
          if (target) {
            const rating = e.key === "0" ? null : Number(e.key);
            void setRating(target.id, rating);
            if (ratingMode && unratedOnly && rating !== null) {
              const ni = nextUnratedIndex(results, cur);
              if (ni >= 0) {
                selectImage(ni);
                rowVirtualizer.scrollToIndex(Math.floor(ni / columns));
              }
            }
          }
          return;
        }
        case "o":
        case "O": {
          e.preventDefault();
          const target = results[cur];
          if (target) {
            void revealInFinder(target.path).catch((e) =>
              console.error("Finderで表示に失敗しました:", e),
            );
          }
          return;
        }
        case "c":
        case "C": {
          e.preventDefault();
          const target = results[cur];
          if (target) {
            void navigator.clipboard
              .writeText(target.path)
              .catch((e) => console.error("パスのコピーに失敗しました:", e));
          }
          return;
        }
        case "Enter":
          // ダブルクリックと同様に、選択中（未選択なら先頭）の画像を表示する。
          e.preventDefault();
          openViewer(cur);
          return;
        default:
          return;
      }
      e.preventDefault();
      selectImage(nextIndex);
      // 選択行を表示に追従させる。
      rowVirtualizer.scrollToIndex(Math.floor(nextIndex / columns));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer, setRating, ratingMode, unratedOnly]);

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
    <>
    <div className="image-grid" ref={parentRef} tabIndex={0}
      onContextMenu={(e) => {
        e.preventDefault();
        if (selectedIndex < 0 || !results[selectedIndex]) return;
        showMenu(e.clientX, e.clientY, results[selectedIndex].id);
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
                    onClick={() => {
                      selectImage(globalIndex);
                      // クリックでグリッドへフォーカスを移し、Enter/カーソルキーを有効にする。
                      parentRef.current?.focus();
                    }}
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
                    {(img.rating ?? 0) > 0 && (
                      <div
                        className="thumb-rating"
                        role="img"
                        aria-label={`レーティング ${img.rating}`}
                      >
                        {"★".repeat(img.rating!)}
                      </div>
                    )}
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
    </div>
      {menuState.open && results[selectedIndex] && (() => {
        const target = results[selectedIndex];
        const menuItems: MenuEntry[] = [
          {
            label: "ビューアで開く",
            onClick: () => {
              openViewer(selectedIndex);
              closeMenu();
            },
          },
          {
            label: "スライドショー開始",
            onClick: () => {
              void startSlideshow(
                results.map((r) => r.path),
                results.map((r) => r.id),
                selectedIndex,
              ).catch((e) => console.error("スライドショー起動に失敗しました:", e));
              closeMenu();
            },
          },
          { separator: true as const },
          {
            label: "Finderで表示",
            shortcut: "O",
            onClick: () => {
              void revealInFinder(target.path).catch((e) =>
                console.error("Finderで表示に失敗しました:", e),
              );
              closeMenu();
            },
          },
          {
            label: "パスをコピー",
            shortcut: "C",
            onClick: () => {
              void navigator.clipboard
                .writeText(target.path)
                .catch((e) => console.error("パスのコピーに失敗しました:", e));
              closeMenu();
            },
          },
        ];
        return (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            items={menuItems}
          />
        );
      })()}
    </>
  );
}
