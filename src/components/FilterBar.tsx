import { useEffect, useRef, useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { startSlideshow } from "../api/slideshow";
import { matchHistory } from "../util/historyMatch";
import type { SortKey } from "../types";
import { FilterDialog } from "./FilterDialog";

const SORT_LABELS: Record<SortKey, string> = {
  filename: "名前",
  created: "作成日時",
  modified: "更新日時",
};

export function FilterBar() {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const commitHistory = useQueryStore((s) => s.commitHistory);
  const history = useQueryStore((s) => s.history);
  const sort = useQueryStore((s) => s.sort);
  const dir = useQueryStore((s) => s.dir);
  const setSort = useQueryStore((s) => s.setSort);
  const total = useQueryStore((s) => s.total);
  const results = useQueryStore((s) => s.results);
  const selectedIndex = useViewerStore((s) => s.selectedIndex);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // 表示中のオートコンプリート候補（ナビゲーション中に揺れないよう凍結する）。
  const [acItems, setAcItems] = useState<string[]>([]);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  // ドロップダウンの外側クリックで閉じる。
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (historyWrapRef.current && !historyWrapRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [historyOpen]);

  const pickHistory = (h: string) => {
    setQuery(h);
    setHistoryOpen(false);
    setHistoryIndex(-1);
    void runQuery();
  };

  const submit = async () => {
    try {
      await runQuery();
      await commitHistory();
    } catch (e) {
      console.error("検索に失敗しました:", e);
    } finally {
      setHistoryOpen(false);
      setHistoryIndex(-1);
    }
  };

  const launchSlideshow = () => {
    if (results.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : 0;
    void startSlideshow(
      results.map((r) => r.path),
      start,
    ).catch((e) => console.error("スライドショー起動に失敗しました:", e));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (historyOpen && historyIndex >= 0 && acItems[historyIndex] !== undefined) {
        // ハイライト中の候補を確定して即検索。
        void pickHistory(acItems[historyIndex]);
      } else {
        void submit();
      }
    } else if (e.key === "Tab") {
      if (historyOpen && historyIndex >= 0 && acItems[historyIndex] !== undefined) {
        // 候補を入力欄に確定するだけ（検索しない）。
        e.preventDefault();
        setQuery(acItems[historyIndex]);
        setHistoryOpen(false);
        setHistoryIndex(-1);
      }
    } else if (e.key === "Escape") {
      if (historyOpen) {
        // ドロップダウンを閉じる（入力内容は保持）。
        e.preventDefault();
        setHistoryOpen(false);
        setHistoryIndex(-1);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      // 候補が未確定なら、現在の入力に対するマッチ（空なら全履歴）で開く。
      let items = acItems;
      if (!historyOpen || items.length === 0) {
        items = query.trim() === "" ? history : matchHistory(query, history);
        setAcItems(items);
        setHistoryOpen(items.length > 0);
      }
      if (items.length === 0) return;
      const next = Math.min(historyIndex + 1, items.length - 1);
      setHistoryIndex(next);
      setQuery(items[next]);
    } else if (e.key === "ArrowDown" && historyIndex > -1) {
      e.preventDefault();
      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setQuery(next === -1 ? "" : acItems[next]);
    } else if (e.key === "Home") {
      // macOS の WebKit では Home が効かないため、行頭へカーソル移動（Shiftで選択）。
      e.preventDefault();
      const el = e.currentTarget;
      if (e.shiftKey) {
        el.setSelectionRange(0, el.selectionEnd ?? 0, "backward");
      } else {
        el.setSelectionRange(0, 0);
      }
    } else if (e.key === "End") {
      // 同上。行末へカーソル移動（Shiftで選択）。
      e.preventDefault();
      const el = e.currentTarget;
      const len = el.value.length;
      if (e.shiftKey) {
        el.setSelectionRange(el.selectionStart ?? len, len, "forward");
      } else {
        el.setSelectionRange(len, len);
      }
    }
  };

  return (
    <div className="filter-bar">
      <input
        className="filter-input"
        value={query}
        placeholder='例: prompt:1girl rating:>=4 -blurry'
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setHistoryIndex(-1);
          // 非空入力かつマッチ候補が1件以上ある間だけ自動表示する。
          const items = v.trim() === "" ? [] : matchHistory(v, history);
          setAcItems(items);
          setHistoryOpen(items.length > 0);
        }}
        onKeyDown={onKeyDown}
        aria-label="フィルタクエリ"
      />
      <div className="history-wrap" ref={historyWrapRef}>
        <button
          className="history-btn"
          onClick={() =>
            setHistoryOpen((o) => {
              const nextOpen = !o;
              if (nextOpen) {
                // 全件ブラウズ: 現在の入力に関係なく全履歴を表示する。
                setAcItems(history);
                setHistoryIndex(-1);
              }
              return nextOpen;
            })
          }
          disabled={history.length === 0}
          aria-label="検索履歴"
          aria-expanded={historyOpen}
        >
          ▾
        </button>
        {historyOpen && acItems.length > 0 && (
          <ul className="history-dropdown">
            {acItems.map((h, i) => (
              <li key={h}>
                <button
                  className={i === historyIndex ? "active" : ""}
                  onClick={() => pickHistory(h)}
                  title={h}
                >
                  {h}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={() => void submit()} aria-label="検索">
        検索
      </button>
      <button onClick={() => setDialogOpen(true)} aria-label="詳細フィルタを開く">詳細…</button>
      <button
        onClick={launchSlideshow}
        disabled={results.length === 0}
        aria-label="スライドショーを開始"
      >
        スライドショー▶
      </button>
      <label className="sort-control">
        並べ替え:
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey, dir)}
          aria-label="ソートキー"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSort(sort, dir === "asc" ? "desc" : "asc")}
          aria-label="昇順降順切替"
        >
          {dir === "asc" ? "↑" : "↓"}
        </button>
      </label>
      <span className="result-count">{total} 件</span>
      {dialogOpen && <FilterDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
