# フィルタ履歴UX調整（スペルチェック無効化・直下表示・↓で履歴遷移・選択時フォーカス）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フィルタ入力欄のmacOS標準スペルチェック/補完を無効化し、履歴ドロップダウンを入力欄直下に表示し、↑↓を一般的なコンボボックス方式（↓で履歴に遷移）へ作り直し、履歴選択時に入力欄へフォーカスを戻す。

**Architecture:** 変更はフロントエンドのみ（`src/components/FilterBar.tsx` と `src/App.css`）。複雑な↑↓ナビゲーションの「次状態計算」を純粋関数 `src/util/historyNav.ts` に切り出してユニットテストし、コンポーネントはそれを呼ぶだけにする。候補マッチは既存の `matchHistory` を流用。属性付与・レイアウト・フォーカスは型チェック＋手動検証。

**Tech Stack:** Tauri 2（WKWebView/macOS）, React 19, Zustand 5, TypeScript（strict, `noEmit`）, Vitest。

**前提（合意済み仕様）:**
- 要件1: 自由テキスト入力 `.filter-input` に `spellCheck={false}` / `autoCorrect="off"` / `autoCapitalize="off"` / `autoComplete="off"` を付与。自作の履歴オートコンプリートには影響させない。
- 要件2: 履歴ドロップダウンを `▾` ボタン基準から**入力欄の直下**へ。横幅は入力欄に一致、`position:absolute` のオーバーレイ。`▾` ボタンは存続（入力欄の右隣）。
- 要件3: ↑↓を作り直す。候補は入力でフィルタ（空なら全履歴）。↓（閉/未選択）=開いて先頭（最新）／↑（閉/未選択）=開いて末尾（最古）。開いている時 ↓=古い方へ（末尾クランプ・-1からは0へ）、↑=新しい方へ（先頭からさらに上で選択解除し**ドラフト復元**）。ナビ中は入力欄に候補（解除時はドラフト）をプレビュー。Escはブラウズをキャンセルしてドラフト復元。打鍵で通常補完に戻る。
- 要件4: 履歴項目をクリック確定（`pickHistory`）した時、入力欄に反映＋閉じる＋**即検索実行**＋**入力欄へフォーカス（キャレット末尾）**。

**作業ブランチ:** 前ブランチ `feature/plan6-viewer-filter-prefs`（統合保留中）の続きとして同ブランチ上で実装する。

---

## File Structure

**新規作成:**
- `src/util/historyNav.ts` — ↑↓ナビゲーションの次状態を計算する純粋関数 `historyNav`。`matchHistory` を内部利用。
- `src/util/historyNav.test.ts` — `historyNav` のユニットテスト。

**変更:**
- `src/components/FilterBar.tsx` — 入力属性（要件1）、`historyNav`/`draft` 連携（要件3）、クリック確定時のフォーカス（要件4）、ドロップダウンを入力欄直下に置くJSX構造（要件2）。
- `src/App.css` — 入力欄直下表示のためのレイアウトスタイル（要件2）。

**変更不要:** ストア・Rust側・`matchHistory`（流用のみ）。

---

## Task 1: historyNav 純粋関数（要件3コア）

**Files:**
- Create: `src/util/historyNav.ts`
- Test: `src/util/historyNav.test.ts`

Vitest単一ファイル: `npx vitest run <path>`。型チェック: `npx tsc -p tsconfig.json`。

- [ ] **Step 1: 失敗するテストを書く**

