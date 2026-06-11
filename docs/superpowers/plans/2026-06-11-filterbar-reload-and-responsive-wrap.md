# FilterBar 再読込ボタン・レスポンシブ行分け Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像一覧のフィルタバーに「再読込（現在クエリの再実行）」アイコンボタンを追加し、狭い画面では「入力系」と「それ以外」を自動折り返しで2行に分ける。

**Architecture:** `FilterBar` の内部を2つの flex グループ（`.fb-group-input` / `.fb-group-actions`）に再編し、親 `.filter-bar` を `flex-wrap: wrap` にして横幅が足りなくなったらグループB（それ以外）が丸ごと次行へ折り返すようにする。`App.tsx` ヘッダーにあったファイル名トグルは折り返し単位を揃えるためグループBへ移設。再読込ボタンは `検索` の右に置き `useQueryStore.runQuery()` を呼ぶ。

**Tech Stack:** React 19 + TypeScript（Vite / Tauri）、Zustand ストア、Vitest + @testing-library/react（jsdom, globals）。

設計の根拠は `docs/superpowers/specs/2026-06-11-filterbar-reload-and-responsive-wrap-design.md` を参照。

---

## ファイル構成

- 変更: `src/components/FilterBar.tsx` — 2グループ構造化、filename-toggle 取り込み、再読込ボタン追加。
- 変更: `src/App.tsx` — ヘッダーの filename-toggle 削除、未使用になる `showFilename` セレクタ削除。
- 変更: `src/App.css` — `.filter-bar` を `flex-wrap`、`.fb-group-input` / `.fb-group-actions` / `.reload-btn` 追加、flex-shrink ルール更新。
- 新規: `src/components/FilterBar.test.tsx` — 構造・filename-toggle・再読込挙動のテスト。

実行コマンド:
- 単体テスト（対象のみ）: `pnpm exec vitest run src/components/FilterBar.test.tsx`
- 全テスト: `pnpm test`
- 型チェック: `pnpm exec tsc --noEmit`

---

## Task 1: FilterBar を2グループ化し filename-toggle を取り込む（レスポンシブ行分け）

**Files:**
- Test: `src/components/FilterBar.test.tsx`（新規）
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/FilterBar.test.tsx` を新規作成:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { useQueryStore } from "../store/useQueryStore";

vi.mock("../api/images");
vi.mock("../api/prefs");
vi.mock("../api/slideshow");

beforeEach(() => {
  useQueryStore.setState({
    query: "",
    sort: "filename",
    dir: "asc",
    results: [],
    total: 0,
    history: [],
    showFilename: true,
  });
  vi.resetAllMocks();
});

describe("FilterBar", () => {
  it("入力系とそれ以外を別グループで描画する", () => {
    const { container } = render(<FilterBar />);
    expect(container.querySelector(".fb-group-input")).not.toBeNull();
    expect(container.querySelector(".fb-group-actions")).not.toBeNull();
  });

  it("詳細ボタンは入力系グループに置く", () => {
    const { container } = render(<FilterBar />);
    const input = container.querySelector(".fb-group-input");
    expect(input?.querySelector('[aria-label="詳細フィルタを開く"]')).not.toBeNull();
  });

  it("ファイル名トグルを FilterBar（それ以外グループ）に表示する", () => {
    const { container } = render(<FilterBar />);
    const actions = container.querySelector(".fb-group-actions");
    expect(actions?.querySelector(".filename-toggle")).not.toBeNull();
    expect(screen.getByText(/ファイル名/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm exec vitest run src/components/FilterBar.test.tsx`
Expected: FAIL（`.fb-group-input` / `.fb-group-actions` が存在せず `querySelector` が null。filename-toggle も未配置）

- [ ] **Step 3: FilterBar.tsx にストアセレクタを追加**

`src/components/FilterBar.tsx` の既存セレクタ群（`const selectedIndex = useViewerStore((s) => s.selectedIndex);` の直後）に追加:

```tsx
  const showFilename = useQueryStore((s) => s.showFilename);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);
```

- [ ] **Step 4: FilterBar.tsx の return を2グループ構造へ書き換える**

`src/components/FilterBar.tsx` の `return ( ... )` ブロック全体を以下に置き換える（既存の入力・ドロップダウン・ハンドラはそのまま、配置のみ再編。詳細ボタンを入力系グループへ移動し、検索／スライドショー／並べ替え／件数／ファイル名トグルをそれ以外グループへ集約）:

```tsx
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
```

- [ ] **Step 5: App.tsx からファイル名トグルを削除**

`src/App.tsx` の `<header>` を以下に変更（filename-toggle ボタンを削除）:

```tsx
      <header className="filter-bar-slot">
        <FilterBar />
      </header>
```

続いて未使用になる `showFilename` セレクタを削除する。`src/App.tsx` の次の行を削除:

```tsx
  const showFilename = useQueryStore((s) => s.showFilename);
```

（`toggleShowFilename` はメニュー処理 `if (id === "toggle_filename")` で使うため残す。）

- [ ] **Step 6: App.css にグループ用スタイルを追加**

`src/App.css` の `.filter-bar` ルールに `flex-wrap: wrap;` を追加し、直後にグループルールを足す。変更前:

```css
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
```

変更後:

```css
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.fb-group-input {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 360px;
  min-width: 0;
}
.fb-group-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
}
```

- [ ] **Step 7: App.css の flex-shrink ルールをグループ対応に更新**

`src/App.css` の以下のルール（`/* フィルタバー: 履歴ドロップダウン（固定幅ボタン） */` 直下）を変更。変更前:

```css
.filter-bar > button,
.history-btn {
  flex-shrink: 0;
}
```

変更後（直下の子が `.filter-bar` からグループへ移ったため、セレクタをグループ内の固定要素へ向ける）:

