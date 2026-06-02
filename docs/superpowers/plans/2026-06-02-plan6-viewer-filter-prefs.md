# ビューア操作性 / 履歴オートコンプリート / 設定永続化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像ビューアのESC/ダブルクリック操作を改善し、フィルタ入力に履歴オートコンプリートを追加し、フィルタ・ソート・ズーム設定をセッション間で永続化する。

**Architecture:** 全変更はフロントエンド（React + Zustand）に閉じる。永続化は既存の `settings` テーブル（`app_data_dir/library.db`、OSごと・ユーザーごとに分離済み）と既存 Tauri コマンド `get_setting`/`set_setting`/`list_filter_history` を流用するため、Rust 側の変更は不要。純粋ロジック（履歴マッチ・ズーム設定の直列化）は独立ユーティリティに切り出してユニットテストする。DOMイベント・ネイティブ全画面挙動は手動検証。

**Tech Stack:** Tauri 2, React 19, Zustand 5, TypeScript (strict, `noEmit`), Vitest, @testing-library/react。

**前提（合意済み仕様）:**
- 機能1（ESCでmacOSネイティブ全画面が解除されるのを防ぐ）はメインの `ImageViewer` オーバーレイのみ対象。`preventDefault`/`stopPropagation` によるベストエフォートで、ネイティブ介入はしない。実機確認が必須。
- 機能2: ダブルクリックは `viewer-stage` 全体で `select(index)+close()`（Enterと同義）。左右ナビ矢印上では `stopPropagation` で発火させない。ズームトグルは採用しない。
- 機能3: 入力追従のフィルタ付きドロップダウン。マッチは「部分一致・大小無視・完全一致除外」。↑↓で表示中候補を巡回、Enterで確定＋検索、Tabで確定のみ、Escで閉じる。▾ボタンは全件ブラウズ用に残す。
- 機能4: 変更時に即保存（eager）。`query`（runQuery時）・`sort`（既存実装を流用）・`zoom`（mode+scale）の3項目のみ。起動時に復元し `query` は自動実行。不正値はデフォルトへフォールバック。

---

## File Structure

**新規作成:**
- `src/util/historyMatch.ts` — 履歴マッチ純粋関数 `matchHistory(input, history)`。
- `src/util/historyMatch.test.ts` — 上記のユニットテスト。
- `src/util/zoomSetting.ts` — ズーム設定の直列化/パース `serializeZoom` / `parseZoom`。
- `src/util/zoomSetting.test.ts` — 上記のユニットテスト。

**変更:**
- `src/components/ImageViewer.tsx` — 機能1（ESC消費）・機能2（ダブルクリックで閉じる）。
- `src/components/FilterBar.tsx` — 機能3（オートコンプリート配線）。
- `src/store/useViewerStore.ts` — 機能4（ズーム永続化・`loadZoom` 追加）。
- `src/store/useViewerStore.test.ts` — 上記に伴うモック更新・テスト追加。
- `src/store/useQueryStore.ts` — 機能4（`query` 永続化・`loadSettings` で復元）。
- `src/store/useQueryStore.test.ts` — 上記に伴うモック更新・テスト追加。
- `src/App.tsx` — 機能4（起動時に `loadZoom` 呼び出し）。

**変更不要:** Rust 側（`settings` テーブル・`get_setting`/`set_setting`/`list_filter_history` を流用）。`sort` の永続化は既存実装で完結しているため対象外。

---

## Task 1: ImageViewer — ESC消費とダブルクリックで閉じる（機能1・機能2）

**Files:**
- Modify: `src/components/ImageViewer.tsx`

DOMイベント挙動のため、検証は型チェック + 手動。

- [ ] **Step 1: Escape ハンドラで `preventDefault`/`stopPropagation` を行う**

`src/components/ImageViewer.tsx` の `onKey` 内、`case "Escape":` を次のように変更する（71-84行付近）。

