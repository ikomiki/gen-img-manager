import { useEffect, useRef, useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { startSlideshow } from "../api/slideshow";
import { matchHistory } from "../util/historyMatch";
import { historyNav } from "../util/historyNav";
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
  const showFilename = useQueryStore((s) => s.showFilename);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // 表示中のオートコンプリート候補（ナビゲーション中に揺れないよう凍結する）。
  const [acItems, setAcItems] = useState<string[]>([]);
  // 履歴ブラウズに入る前のユーザー入力（解除/キャンセル時に復元する）。
  const [draft, setDraft] = useState("");
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ドロップダウンの外側クリックで閉じる。
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
        setHistoryIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [historyOpen]);

  // 履歴項目を確定し、入力欄へフォーカスを戻す（キャレットは末尾）。
  const pickHistory = (h: string) => {
    setQuery(h);
    setHistoryOpen(false);
    setHistoryIndex(-1);
    void runQuery();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(h.length, h.length);
    });
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
      results.map((r) => r.id),
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
        // ブラウズをキャンセル: 閉じてドラフトへ復元。
        e.preventDefault();
        setHistoryOpen(false);
        setHistoryIndex(-1);
        setQuery(draft);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // 履歴ナビゲーション（次状態は純粋関数で計算）。
      e.preventDefault();
      const res = historyNav({
        key: e.key,
        open: historyOpen,
        index: historyIndex,
        items: acItems,
        query,
        draft,
        history,
      });
      setHistoryOpen(res.open);
      setHistoryIndex(res.index);
      setAcItems(res.items);
      setQuery(res.query);
      setDraft(res.draft);
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
      <div className="fb-group-input">
        <div className="filter-combo" ref={comboRef}>
          <div className="filter-input-wrap">
            <input
              ref={inputRef}
              className="filter-input"
              value={query}
              placeholder='例: prompt:1girl rating:>=4 -blurry'
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                setDraft(v);
                setHistoryIndex(-1);
                // 非空入力かつマッチ候補が1件以上ある間だけ自動表示する。
                const items = v.trim() === "" ? [] : matchHistory(v, history);
                setAcItems(items);
                setHistoryOpen(items.length > 0);
              }}
              onKeyDown={onKeyDown}
              aria-label="フィルタクエリ"
            />
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
          <button
            className="history-btn"
            onClick={() => {
              const nextOpen = !historyOpen;
              setHistoryOpen(nextOpen);
              setHistoryIndex(-1);
              if (nextOpen) {
                // 全件ブラウズ: 現在の入力に関係なく全履歴を表示する。
                setDraft(query);
                setAcItems(history);
              }
            }}
            disabled={history.length === 0}
            aria-label="検索履歴"
            aria-expanded={historyOpen}
          >
            ▾
          </button>
        </div>
        <button onClick={() => setDialogOpen(true)} aria-label="詳細フィルタを開く">詳細…</button>
      </div>
      <div className="fb-group-actions">
        <button onClick={() => void submit()} aria-label="検索">
          検索
        </button>
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
        <button
          className="filename-toggle"
          onClick={() => void toggleShowFilename()}
          aria-pressed={showFilename}
        >
          ファイル名{showFilename ? "：表示" : "：非表示"}
        </button>
      </div>
      {dialogOpen && <FilterDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