```css
.fb-group-input > button,
.fb-group-actions > button,
.fb-group-actions > .sort-control,
.fb-group-actions > .result-count,
.history-btn {
  flex-shrink: 0;
}
```

- [ ] **Step 8: テストと型チェックを実行して通過を確認**

Run: `pnpm exec vitest run src/components/FilterBar.test.tsx`
Expected: PASS（3 tests）

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし（App.tsx の未使用 `showFilename` を消したので `noUnusedLocals` も通る）

- [ ] **Step 9: コミット**

```bash
git add src/components/FilterBar.tsx src/components/FilterBar.test.tsx src/App.tsx src/App.css
git commit -m "feat(filter-bar): two-row wrap with input/actions groups; move filename toggle into bar"
```

---

## Task 2: 再読込ボタンを追加（現在クエリの再実行）

**Files:**
- Test: `src/components/FilterBar.test.tsx`
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: 失敗するテストを追加**

`src/components/FilterBar.test.tsx` の先頭の import 行を `fireEvent` 付きに変更:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
```

`describe("FilterBar", () => { ... })` の中に次のテストを追加:

```tsx
  it("再読込ボタンのクリックで runQuery を呼ぶ", () => {
    const runQuery = vi.fn().mockResolvedValue(undefined);
    useQueryStore.setState({ runQuery });
    render(<FilterBar />);
    fireEvent.click(screen.getByLabelText("再読込"));
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("再読込ボタンはそれ以外グループの検索ボタン直後に置く", () => {
    const { container } = render(<FilterBar />);
    const actions = container.querySelector(".fb-group-actions");
    const search = actions?.querySelector('[aria-label="検索"]');
    expect(search?.nextElementSibling?.getAttribute("aria-label")).toBe("再読込");
  });
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm exec vitest run src/components/FilterBar.test.tsx`
Expected: FAIL（`aria-label="再読込"` の要素が見つからない）

- [ ] **Step 3: 再読込ハンドラを追加**

`src/components/FilterBar.tsx` の `launchSlideshow` 関数定義の直後に追加:

```tsx
  const reload = () => {
    void runQuery().catch((e) => console.error("再読込に失敗しました:", e));
  };
```

（`runQuery` は既に `const runQuery = useQueryStore((s) => s.runQuery);` で取得済み。）

- [ ] **Step 4: 検索ボタンの直後に再読込ボタンを挿入**

`src/components/FilterBar.tsx` のグループB内、検索ボタンとスライドショーボタンの間に挿入。変更前:

```tsx
        <button onClick={() => void submit()} aria-label="検索">
          検索
        </button>
        <button
          onClick={launchSlideshow}
```

変更後:

```tsx
        <button onClick={() => void submit()} aria-label="検索">
          検索
        </button>
        <button
          className="reload-btn"
          onClick={reload}
          aria-label="再読込"
          title="再読込"
        >
          ⟳
        </button>
        <button
          onClick={launchSlideshow}
```

- [ ] **Step 5: App.css に再読込ボタンのスタイルを追加**

`src/App.css` の `.history-btn { width: 32px; }` ルールの直後に追加:

```css
.reload-btn {
  width: 32px;
  font-size: 15px;
  line-height: 1;
}
```

- [ ] **Step 6: テストを実行して通過を確認**

Run: `pnpm exec vitest run src/components/FilterBar.test.tsx`
Expected: PASS（5 tests）

- [ ] **Step 7: コミット**

```bash
git add src/components/FilterBar.tsx src/components/FilterBar.test.tsx src/App.css
git commit -m "feat(filter-bar): add reload icon button to re-run current query"
```

---

## Task 3: 全体検証（型・全テスト・実機目視）

**Files:** （変更なし。検証のみ）

- [ ] **Step 1: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 2: 全テスト**

Run: `pnpm test`
Expected: 既存テスト＋FilterBar の 5 tests すべて PASS

- [ ] **Step 3: 実機で目視確認（CSS 折り返しは jsdom で検証不可のため）**

`pnpm tauri dev` で起動し、以下を確認:
- 広いウィンドウ: `[テキスト…▾][詳細…] [検索][⟳][スライドショー▶] 並べ替え … 件数 [ファイル名:…]` が1行に収まる。
- ウィンドウを狭めると、`[検索][⟳]…[ファイル名:…]`（グループB）が丸ごと2行目へ折り返り、1行目は `[テキスト…▾][詳細…]` のみになる。
- `⟳` クリックで一覧が再クエリされる（件数・並びが現在のクエリのまま再取得される）。
- 既存機能（履歴ドロップダウン、詳細ダイアログ、スライドショー、並べ替え、ファイル名トグル）が従来どおり動作する。

- [ ] **Step 4: 確認できたら完了**

問題があれば該当 Task に戻って修正し、再度本 Task の検証を実行する。

---

## 自己レビュー結果

- **spec カバレッジ:** 再読込ボタン（動作=runQuery / 位置=検索の右 / `⟳`）→ Task 2。レスポンシブ2グループ折り返し → Task 1。filename-toggle 移設 → Task 1。テスト → Task 1・2。実機目視 → Task 3。スコープ外項目（再スキャン・ローディング・固定ブレークポイント）は実装に含めず。すべて対応済み。
- **プレースホルダ:** TBD/TODO・曖昧指示なし。各ステップに実コード・実コマンド・期待結果を記載。
- **型/名称整合:** `reload` / `runQuery` / `toggleShowFilename` / `showFilename` / クラス名 `.fb-group-input` `.fb-group-actions` `.reload-btn` `.filename-toggle` は全タスクで一貫。`aria-label="再読込"` / `"検索"` / `"詳細フィルタを開く"` もテストと実装で一致。