変更前:
```tsx
        case "Escape":
          close();
          break;
```
変更後:
```tsx
        case "Escape":
          // オーバーレイ表示中は ESC を消費し、OS（macOSネイティブ全画面など）へ伝播させない。
          // ベストエフォート: Web content 側の preventDefault が効かない環境では OS 挙動が優先される。
          e.preventDefault();
          e.stopPropagation();
          close();
          break;
```

- [ ] **Step 2: ステージにダブルクリックで閉じるハンドラを追加し、ナビ矢印では伝播を止める**

同ファイルの JSX。まず `viewer-stage` の `div` に `onDoubleClick` を追加する（161行付近）。

変更前:
```tsx
        <div className="viewer-stage" onWheel={onWheel}>
          <button className="viewer-nav prev" onClick={prev} aria-label="前へ">
            ‹
          </button>
          <img className={imgClass} style={imgStyle} src={src} alt={image.filename} />
          <button className="viewer-nav next" onClick={next} aria-label="次へ">
            ›
          </button>
          {zoomIndicator && <div className="viewer-zoom-indicator">{zoomIndicator}</div>}
        </div>
```
変更後:
```tsx
        <div
          className="viewer-stage"
          onWheel={onWheel}
          onDoubleClick={() => {
            // Enter と同義: 現在表示中の画像を選択して一覧へ戻る。
            select(index);
            close();
          }}
        >
          <button
            className="viewer-nav prev"
            onClick={prev}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="前へ"
          >
            ‹
          </button>
          <img className={imgClass} style={imgStyle} src={src} alt={image.filename} />
          <button
            className="viewer-nav next"
            onClick={next}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="次へ"
          >
            ›
          </button>
          {zoomIndicator && <div className="viewer-zoom-indicator">{zoomIndicator}</div>}
        </div>
```

`select` と `index` は既にコンポーネント上部で取得済み（25, 18行）なので追加の宣言は不要。

- [ ] **Step 3: 型チェックを実行**

Run: `npx tsc -p tsconfig.json`
Expected: エラーなしで終了（出力なし、終了コード0）。

- [ ] **Step 4: 手動検証（実機）**

Run: `npm run tauri dev`
確認手順:
1. macOS で、ウィンドウを緑ボタンでネイティブ全画面にする。
2. 画像をダブルクリックでビューアを開く。
3. ESC を押す → ビューアだけ閉じ、ウィンドウのネイティブ全画面は維持されること（ベストエフォート。維持されなければOS制約として受容）。
4. 再度ビューアを開き、画像本体および黒背景をダブルクリック → 一覧へ戻り、その画像が選択（ハイライト）されていること。
5. 左右のナビ矢印（‹ ›）をダブルクリック → ビューアは閉じず、2枚ぶん移動するだけであること。

- [ ] **Step 5: コミット**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat(viewer): consume ESC to keep macOS fullscreen and close on stage double-click"
```

---

## Task 2: matchHistory ユーティリティ（機能3コア）

**Files:**
- Create: `src/util/historyMatch.ts`
- Test: `src/util/historyMatch.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/historyMatch.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchHistory } from "./historyMatch";

const HISTORY = ["prompt:1girl rating:>=4", "forest", "FOREST night", "cat -blurry"];