`src/util/historyNav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { historyNav } from "./historyNav";

const HISTORY = ["newest", "middle", "oldest"]; // index 0 = 最新

const base = {
  open: false,
  index: -1,
  items: [] as string[],
  query: "",
  draft: "",
  history: HISTORY,
};

describe("historyNav — 閉じた状態から開く", () => {
  it("ArrowDown は開いて先頭(最新)をハイライトし、現在の入力を draft に保持する", () => {
    const r = historyNav({ ...base, key: "ArrowDown" });
    expect(r).toEqual({
      open: true,
      index: 0,
      items: HISTORY,
      query: "newest",
      draft: "",
    });
  });

  it("ArrowUp は開いて末尾(最古)をハイライトする", () => {
    const r = historyNav({ ...base, key: "ArrowUp" });
    expect(r.open).toBe(true);
    expect(r.index).toBe(2);
    expect(r.query).toBe("oldest");
  });

  it("開く時に現在の入力を draft として捕捉し、入力でフィルタする", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "mid" });
    expect(r.items).toEqual(["middle"]);
    expect(r.index).toBe(0);
    expect(r.query).toBe("middle");
    expect(r.draft).toBe("mid");
  });

  it("候補が無い時は状態を変えない", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "zzz" });
    expect(r).toEqual({ open: false, index: -1, items: [], query: "zzz", draft: "" });
  });

  it("入力が空白のみなら全履歴を使う", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "  " });
    expect(r.items).toEqual(HISTORY);
  });
});

describe("historyNav — 開いた状態でのナビゲーション", () => {
  const open = { ...base, open: true, items: HISTORY, draft: "draft" };

  it("ArrowDown は古い方へ進み、末尾でクランプする", () => {
    expect(historyNav({ ...open, key: "ArrowDown", index: 0 }).index).toBe(1);
    expect(historyNav({ ...open, key: "ArrowDown", index: 2 }).index).toBe(2);
  });

  it("ArrowDown は選択解除(-1)から先頭(0)へ", () => {
    const r = historyNav({ ...open, key: "ArrowDown", index: -1 });
    expect(r.index).toBe(0);
    expect(r.query).toBe("newest");
  });

  it("ArrowUp は新しい方へ進む", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: 2 });
    expect(r.index).toBe(1);
    expect(r.query).toBe("middle");
  });

  it("ArrowUp は先頭(0)からさらに上で選択解除し draft を復元する", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: 0 });
    expect(r.index).toBe(-1);
    expect(r.query).toBe("draft");
  });

  it("ArrowUp は選択解除(-1)では解除のまま draft を表示する", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: -1 });
    expect(r.index).toBe(-1);
    expect(r.query).toBe("draft");
  });

  it("プレビューはハイライト中の候補を反映する", () => {
    expect(historyNav({ ...open, key: "ArrowDown", index: 0 }).query).toBe("middle");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/historyNav.test.ts`
Expected: FAIL（`historyNav` 未定義）。

- [ ] **Step 3: 最小実装を書く**

`src/util/historyNav.ts`:
```ts
import { matchHistory } from "./historyMatch";

export type NavKey = "ArrowDown" | "ArrowUp";

export interface NavInput {
  key: NavKey;
  open: boolean;
  index: number;
  items: string[];
  query: string;
  draft: string;
  history: string[];
}

export interface NavResult {
  open: boolean;
  index: number;
  items: string[];
  query: string;
  draft: string;
}

/** 矢印で開く時にリストへ出す候補。入力が空なら全履歴、そうでなければマッチ候補。 */
function openItems(query: string, history: string[]): string[] {
  return query.trim() === "" ? history : matchHistory(query, history);
}

/**
 * フィルタ入力欄での ↑/↓ による履歴ナビゲーションの次状態を計算する純粋関数。
 * - 閉じている（または候補が空）なら開く: ↓は先頭(最新)、↑は末尾(最古)をハイライト。
 *   このとき現在の入力を draft として保持する。
 * - 開いているなら: ↓は1つ下(古い方)へ、末尾でクランプ。-1からは0へ。
 *   ↑は1つ上(新しい方)へ、先頭(0)からさらに上で選択解除(index=-1)し draft を復元。
 * - ナビ中は入力欄に候補（解除時は draft）をプレビュー表示する（query で返す）。
 */
export function historyNav(input: NavInput): NavResult {
  const { key, open, index, items, query, draft, history } = input;

  if (!open || items.length === 0) {
    const fresh = openItems(query, history);
    if (fresh.length === 0) {
      return { open, index, items, query, draft };
    }
    const newIndex = key === "ArrowDown" ? 0 : fresh.length - 1;
    return {
      open: true,
      index: newIndex,
      items: fresh,
      query: fresh[newIndex],
      draft: query,
    };
  }

  if (key === "ArrowDown") {
    const next = index < 0 ? 0 : Math.min(index + 1, items.length - 1);
    return { open: true, index: next, items, query: items[next], draft };
  }

  // ArrowUp（開いている）
  const next = Math.max(index - 1, -1);
  return {
    open: true,
    index: next,
    items,
    query: next === -1 ? draft : items[next],
    draft,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/historyNav.test.ts`
