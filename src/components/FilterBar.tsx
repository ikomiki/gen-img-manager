import { useEffect, useRef, useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  // 履歴ドロップダウンの外側クリックで閉じる。
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
      setHistoryIndex(-1);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void submit();
    } else if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setQuery(history[next]);
    } else if (e.key === "ArrowDown" && historyIndex > -1) {
      e.preventDefault();
      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setQuery(next === -1 ? "" : history[next]);
    }
  };

  return (
    <div className="filter-bar">
      <input
        className="filter-input"
        value={query}
        placeholder='例: prompt:1girl rating:>=4 -blurry'
        onChange={(e) => {
          setQuery(e.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={onKeyDown}
        aria-label="フィルタクエリ"
      />
      <div className="history-wrap" ref={historyWrapRef}>
        <button
          className="history-btn"
          onClick={() => setHistoryOpen((o) => !o)}
          disabled={history.length === 0}
          aria-label="検索履歴"
          aria-expanded={historyOpen}
        >
          ▾
        </button>
        {historyOpen && history.length > 0 && (
          <ul className="history-dropdown">
            {history.map((h) => (
              <li key={h}>
                <button onClick={() => pickHistory(h)} title={h}>
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