describe("matchHistory", () => {
  it("returns all history for empty input", () => {
    expect(matchHistory("", HISTORY)).toEqual(HISTORY);
  });

  it("returns all history for whitespace-only input", () => {
    expect(matchHistory("   ", HISTORY)).toEqual(HISTORY);
  });

  it("matches substrings anywhere (contains)", () => {
    expect(matchHistory("1girl", HISTORY)).toEqual(["prompt:1girl rating:>=4"]);
  });

  it("is case-insensitive", () => {
    // 大小無視で "FOR" が "forest" と "FOREST night" の両方にマッチする。
    expect(matchHistory("FOR", HISTORY)).toEqual(["forest", "FOREST night"]);
  });

  it("excludes entries equal to the input (case-insensitive)", () => {
    expect(matchHistory("Forest", HISTORY)).toEqual(["FOREST night"]);
  });

  it("returns empty when nothing matches", () => {
    expect(matchHistory("zzz", HISTORY)).toEqual([]);
  });

  it("preserves the original order of history", () => {
    expect(matchHistory("r", ["bar", "car", "rim"])).toEqual(["bar", "car", "rim"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/historyMatch.test.ts`
Expected: FAIL（`matchHistory` が未定義、もしくはモジュールが見つからない）。

- [ ] **Step 3: 最小実装を書く**

`src/util/historyMatch.ts`:
```ts
/**
 * フィルタ入力 `input` に対し、履歴 `history` からオートコンプリート候補を返す。
 * - 大文字小文字を区別しない部分一致（contains）。
 * - 入力と（大小無視で）完全一致する履歴は候補から除外する。
 * - 入力が空白のみ/空のときは履歴全件をそのまま返す（全件ブラウズ用）。
 * - 履歴の元の並び順を保持する。
 */
export function matchHistory(input: string, history: string[]): string[] {
  const q = input.trim().toLowerCase();
  if (q === "") return history;
  return history.filter((h) => {
    const hl = h.toLowerCase();
    return hl.includes(q) && hl !== q;
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/historyMatch.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: コミット**

```bash
git add src/util/historyMatch.ts src/util/historyMatch.test.ts
git commit -m "feat(filter): add matchHistory autocomplete utility"
```

---

## Task 3: FilterBar にオートコンプリートを配線（機能3）

**Files:**
- Modify: `src/components/FilterBar.tsx`

ナビゲーション中に候補リストが揺れないよう、表示中の候補を `acItems` 状態に「凍結」して保持する（入力時のみ再計算する）。検証は型チェック + 手動。

- [ ] **Step 1: FilterBar.tsx を全面更新する**

`src/components/FilterBar.tsx` を次の内容で置き換える。

```tsx
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
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc -p tsconfig.json`
Expected: エラーなしで終了（終了コード0）。`noUnusedLocals` のため未使用変数がないことも担保される。

- [ ] **Step 3: 手動検証**

Run: `npm run tauri dev`
事前に履歴を数件作る（いくつか検索を実行）。確認手順:
1. 入力欄に履歴の一部（例 `1girl`）を打つ → マッチする履歴だけがドロップダウン表示される。
2. ↑↓で候補を移動 → ハイライトが移り、入力欄に反映される。候補リストは移動中に変化しないこと。
3. 候補をハイライト中に Enter → その候補で検索が実行される。候補未選択時の Enter は入力中クエリで検索される。
4. 候補をハイライト中に Tab → 入力欄に確定されるが検索は実行されない（編集を続けられる）。
5. ドロップダウン表示中に Esc → 閉じる。入力内容は保持される。
6. ▾ボタン → 入力に関係なく全履歴が表示される。
7. 入力欄をクリックしただけ（打鍵なし）ではドロップダウンは開かない。

- [ ] **Step 4: コミット**

```bash
git add src/components/FilterBar.tsx
git commit -m "feat(filter): history autocomplete dropdown driven by typed text"
```

---

## Task 4: zoomSetting ユーティリティ（機能4コア）

**Files:**
- Create: `src/util/zoomSetting.ts`
- Test: `src/util/zoomSetting.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/zoomSetting.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { serializeZoom, parseZoom } from "./zoomSetting";

describe("serializeZoom", () => {
  it("serializes mode and scale as 'mode:scale'", () => {
    expect(serializeZoom("fit", 1)).toBe("fit:1");
    expect(serializeZoom("custom", 2.5)).toBe("custom:2.5");
  });
});

describe("parseZoom", () => {
  it("round-trips a serialized value", () => {
    expect(parseZoom(serializeZoom("custom", 2.5))).toEqual({ mode: "custom", scale: 2.5 });
    expect(parseZoom(serializeZoom("fit", 1))).toEqual({ mode: "fit", scale: 1 });
  });

  it("returns null for null input", () => {
    expect(parseZoom(null)).toBeNull();
  });

  it("returns null for unknown mode", () => {
    expect(parseZoom("zoomy:1")).toBeNull();
  });

  it("returns null for non-numeric scale", () => {
    expect(parseZoom("custom:abc")).toBeNull();
  });

  it("returns null for non-positive scale", () => {
    expect(parseZoom("custom:0")).toBeNull();
    expect(parseZoom("custom:-2")).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseZoom("")).toBeNull();
    expect(parseZoom("fit")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/zoomSetting.test.ts`
Expected: FAIL（`serializeZoom`/`parseZoom` が未定義）。

- [ ] **Step 3: 最小実装を書く**

`src/util/zoomSetting.ts`:
```ts
import type { ZoomMode } from "../types";

const VALID_MODES: ZoomMode[] = ["fit", "actual", "fill", "custom"];

/** ズーム設定を `"mode:scale"` 形式の文字列へ直列化する。 */
export function serializeZoom(mode: ZoomMode, scale: number): string {
  return `${mode}:${scale}`;
}

/**
 * 永続化されたズーム設定文字列を解釈する。
 * 不正値（null・未知モード・数値化できない/非正の scale・形式不正）は null を返し、
 * 呼び出し側でデフォルトへフォールバックさせる。
 */
export function parseZoom(raw: string | null): { mode: ZoomMode; scale: number } | null {
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep < 0) return null;
  const modePart = raw.slice(0, sep);
  const scalePart = raw.slice(sep + 1);
  if (!VALID_MODES.includes(modePart as ZoomMode)) return null;
  const scale = Number(scalePart);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { mode: modePart as ZoomMode, scale };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/zoomSetting.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 5: コミット**

```bash
git add src/util/zoomSetting.ts src/util/zoomSetting.test.ts
git commit -m "feat(viewer): add zoom setting serialize/parse utility"
```

---

## Task 5: ズーム設定の永続化と復元（機能4）

**Files:**
- Modify: `src/store/useViewerStore.ts`
- Test: `src/store/useViewerStore.test.ts`

- [ ] **Step 1: 既存テストのモックを更新し、失敗するテストを追加する**

`src/store/useViewerStore.test.ts` 冒頭のモックを更新する。

変更前:
```ts
vi.mock("../api/prefs", () => ({
  syncZoomMenu: vi.fn().mockResolvedValue(undefined),
  syncFilenameMenu: vi.fn().mockResolvedValue(undefined),
}));
```
変更後:
```ts
import * as prefsApi from "../api/prefs";

vi.mock("../api/prefs", () => ({
  syncZoomMenu: vi.fn().mockResolvedValue(undefined),
  syncFilenameMenu: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
}));
```

`describe("useViewerStore", ...)` ブロックの末尾（最後の `it` の後、閉じ `});` の直前）に次のテストを追加する。

```ts
  it("setZoomMode persists the zoom setting", () => {
    useViewerStore.getState().setZoomMode("fill");
    expect(prefsApi.setSetting).toHaveBeenCalledWith("zoom", "fill:1");
  });

  it("zoomBy persists the custom zoom setting", () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    useViewerStore.getState().zoomBy(2);
    expect(useViewerStore.getState().scale).toBe(2);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("zoom", "custom:2");
  });

  it("loadZoom restores a valid persisted zoom", async () => {
    vi.mocked(prefsApi.getSetting).mockResolvedValue("custom:2.5");
    await useViewerStore.getState().loadZoom();
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    expect(useViewerStore.getState().scale).toBe(2.5);
  });

  it("loadZoom ignores invalid persisted zoom", async () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    vi.mocked(prefsApi.getSetting).mockResolvedValue("bogus");
    await useViewerStore.getState().loadZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fit");
    expect(useViewerStore.getState().scale).toBe(1);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: FAIL（`loadZoom` が未定義、および `setSetting` 呼び出しが行われていない）。

- [ ] **Step 3: useViewerStore を実装する**

`src/store/useViewerStore.ts` を次の通り変更する。

import 行を変更:
```ts
import { syncZoomMenu } from "../api/prefs";
```
↓
```ts
import { syncZoomMenu, setSetting, getSetting } from "../api/prefs";
import { serializeZoom, parseZoom } from "../util/zoomSetting";
```

`interface ViewerState` のメソッド群に `loadZoom` を追加する（`toggleNormalize` の行の後）:
```ts
  toggleNormalize: () => void;
  loadZoom: () => Promise<void>;
```

`setZoomMode` を変更:
```ts
  setZoomMode: (m) => {
    set({ zoomMode: m, scale: 1 });
    syncZoomMenu(m).catch((e) => console.error("syncZoomMenu failed:", e));
    setSetting("zoom", serializeZoom(m, 1)).catch((e) =>
      console.error("setSetting(zoom) failed:", e),
    );
  },
```

`zoomBy` を変更:
```ts
  zoomBy: (factor) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor));
    set({ zoomMode: "custom", scale: next });
    syncZoomMenu("custom").catch((e) => console.error("syncZoomMenu failed:", e));
    setSetting("zoom", serializeZoom("custom", next)).catch((e) =>
      console.error("setSetting(zoom) failed:", e),
    );
  },
```

`toggleNormalize` の後（ストア定義の末尾）に `loadZoom` を追加:
```ts
  toggleNormalize: () => set({ normalizePrompt: !get().normalizePrompt }),
  // 起動時に永続化されたズーム設定を復元する。不正値は無視してデフォルトのまま。
  loadZoom: async () => {
    const parsed = parseZoom(await getSetting("zoom"));
    if (parsed) {
      set({ zoomMode: parsed.mode, scale: parsed.scale });
      syncZoomMenu(parsed.mode).catch((e) => console.error("syncZoomMenu failed:", e));
    }
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: PASS（既存テスト + 追加4テスト）。

- [ ] **Step 5: コミット**

```bash
git add src/store/useViewerStore.ts src/store/useViewerStore.test.ts
git commit -m "feat(viewer): persist and restore zoom mode and scale"
```

---

## Task 6: フィルタ文字列の永続化と復元（機能4）

**Files:**
- Modify: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`

- [ ] **Step 1: 既存テストの beforeEach を更新し、失敗するテストを追加する**

`src/store/useQueryStore.test.ts` の `beforeEach` に `setSetting` のモック解決を追加する。

変更前:
```ts
  vi.resetAllMocks();
  vi.mocked(prefsApi.syncFilenameMenu).mockResolvedValue(undefined as unknown as void);
```
変更後:
```ts
  vi.resetAllMocks();
  vi.mocked(prefsApi.syncFilenameMenu).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
```

`describe("useQueryStore", ...)` ブロックの末尾（最後の `it` の後、閉じ `});` の直前）に次のテストを追加する。

```ts
  it("runQuery persists the current filter query", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([]);
    vi.mocked(imagesApi.countQuery).mockResolvedValue(0);
    useQueryStore.getState().setQuery("forest");
    await useQueryStore.getState().runQuery();
    expect(prefsApi.setSetting).toHaveBeenCalledWith("filter_query", "forest");
  });

  it("loadSettings restores persisted filter query", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "filter_query") return "cat -blurry";
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().query).toBe("cat -blurry");
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: FAIL（`runQuery` が `filter_query` を保存していない / `loadSettings` が query を復元していない）。

- [ ] **Step 3: useQueryStore を実装する**

`src/store/useQueryStore.ts` を変更する。

`runQuery` を変更（`set({ results, total });` の後に保存を追加）:
```ts
  runQuery: async () => {
    const { query, sort, dir } = get();
    const [results, total] = await Promise.all([
      imagesApi.queryImages(query, sort, dir, PAGE, 0),
      imagesApi.countQuery(query),
    ]);
    set({ results, total });
    // 直前に効いていたフィルタを永続化する（次回起動時に復元する）。
    prefsApi
      .setSetting("filter_query", query)
      .catch((e) => console.error("setSetting(filter_query) failed:", e));
  },
```

`loadSettings` を変更（`filter_query` の読み出しと復元を追加）:
```ts
  loadSettings: async () => {
    const [sortRaw, showRaw, queryRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
      prefsApi.getSetting("filter_query"),
    ]);
    if (sortRaw) {
      const [sort, dir] = sortRaw.split(":");
      set({ sort: sort as SortKey, dir: (dir || "asc") as SortDir });
    }
    if (showRaw !== null) {
      const on = showRaw !== "false";
      set({ showFilename: on });
      prefsApi.syncFilenameMenu(on).catch((e) => console.error("syncFilenameMenu failed:", e));
    }
    if (queryRaw !== null) {
      set({ query: queryRaw });
    }
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: PASS（既存テスト + 追加2テスト）。

- [ ] **Step 5: コミット**

```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "feat(filter): persist and restore last applied filter query"
```

---

## Task 7: 起動時に loadZoom を呼び出す（機能4の配線）

**Files:**
- Modify: `src/App.tsx`

App は単体テスト対象外。型チェック + 手動検証。

- [ ] **Step 1: loadZoom を取得し、初期化フローに組み込む**

`src/App.tsx` を変更する。

ストアのセレクタ取得部に `loadZoom` を追加（`setZoomMode` の行の付近、20行目あたり）:
```tsx
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const loadZoom = useViewerStore((s) => s.loadZoom);
```

初期化 effect を変更（40-47行付近）:
変更前:
```tsx
  useEffect(() => {
    void (async () => {
      await loadDirectories();
      await loadSettings();
      await loadHistory();
      await runQuery();
    })();
  }, [loadDirectories, loadSettings, loadHistory, runQuery]);
```
変更後:
```tsx
  useEffect(() => {
    void (async () => {
      await loadDirectories();
      await loadSettings();
      await loadZoom();
      await loadHistory();
      await runQuery();
    })();
  }, [loadDirectories, loadSettings, loadZoom, loadHistory, runQuery]);
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc -p tsconfig.json`
Expected: エラーなしで終了（終了コード0）。

- [ ] **Step 3: 全テストを実行する**

Run: `npm test`
Expected: 既存 + 新規テストがすべて PASS。

- [ ] **Step 4: 手動検証（永続化の総合確認）**

Run: `npm run tauri dev`
確認手順:
1. フィルタに任意のクエリを入力して検索し、ソートを変更し、ビューアでズームを custom（例 2倍）にする。
2. アプリを終了し、再起動する。
3. 起動直後に: 前回のフィルタが入力欄に復元され、その結果が自動表示されていること。ソートが復元されていること。
4. ビューアを開く → ズーム設定（mode/scale）が前回のまま復元されていること。
5. （任意）`~/Library/Application Support/<app identifier>/library.db` の `settings` テーブルに `filter_query` / `sort` / `zoom` が保存されていることを確認。

- [ ] **Step 5: コミット**

```bash
git add src/App.tsx
git commit -m "feat(app): restore persisted zoom on startup"
```

---

## Self-Review チェック結果

**Spec coverage:**
- 機能1（ESCでネイティブ全画面解除を防ぐ・ベストエフォート）→ Task 1 Step 1。
- 機能2（画像ダブルクリックで閉じる・Enter同義・矢印は除外）→ Task 1 Step 2。
- 機能3（途中入力で履歴オートコンプリート・部分一致/大小無視/完全一致除外・↑↓/Enter/Tab/Esc・▾全件）→ Task 2（ロジック）+ Task 3（配線）。
- 機能4（フィルタ・ソート・ズームの永続化と復元・OSごとユーザー単位）→ ソートは既存実装で充足、フィルタは Task 6、ズームは Task 4+5、起動配線は Task 7。保存先は既存 `settings` テーブル（OS/ユーザー分離済み）。

**Placeholder scan:** プレースホルダなし。各コードステップに完全なコードを記載済み。

**Type consistency:** `matchHistory(input, history)`、`serializeZoom(mode, scale)` / `parseZoom(raw)`、`loadZoom`、`acItems`、設定キー `filter_query` / `zoom` / `sort` をタスク間で一貫使用。`select`/`index`/`history`/`query` は既存定義を流用。

**留意点:** 機能1 は OS 依存のためベストエフォート（合意済み）。機能1・2・3 の DOM/ネイティブ挙動と App 配線は手動検証（合意済み）。Rust 側変更なし。
