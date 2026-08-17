import { useEffect, useRef, useState } from "react";
import { historyNav, openItems } from "@gim/shared/historyNav";
import type { SortKey, SortDir } from "@gim/shared/types";
import { useQueryStore } from "../store/useQueryStore";
import { HistoryList } from "./HistoryList";
import { buttonStyle, inputStyle } from "../ui";
import { isPlainKey, isTypingTarget } from "../util/keys";

interface Props {
  onOpenFilter: () => void;
  onOpenDirectories: () => void;
}

/** historyNav が持ち回る状態。候補の算出も historyNav 側の責務。 */
interface NavState {
  open: boolean;
  index: number;
  items: string[];
  draft: string;
}

const CLOSED: NavState = { open: false, index: -1, items: [], draft: "" };

export function FilterBar({ onOpenFilter, onOpenDirectories }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const commitQuery = useQueryStore((s) => s.commitQuery);
  const history = useQueryStore((s) => s.history);
  const total = useQueryStore((s) => s.total);
  const sort = useQueryStore((s) => s.sort);
  const dir = useQueryStore((s) => s.dir);
  const setSort = useQueryStore((s) => s.setSort);
  const loading = useQueryStore((s) => s.loading);
  const [nav, setNav] = useState<NavState>(CLOSED);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPlainKey(e, "/") || isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const pick = (q: string) => {
    setQuery(q);
    setNav(CLOSED);
    void commitQuery();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setNav(CLOSED);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const res = historyNav({
        key: e.key,
        open: nav.open,
        index: nav.index,
        items: nav.items,
        query,
        draft: nav.draft,
        history,
      });
      setNav({ open: res.open, index: res.index, items: res.items, draft: res.draft });
      setQuery(res.query);
      return;
    }
    if (e.key === "Enter") {
      setNav(CLOSED);
      void commitQuery();
    }
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", alignItems: "center" }}>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          aria-label="検索"
          value={query}
          placeholder="検索"
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setNav({ open: true, index: -1, items: openItems(v, history), draft: v });
          }}
          onFocus={() =>
            setNav({ open: true, index: -1, items: openItems(query, history), draft: query })
          }
          onBlur={() => setNav(CLOSED)}
          onKeyDown={onKeyDown}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" onClick={onOpenFilter} style={barButton}>
          絞り込み
        </button>
        <button type="button" onClick={onOpenDirectories} style={barButton}>
          場所
        </button>
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "0 12px 8px",
          alignItems: "center",
          fontSize: 13,
          color: "var(--text-dim)",
        }}
      >
        <span>{total} 枚</span>
        <select
          value={`${sort}:${dir}`}
          onChange={(e) => {
            const [s, d] = e.target.value.split(":");
            void setSort(s as SortKey, d as SortDir);
          }}
          style={{
            minHeight: "var(--tap)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            font: "inherit",
          }}
        >
          <option value="created:desc">新しい順</option>
          <option value="created:asc">古い順</option>
          <option value="filename:asc">名前 昇順</option>
          <option value="filename:desc">名前 降順</option>
          <option value="modified:desc">更新が新しい順</option>
          <option value="modified:asc">更新が古い順</option>
        </select>
      </div>
      <div
        role="progressbar"
        aria-label="読み込み中"
        style={{
          height: loading ? 2 : 0,
          background: "var(--accent)",
        }}
      />
      {nav.open && <HistoryList items={nav.items} selected={nav.index} onPick={pick} />}
    </div>
  );
}

const barButton: React.CSSProperties = { ...buttonStyle, minWidth: "var(--tap)", padding: "0 12px" };