Expected: PASS（全12ケース）。
Run: `npx tsc -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 5: コミット**

```bash
git add src/util/historyNav.ts src/util/historyNav.test.ts
git commit -m "feat(filter): add historyNav pure function for combobox-style navigation"
```

---

## Task 2: FilterBar 配線（要件1・3・4 と要件2のJSX構造）

**Files:**
- Modify: `src/components/FilterBar.tsx`

DOM/UI挙動のため検証は型チェック＋手動。`src/util/historyNav.ts`（Task 1）に依存。

- [ ] **Step 1: FilterBar.tsx を全面更新する**

`src/components/FilterBar.tsx` を次の内容で置き換える。

```tsx
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
```

主な変更点: `historyNav`/`matchHistory` をインポート。`draft` 状態と `inputRef` を追加。外側クリック用 ref を `comboRef`（コンボ全体）へ。↑↓を `historyNav` 1本に統合。Escでドラフト復元。`pickHistory` で `requestAnimationFrame` 後に入力欄フォーカス＋キャレット末尾。入力欄に4属性（要件1）。JSXを `filter-combo > (filter-input-wrap > input + dropdown) + ▾button` 構造へ（要件2の土台）。

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc -p tsconfig.json`
Expected: exit 0、出力なし（`noUnusedLocals` のため未使用変数なしも担保。旧 `historyWrapRef` を残していないこと）。

- [ ] **Step 3: 手動検証（挙動）**

Run: `npm run tauri dev`
事前に履歴を数件作る。確認手順:
1. 入力欄でmacOSのスペルチェック赤波線・自動修正・補完候補が出ないこと。
2. 空欄で ↓ → 履歴が開き先頭（最新）がハイライト＋入力欄にプレビュー。さらに↓で古い方へ、末尾でクランプ。
3. 空欄で ↑ → 末尾（最古）がハイライト。↑で新しい方へ、先頭からさらに↑で選択解除され、入力欄が元の入力（空）に戻る。
4. 何か入力（例 `1girl`）→ 候補が出る。↓で候補に入り、↑で先頭から戻ると入力した `1girl` が復元される（ドラフト復元）。
5. ナビ中に Escape → 閉じて入力が元のドラフトに戻る。
6. ナビ中に文字を打つ → 通常のタイプ補完に戻る。
7. 候補をマウスでクリック → 検索が実行され、入力欄にフォーカスが戻りキャレットが末尾にある。
8. Tab（候補ハイライト中）→ 入力欄に確定するが検索は実行されない。

- [ ] **Step 4: コミット**

```bash
git add src/components/FilterBar.tsx
git commit -m "feat(filter): combobox arrow nav, disable native spellcheck/autocomplete, focus input on pick"
```

---

## Task 3: 履歴ドロップダウンを入力欄直下に表示するCSS（要件2）

**Files:**
- Modify: `src/App.css`

Task 2 のJSX構造（`.filter-combo` / `.filter-input-wrap`）に対応するスタイル。検証はビルド＋手動。

