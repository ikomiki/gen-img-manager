import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { moveIndex } from "../util/gridNav";
import { nextUnratedIndex } from "../util/ratingNav";
import { hasPrimaryModifier } from "../util/platform";
import { ContextMenu } from "./ContextMenu";
import type { MenuEntry } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { clampAfterDelete } from "../util/selection";
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
  const openViewer = useViewerStore((s) => s.open);
  const viewerOpen = useViewerStore((s) => s.isOpen);

  const selection = useViewerStore((s) => s.selection);
  const selectSingle = useViewerStore((s) => s.selectSingle);
  const toggleSelect = useViewerStore((s) => s.toggleSelect);
  const selectRange = useViewerStore((s) => s.selectRange);
  const selectAll = useViewerStore((s) => s.selectAll);
  const clearSelection = useViewerStore((s) => s.clearSelection);
  const resetSelection = useViewerStore((s) => s.resetSelection);
  const rateSelected = useQueryStore((s) => s.rateSelected);
  const deleteSelected = useQueryStore((s) => s.deleteSelected);

  const parentRef = useRef<HTMLDivElement>(null);
  const wasViewerOpen = useRef(false);
  const [width, setWidth] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      // Cmd/Ctrl+A: 全選択。
      if (hasPrimaryModifier(e) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAll(len);
        return;
      }
      // 削除キー（修飾キー有無を問わず）: 選択をゴミ箱（確認ダイアログ）。
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (targetCount() > 0) setConfirmOpen(true);
        return;
      }
      // Esc: 選択を単一に戻す。
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }
      // 上記以外で Cmd/Ctrl 併用は標準動作へ委ねる（Cmd+C のコピー等）。
      if (hasPrimaryModifier(e)) return;
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
          const rating = e.key === "0" ? null : Number(e.key);
          if (selection.size > 1) {
            // 複数選択中は一括適用（auto-advance はしない）。
            void rateSelected(targetIds(), rating);
          } else {
            const target = results[cur];
            if (target) {
              void setRating(target.id, rating);
              if (ratingMode && unratedOnly && rating !== null) {
                const ni = nextUnratedIndex(results, cur);
                if (ni >= 0) {
                  selectSingle(ni);
                  rowVirtualizer.scrollToIndex(Math.floor(ni / columns));
                }
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
      if (e.shiftKey) selectRange(nextIndex);
      else selectSingle(nextIndex);
      // 選択行を表示に追従させる。
      rowVirtualizer.scrollToIndex(Math.floor(nextIndex / columns));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen, results, selectedIndex, selection, columns, rowHeight, selectSingle, selectRange, selectAll, clearSelection, openViewer, rowVirtualizer, setRating, rateSelected, ratingMode, unratedOnly]);

  // selection（index 集合）→ 対象 id / {id,path}。selection が空ならアクティブ 1 件。
  const targetIds = (): number[] => {
    if (selection.size > 0) {
      return [...selection].map((i) => results[i]?.id).filter((v): v is number => v != null);
    }
    const cur = selectedIndex < 0 ? 0 : selectedIndex;
    return results[cur] ? [results[cur].id] : [];
  };
  const targetItems = (): { id: number; path: string }[] => {
    const idxs = selection.size > 0 ? [...selection] : [selectedIndex < 0 ? 0 : selectedIndex];
    return idxs
      .map((i) => results[i])
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => ({ id: r.id, path: r.path }));
  };
  const targetCount = (): number =>
    selection.size > 0 ? selection.size : results[selectedIndex < 0 ? 0 : selectedIndex] ? 1 : 0;
  const minSelectedIndex = (): number =>
    selection.size > 0 ? Math.min(...selection) : selectedIndex < 0 ? 0 : selectedIndex;

  const doDelete = async () => {
    const items = targetItems();
    if (items.length === 0) {
      setConfirmOpen(false);
      return;
    }
    const minIndex = minSelectedIndex();
    setDeleting(true);
    try {
      await deleteSelected(items);
    } catch (e) {
      console.error("一括削除に失敗しました:", e);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
    const remaining = useQueryStore.getState().results.length;
    resetSelection(clampAfterDelete(minIndex, remaining));
  };

  const rateFromBar = (rating: number | null) => {
    const ids = targetIds();
    if (ids.length > 0) void rateSelected(ids, rating);
  };

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
      {selection.size >= 1 && (
        <div className="selection-bar">
          <span className="selection-count">{selection.size}件選択中</span>
          <span className="selection-rating">
            <span className="selection-rating-label">レーティング:</span>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="selection-rate-btn"
                onClick={() => rateFromBar(n === 0 ? null : n)}
              >
                {n === 0 ? "クリア" : `★${n}`}
              </button>
            ))}
          </span>
          <button type="button" className="danger-btn" onClick={() => setConfirmOpen(true)}>
            ゴミ箱へ移動
          </button>
          <button type="button" onClick={() => clearSelection()}>
            選択解除
          </button>
        </div>
      )}
    <div className="image-grid" ref={parentRef} tabIndex={0}
      onContextMenu={(e) => {
        e.preventDefault();
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
                    className={[
                      "thumb-cell",
                      globalIndex === selectedIndex ? "selected" : "",
                      selection.has(globalIndex) ? "in-selection" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) toggleSelect(globalIndex);
                      else if (e.shiftKey) selectRange(globalIndex);
                      else selectSingle(globalIndex);
                      // クリックでグリッドへフォーカスを移し、Enter/カーソルキーを有効にする。
                      parentRef.current?.focus();
                    }}
                    onDoubleClick={() => openViewer(globalIndex)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // 選択外を右クリックしたらその項目を単一選択（Finder 標準挙動）。
                      if (!selection.has(globalIndex)) selectSingle(globalIndex);
                      parentRef.current?.focus();
                      showMenu(e.clientX, e.clientY, globalIndex);
                    }}
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
        const count = selection.size;
        const ids = targetIds();
        const menuItems: MenuEntry[] = [];
        if (count > 1) {
          menuItems.push(
            {
              label: "レーティング: クリア",
              onClick: () => {
                void rateSelected(ids, null);
                closeMenu();
              },
            },
            ...[1, 2, 3, 4, 5].map((n) => ({
              label: `レーティング: ★${n}`,
              onClick: () => {
                void rateSelected(ids, n);
                closeMenu();
              },
            })),
            { separator: true as const },
            {
              label: `ゴミ箱へ移動（${count}件）`,
              onClick: () => {
                closeMenu();
                setConfirmOpen(true);
              },
            },
          );
        } else {
          menuItems.push(
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
                  results.map((r) => r.rating),
                  selectedIndex,
                ).catch((err) => console.error("スライドショー起動に失敗しました:", err));
                closeMenu();
              },
            },
            { separator: true as const },
            {
              label: "Finderで表示",
              shortcut: "O",
              onClick: () => {
                void revealInFinder(target.path).catch((err) =>
                  console.error("Finderで表示に失敗しました:", err),
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
                  .catch((err) => console.error("パスのコピーに失敗しました:", err));
                closeMenu();
              },
            },
            { separator: true as const },
            {
              label: "ゴミ箱へ移動",
              onClick: () => {
                closeMenu();
                setConfirmOpen(true);
              },
            },
          );
        }
        return (
          <ContextMenu x={menuState.x} y={menuState.y} onClose={closeMenu} items={menuItems} />
        );
      })()}
      {confirmOpen && (
        <ConfirmDialog
          title="ゴミ箱へ移動"
          body={`${targetCount()}件をゴミ箱に移動しますか？`}
          confirmLabel="ゴミ箱へ移動"
          busy={deleting}
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