- [ ] **Step 1: `.filter-input` を幅100%にする**

`src/App.css` の `.filter-input`（99行付近）。
変更前:
```css
.filter-input {
  flex: 1;
  box-sizing: border-box;
  padding: 6px 8px;
}
```
変更後:
```css
.filter-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
}
```

- [ ] **Step 2: `.history-wrap` を `.filter-combo` / `.filter-input-wrap` に置き換える**

`src/App.css` の `.history-wrap` ブロック（389行付近）。
変更前:
```css
.history-wrap {
  position: relative;
  flex-shrink: 0;
}
```
変更後:
```css
.filter-combo {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.filter-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 3: ドロップダウンを入力欄幅・直下に合わせる**

`src/App.css` の `.history-dropdown` ブロック末尾（409-411行付近）。
変更前:
```css
  max-height: 280px;
  overflow-y: auto;
  min-width: 240px;
}
```
変更後:
```css
  max-height: 280px;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
}
```
（`top: 100%; left: 0;` は変更せず。基準が `.filter-input-wrap` になるため入力欄の直下に出る。）

- [ ] **Step 4: ドロップダウン項目の最大幅を入力欄幅に合わせる**

`src/App.css` の `.history-dropdown li button`（424行付近）。
変更前:
```css
  text-overflow: ellipsis;
  max-width: 360px;
}
```
変更後:
```css
  text-overflow: ellipsis;
  max-width: 100%;
}
```

- [ ] **Step 5: 本番ビルドで確認**

Run: `npm run build`
Expected: `tsc` 成功 → `vite build` 成功（エラーなし）。

- [ ] **Step 6: 手動検証（レイアウト）**

Run: `npm run tauri dev`
確認手順:
1. 履歴ドロップダウン（↓キー/▾ボタン/タイプいずれでも）が**入力欄の真下**に、**入力欄と同じ横幅**で表示される。
2. `▾` ボタンは入力欄の右隣に残り、押すと全履歴が入力欄直下に開く。
3. ドロップダウンは絶対配置オーバーレイで、検索ボタン等の他要素を押し下げない。
4. 長い履歴項目は省略表示（…）され、横幅は入力欄内に収まる。

- [ ] **Step 7: コミット**

```bash
git add src/App.css
git commit -m "style(filter): anchor history dropdown directly under the input at input width"
```

---

## Self-Review チェック結果

**Spec coverage:**
- 要件1（スペルチェック/補完無効化）→ Task 2 の input 4属性。
- 要件2（入力欄直下表示）→ Task 2 のJSX構造（`filter-combo`/`filter-input-wrap`/dropdown移設）＋ Task 3 のCSS。
- 要件3（↓で履歴遷移・コンボボックス方式）→ Task 1（`historyNav` 純粋関数）＋ Task 2 の↑↓配線・`draft`・Escドラフト復元・onChange。
- 要件4（選択時に入力欄フォーカス）→ Task 2 の `pickHistory`（rAFでフォーカス＋キャレット末尾）。

**Placeholder scan:** プレースホルダなし。各コードステップに完全なコードを記載。

**Type consistency:** `historyNav` の `NavInput`/`NavResult`（`key`/`open`/`index`/`items`/`query`/`draft`/`history`）をTask 1で定義しTask 2で同形のオブジェクトを渡す。`comboRef`/`inputRef`/`draft`/`setDraft` をTask 2内で一貫使用。CSSクラス `filter-combo`/`filter-input-wrap`/`history-dropdown`/`history-btn` をTask 2のJSXとTask 3のCSSで一致。

**留意点:** Task 2 コミット後・Task 3 コミット前の一瞬、ドロップダウン位置が未スタイルになるが機能は維持（許容）。↑↓ナビの境界・ドラフト復元は `historyNav` のテストで網羅。要件1/2/4のDOM・スタイル・フォーカスは手動検証。Rust側変更なし。
