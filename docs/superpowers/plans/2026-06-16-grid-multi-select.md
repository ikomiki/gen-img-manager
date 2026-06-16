# 画像一覧の複数選択（一括ゴミ箱／レーティング） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像一覧で修飾キーによる複数選択を可能にし、選択した画像をまとめてゴミ箱へ移動（確認ダイアログ付き）・レーティング一括付与できるようにする。

**Architecture:** 選択集合の計算は純粋関数 `src/util/selection.ts` に切り出して vitest。選択状態（`selection`/`anchorIndex`）は `useViewerStore` に保持し、`selectedIndex`（アクティブ項目）はビューア起動・スライドショー起点に流用。一括処理は Rust にバッチコマンド（`set_ratings`/`delete_images`）を新設し 1 IPC で実行。`useQueryStore`→`useViewerStore` の循環参照を避けるため、一括操作の対象 id/{id,path} は UI 側が選択集合から組み立てて引数で渡す。クエリ総入替時の選択クリアは `runQuery` 内のコールバック（`setOnResultsReplaced`）経由で `useViewerStore` がクリアする。削除確認は既存 `ConfirmDialog` を再利用。

**Tech Stack:** Rust + rusqlite + trash + serde, React 19 + TypeScript + zustand, vitest, cargo test

---

## File Structure

- Create: `src/util/selection.ts` (+ `selection.test.ts`) — 選択集合の純粋関数。
- Modify: `src-tauri/src/db/images.rs` — `set_ratings`（一括 UPDATE、トランザクション）。
- Modify: `src-tauri/src/commands/query.rs` — `set_ratings` コマンド。
- Modify: `src-tauri/src/commands/fs.rs` — `delete_images` バッチコマンド＋結果型。
- Modify: `src-tauri/src/lib.rs` — `invoke_handler` 登録。
- Modify: `src/api/images.ts` — `setRatings`。
- Modify: `src/api/fs.ts` — `deleteImages`＋結果型。
- Modify: `src/store/useQueryStore.ts` — `rateSelected`/`deleteSelected`/`setOnResultsReplaced`＋`runQuery` フック。
- Modify: `src/store/useViewerStore.ts` — `selection`/`anchorIndex`＋選択アクション＋クリア登録。
- Modify: `src/components/ImageGridPanel.tsx` — クリック/キーボード操作・選択バー・ハイライト・右クリック拡張・削除確認。
- Modify: `src/App.css` — 選択バー・複数選択ハイライトのスタイル。

---

### Task 1: 選択集合の純粋関数 `selection.ts`

**Files:**
- Create: `src/util/selection.ts`
- Test: `src/util/selection.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rangeSet, toggleInSet, allIndices, clampAfterDelete } from "./selection";

describe("rangeSet", () => {
  it("昇順の範囲を集合にする", () => {
    expect([...rangeSet(2, 5)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });
  it("anchor > index でも昇順に正規化する", () => {
    expect([...rangeSet(5, 2)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });
  it("同一なら 1 要素", () => {
    expect([...rangeSet(3, 3)]).toEqual([3]);
  });
});

describe("toggleInSet", () => {
  it("無ければ追加・あれば削除（非破壊）", () => {
    const a = new Set([1, 2]);
    const added = toggleInSet(a, 3);
    expect([...added].sort()).toEqual([1, 2, 3]);
    expect([...a].sort()).toEqual([1, 2]); // 元は不変
    const removed = toggleInSet(added, 2);
    expect([...removed].sort()).toEqual([1, 3]);
  });
});

describe("allIndices", () => {
  it("0..count-1 の集合", () => {
    expect([...allIndices(3)].sort()).toEqual([0, 1, 2]);
  });
  it("0 件なら空集合", () => {
    expect(allIndices(0).size).toBe(0);
  });
});

describe("clampAfterDelete", () => {
  it("残件があれば 削除最小index と 残件-1 の小さい方", () => {
    expect(clampAfterDelete(2, 5)).toBe(2);
    expect(clampAfterDelete(8, 5)).toBe(4);
  });
  it("残件 0 なら -1", () => {
    expect(clampAfterDelete(0, 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/util/selection.test.ts`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装を書く**

`src/util/selection.ts`:

```ts
/**
 * 画像一覧の複数選択で使う、選択集合（results のインデックス Set）を操作する純粋関数群。
 * いずれも入力の Set を破壊せず新しい Set を返す。
 */

/** anchor..index（両端含む）を昇順に正規化した集合。 */
export function rangeSet(anchor: number, index: number): Set<number> {
  const lo = Math.min(anchor, index);
  const hi = Math.max(anchor, index);
  const out = new Set<number>();
  for (let i = lo; i <= hi; i++) out.add(i);
  return out;
}

/** index を集合へトグル（非破壊）。 */
export function toggleInSet(set: Set<number>, index: number): Set<number> {
  const next = new Set(set);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** 0..count-1 の全インデックス集合。 */
export function allIndices(count: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(i);
  return out;
}

/**
 * 一括削除後のアクティブ index。削除した最小 index 付近へクランプする。
 * 残件 0 なら -1（選択なし）。
 */
export function clampAfterDelete(removedMinIndex: number, remaining: number): number {
  if (remaining <= 0) return -1;
  return Math.min(removedMinIndex, remaining - 1);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/selection.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/util/selection.ts src/util/selection.test.ts
git commit -m "feat(grid): 複数選択集合を操作する純粋関数を追加"
```

---

### Task 2: Rust `db::images::set_ratings`（一括 UPDATE）

**Files:**
- Modify: `src-tauri/src/db/images.rs`（`set_rating` の直後に追加、`#[cfg(test)]` にテスト追加）

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/db/images.rs` の `mod tests` 内（`set_rating_updates_and_clears` の後ろ）に追加:

```rust
    #[test]
    fn set_ratings_updates_multiple_then_clears_subset() {
        let mut c = conn();
        let id1 = upsert(&c, &sample("/d/a.png")).unwrap();
        let id2 = upsert(&c, &sample("/d/b.png")).unwrap();
        set_ratings(&mut c, &[id1, id2], Some(3)).unwrap();
        let read = |id: i64| -> Option<i64> {
            c.query_row("SELECT rating FROM images WHERE id = ?1", params![id], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(read(id1), Some(3));
        assert_eq!(read(id2), Some(3));
        set_ratings(&mut c, &[id1], None).unwrap();
        assert_eq!(read(id1), None);
        assert_eq!(read(id2), Some(3));
    }
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml set_ratings`
Expected: FAIL（`set_ratings` 未定義のコンパイルエラー）

- [ ] **Step 3: 実装を書く**

`src-tauri/src/db/images.rs` の `set_rating`（`Ok(())` で終わる関数）の直後に追加:

```rust
/// 複数画像のレーティングを 1 トランザクションで一括更新する。None でクリア（NULL）。
pub fn set_ratings(conn: &mut Connection, ids: &[i64], rating: Option<i64>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE images SET rating = ?2 WHERE id = ?1")?;
        for &id in ids {
            stmt.execute(params![id, rating])?;
        }
    }
    tx.commit()
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml set_ratings`
Expected: PASS（`set_ratings_updates_multiple_then_clears_subset` ＋既存 `set_rating_*`）

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/db/images.rs
git commit -m "feat(db): レーティングを一括更新する set_ratings を追加"
```

---

### Task 3: Rust `set_ratings` コマンド＋登録

**Files:**
- Modify: `src-tauri/src/commands/query.rs`（`set_rating` コマンドの直後）
- Modify: `src-tauri/src/lib.rs`（`invoke_handler`）

- [ ] **Step 1: コマンドを追加**

`src-tauri/src/commands/query.rs` の末尾（`set_rating` 関数の `}` の後ろ）に追加:

```rust
/// 複数画像のレーティングを一括設定する（None でクリア）。範囲外はエラー。
#[tauri::command]
pub fn set_ratings(db: State<Db>, ids: Vec<i64>, rating: Option<i64>) -> Result<(), String> {
    if let Some(r) = rating {
        if !(1..=5).contains(&r) {
            return Err(format!("rating out of range: {r}"));
        }
    }
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::images::set_ratings(&mut conn, &ids, rating).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: `invoke_handler` に登録**

`src-tauri/src/lib.rs` の `commands::query::set_rating,` の行の直後に追加:

```rust
            commands::query::set_ratings,
```

- [ ] **Step 3: ビルドを確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: コンパイル成功（警告のみ可）

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/commands/query.rs src-tauri/src/lib.rs
git commit -m "feat(commands): set_ratings コマンドを追加し登録する"
```

---

### Task 4: Rust `delete_images` バッチコマンド＋登録

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`（結果型＋コマンド追加、ファイル先頭に serde import）
- Modify: `src-tauri/src/lib.rs`（`invoke_handler`）

- [ ] **Step 1: 結果型とコマンドを追加**

`src-tauri/src/commands/fs.rs` の先頭の `use` 群（`use tauri::State;` の下）に追加:

```rust
use serde::{Deserialize, Serialize};
```

同ファイルの末尾（`write_xmp_rating` 関数の後ろ）に追加:

```rust
/// delete_images の 1 要素。フロントの {id, path} に対応。
#[derive(Debug, Deserialize)]
pub struct DeleteItem {
    pub id: i64,
    pub path: String,
}

/// 個別削除の失敗。
#[derive(Debug, Serialize)]
pub struct DeleteFailure {
    pub id: i64,
    pub error: String,
}

/// 一括削除の結果。succeeded は成功件数、failed は失敗の明細。
#[derive(Debug, Serialize)]
pub struct BatchDeleteResult {
    pub succeeded: usize,
    pub failed: Vec<DeleteFailure>,
}

/// 複数画像をまとめてゴミ箱へ移動し、成功分の DB 行を missing=1 にする。
/// 1 件の失敗で全体を中断せず、失敗を集計して返す。確認は呼び出し側の責務。
#[tauri::command]
pub fn delete_images(db: State<Db>, items: Vec<DeleteItem>) -> Result<BatchDeleteResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut succeeded = 0usize;
    let mut failed = Vec::new();
    for item in items {
        match trash::delete(&item.path) {
            Ok(()) => match crate::db::images::mark_missing(&conn, item.id, true) {
                Ok(()) => succeeded += 1,
                Err(e) => failed.push(DeleteFailure { id: item.id, error: e.to_string() }),
            },
            Err(e) => failed.push(DeleteFailure { id: item.id, error: e.to_string() }),
        }
    }
    Ok(BatchDeleteResult { succeeded, failed })
}
```

- [ ] **Step 2: `invoke_handler` に登録**

`src-tauri/src/lib.rs` の `commands::fs::delete_image,` の行の直後に追加:

```rust
            commands::fs::delete_images,
```

- [ ] **Step 3: ビルドを確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: コンパイル成功

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs
git commit -m "feat(commands): 複数画像を一括ゴミ箱移動する delete_images を追加"
```

---

### Task 5: フロント API ラッパ

**Files:**
- Modify: `src/api/images.ts`（`setRatings`）
- Modify: `src/api/fs.ts`（`deleteImages`＋型）

- [ ] **Step 1: `setRatings` を追加**

`src/api/images.ts` の `setRating` の直後に追加:

```ts
export const setRatings = (ids: number[], rating: number | null) =>
  invoke<void>("set_ratings", { ids, rating });
```

- [ ] **Step 2: `deleteImages` と結果型を追加**

`src/api/fs.ts` の `deleteImage` の直後に追加:

```ts
export interface DeleteItem {
  id: number;
  path: string;
}

export interface BatchDeleteResult {
  succeeded: number;
  failed: { id: number; error: string }[];
}

/** 複数画像をまとめてゴミ箱へ移動する。失敗は結果に集計される。 */
export const deleteImages = (items: DeleteItem[]) =>
  invoke<BatchDeleteResult>("delete_images", { items });
```

- [ ] **Step 3: 型チェックとコミット**

Run: `npx tsc --noEmit`
Expected: エラーなし

```bash
git add src/api/images.ts src/api/fs.ts
git commit -m "feat(api): setRatings / deleteImages ラッパを追加"
```

---

### Task 6: `useQueryStore` に一括操作＋選択クリアのフック

**Files:**
- Modify: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`（既存パターンに合わせ追加）

- [ ] **Step 1: 失敗するテストを書く**

`src/store/useQueryStore.test.ts` の末尾の `describe` ブロック内に追加（先頭で `vi.mock("../api/images")` `vi.mock("../api/fs")` `vi.mock("../api/prefs")` が無ければファイル冒頭に追加する。既存テストのモック宣言を確認し、未宣言のものだけ足す）:

```ts
  it("rateSelected は setRatings を呼び results を更新する", async () => {
    const imagesApi = await import("../api/images");
    vi.mocked(imagesApi.setRatings).mockResolvedValue(undefined);
    useQueryStore.setState({
      results: [
        { id: 1, rating: null } as never,
        { id: 2, rating: null } as never,
      ],
      total: 2,
      xmpAutoExport: false,
    });
    await useQueryStore.getState().rateSelected([1, 2], 4);
    expect(imagesApi.setRatings).toHaveBeenCalledWith([1, 2], 4);
    expect(useQueryStore.getState().results.map((r) => r.rating)).toEqual([4, 4]);
  });

  it("deleteSelected は成功した id を results から除去する", async () => {
    const fsApi = await import("../api/fs");
    vi.mocked(fsApi.deleteImages).mockResolvedValue({ succeeded: 1, failed: [] });
    useQueryStore.setState({
      results: [
        { id: 1, path: "/d/1.png" } as never,
        { id: 2, path: "/d/2.png" } as never,
      ],
      total: 2,
    });
    await useQueryStore.getState().deleteSelected([{ id: 1, path: "/d/1.png" }]);
    expect(useQueryStore.getState().results.map((r) => r.id)).toEqual([2]);
    expect(useQueryStore.getState().total).toBe(1);
  });
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts -t "rateSelected"`
Expected: FAIL（`rateSelected` 未定義）

- [ ] **Step 3: 型定義と実装を追加**

`src/store/useQueryStore.ts` の `interface QueryState` 内、`deleteImage:` の行の直後に追加:

```ts
  rateSelected: (ids: number[], rating: number | null) => Promise<void>;
  deleteSelected: (items: { id: number; path: string }[]) => Promise<void>;
```

同ファイルの `create` 呼び出しの**外側・冒頭**（`export const useQueryStore = create...` の直前）に、選択クリアのコールバック機構を追加:

```ts
// useQueryStore → useViewerStore の循環 import を避けるため、クエリ総入替時の
// 選択クリアはコールバック経由で useViewerStore 側から登録する。
let onResultsReplaced: (() => void) | null = null;
export function setOnResultsReplaced(cb: () => void): void {
  onResultsReplaced = cb;
}
```

同ファイルの `runQuery` 内、`set({ results, total: results.length });` の直後に追加:

```ts
    onResultsReplaced?.();
```

同ファイルの `deleteImage` アクションの直後に、2 つの一括アクションを追加:

```ts
  rateSelected: async (ids, rating) => {
    if (ids.length === 0) return;
    await imagesApi.setRatings(ids, rating);
    const idSet = new Set(ids);
    const { xmpAutoExport } = get();
    if (xmpAutoExport) {
      const targets = get().results.filter((r) => idSet.has(r.id));
      let failed = 0;
      for (const row of targets) {
        try {
          await fsApi.writeXmpRating(row.path, rating);
        } catch (e) {
          console.error("XMP書き出しに失敗しました:", e);
          failed++;
        }
      }
      if (failed > 0) get().showToast(`XMPの書き出しに${failed}件失敗しました`);
    }
    set({ results: get().results.map((r) => (idSet.has(r.id) ? { ...r, rating } : r)) });
    get().showToast(`${ids.length}件のレーティングを設定しました`);
  },
  deleteSelected: async (items) => {
    if (items.length === 0) return;
    const res = await fsApi.deleteImages(items);
    const failedIds = new Set(res.failed.map((f) => f.id));
    const targetIds = new Set(items.map((i) => i.id));
    // 成功した（=失敗集合に無い）対象だけを除去する。
    const next = get().results.filter((r) => !targetIds.has(r.id) || failedIds.has(r.id));
    set({ results: next, total: next.length });
    if (res.failed.length > 0) {
      console.error("一部の削除に失敗しました:", res.failed);
      get().showToast(`${res.succeeded}件をゴミ箱に移動（${res.failed.length}件失敗）`);
    } else {
      get().showToast(`${res.succeeded}件をゴミ箱に移動しました`);
    }
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: PASS（追加 2 件＋既存）

- [ ] **Step 5: コミット**

```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "feat(store): 一括レーティング/削除アクションと選択クリアフックを追加"
```

---

### Task 7: `useViewerStore` に選択状態とアクション

**Files:**
- Modify: `src/store/useViewerStore.ts`

- [ ] **Step 1: import と型を追加**

`src/store/useViewerStore.ts` 冒頭の import 群に追加:

```ts
import { useQueryStore, setOnResultsReplaced } from "./useQueryStore";
import { rangeSet, toggleInSet, allIndices } from "../util/selection";
```

（既存で `import { useQueryStore } ...` がある場合は重複させず、`setOnResultsReplaced` を既存行へ統合する。）

`interface ViewerState` の `selectedIndex: number;` の直後に追加:

```ts
  /** 複数選択集合（results のインデックス）。単一選択時は selectedIndex のみを含む。 */
  selection: Set<number>;
  /** Shift 範囲選択の起点インデックス。未設定は -1。 */
  anchorIndex: number;
```

同 interface の `select: (index: number) => void;` の直後に追加:

```ts
  selectSingle: (index: number) => void;
  toggleSelect: (index: number) => void;
  selectRange: (index: number) => void;
  selectAll: (count: number) => void;
  clearSelection: () => void;
  resetSelection: (index: number) => void;
```

- [ ] **Step 2: 初期値とアクション実装を追加**

`create<ViewerState>((set, get) => ({` 直下の初期値群、`selectedIndex: -1,` の直後に追加:

```ts
  selection: new Set<number>(),
  anchorIndex: -1,
```

既存 `select: (index) => set({ selectedIndex: index }),` の直後に追加:

```ts
  // 通常クリック/矢印: 単一選択（他を解除）。
  selectSingle: (index) =>
    set({ selection: new Set([index]), selectedIndex: index, anchorIndex: index }),
  // Cmd/Ctrl+クリック: 個別トグル。
  toggleSelect: (index) =>
    set((s) => ({
      selection: toggleInSet(s.selection, index),
      selectedIndex: index,
      anchorIndex: index,
    })),
  // Shift+クリック / Shift+矢印: anchor..index を選択。
  selectRange: (index) =>
    set((s) => ({
      selection: rangeSet(s.anchorIndex < 0 ? index : s.anchorIndex, index),
      selectedIndex: index,
    })),
  // Cmd/Ctrl+A: 全選択（アクティブ/アンカーは維持）。
  selectAll: (count) => set({ selection: allIndices(count) }),
  // Esc: 単一選択に戻す（完全クリアではない）。
  clearSelection: () =>
    set((s) => ({ selection: new Set(s.selectedIndex >= 0 ? [s.selectedIndex] : []) })),
  // 削除後/総入替後にアクティブと選択を作り直す。index<0 で全解除。
  resetSelection: (index) =>
    set({
      selection: index >= 0 ? new Set([index]) : new Set(),
      selectedIndex: index,
      anchorIndex: index,
    }),
```

- [ ] **Step 3: クエリ総入替時の選択クリアを登録**

`src/store/useViewerStore.ts` の末尾（`}));` の後ろ）に追加:

```ts
// クエリ再実行・ソート変更・フィルタ適用などで results が総入替されたら選択を解除する。
// （rateSelected/deleteSelected は results を直接更新し、このコールバックは呼ばない。）
setOnResultsReplaced(() => {
  useViewerStore.setState({ selection: new Set<number>(), selectedIndex: -1, anchorIndex: -1 });
});
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: 既存テストが壊れていないか確認**

Run: `npx vitest run`
Expected: PASS（全件）

- [ ] **Step 6: コミット**

```bash
git add src/store/useViewerStore.ts
git commit -m "feat(store): ビューアストアに複数選択の状態とアクションを追加"
```

---

### Task 8: グリッドのクリック操作とハイライト

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: ストアから選択状態とアクションを取得**

`src/components/ImageGridPanel.tsx` の `const selectedIndex = useViewerStore((s) => s.selectedIndex);` ブロック付近に追加（`openViewer`/`viewerOpen` の取得の後ろ）:

```ts
  const selection = useViewerStore((s) => s.selection);
  const selectSingle = useViewerStore((s) => s.selectSingle);
  const toggleSelect = useViewerStore((s) => s.toggleSelect);
  const selectRange = useViewerStore((s) => s.selectRange);
  const selectAll = useViewerStore((s) => s.selectAll);
  const clearSelection = useViewerStore((s) => s.clearSelection);
  const resetSelection = useViewerStore((s) => s.resetSelection);
  const rateSelected = useQueryStore((s) => s.rateSelected);
  const deleteSelected = useQueryStore((s) => s.deleteSelected);
```

- [ ] **Step 2: 選択対象を組み立てるヘルパを追加**

同コンポーネント内、`return (` の手前に追加:

```ts
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
```

- [ ] **Step 3: セルのクリックハンドラを修飾キー対応にする**

既存のセル `onClick`:

```tsx
                    onClick={() => {
                      selectImage(globalIndex);
                      // クリックでグリッドへフォーカスを移し、Enter/カーソルキーを有効にする。
                      parentRef.current?.focus();
                    }}
```

を次に置換:

```tsx
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) toggleSelect(globalIndex);
                      else if (e.shiftKey) selectRange(globalIndex);
                      else selectSingle(globalIndex);
                      // クリックでグリッドへフォーカスを移し、Enter/カーソルキーを有効にする。
                      parentRef.current?.focus();
                    }}
```

- [ ] **Step 4: セルのハイライトに複数選択クラスを足す**

既存のセル className:

```tsx
                    className={
                      globalIndex === selectedIndex ? "thumb-cell selected" : "thumb-cell"
                    }
```

を次に置換:

```tsx
                    className={[
                      "thumb-cell",
                      globalIndex === selectedIndex ? "selected" : "",
                      selection.has(globalIndex) ? "in-selection" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
```

- [ ] **Step 5: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし／PASS

注: この時点では `selectImage` は `onKey` 内の矢印移動・auto-advance でまだ使用中（`tsc` は通る）。Task 9 でそれらを `selectSingle` に統一すると未使用になるため、Task 9 で取得行を削除する。

- [ ] **Step 6: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): 修飾キークリックによる複数選択とハイライトを追加"
```

---

### Task 9: グリッドのキーボード操作（全選択・解除・範囲拡張・一括）

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`（`useEffect` 内の `onKey`）

- [ ] **Step 1: 削除確認用の state を用意**

コンポーネント先頭付近（`const [width, setWidth] = useState(0);` の直後）に追加:

```ts
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
```

- [ ] **Step 2: 修飾キー early-return の前に Cmd+A / 削除 / Esc を処理する**

`onKey` 内の次の行（早期 return）:

```ts
      // Cmd/Ctrl 併用のキー（Cmd+C による選択テキストのコピー等）は標準動作へ委ねる。
      if (hasPrimaryModifier(e)) return;
```

を、次のブロックに置換する（先に複数選択系を拾ってから従来の委譲を行う）:

```ts
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
```

- [ ] **Step 3: 0–5 キーを選択全体への一括レーティングに対応させる**

`onKey` 内の `case "0": ... case "5":` ブロック全体:

```ts
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
```

を次に置換:

```ts
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
```

- [ ] **Step 4: 矢印移動で Shift の有無により単一/範囲を切り替える**

`onKey` 末尾の確定処理:

```ts
      e.preventDefault();
      selectImage(nextIndex);
      // 選択行を表示に追従させる。
      rowVirtualizer.scrollToIndex(Math.floor(nextIndex / columns));
```

を次に置換:

```ts
      e.preventDefault();
      if (e.shiftKey) selectRange(nextIndex);
      else selectSingle(nextIndex);
      // 選択行を表示に追従させる。
      rowVirtualizer.scrollToIndex(Math.floor(nextIndex / columns));
```

- [ ] **Step 5: 未使用になった selectImage を削除し、依存配列を更新**

矢印移動・auto-advance を `selectSingle` に統一したことで `selectImage` は未使用になる。取得行を削除する（`tsc` の noUnusedLocals 対策）:

```ts
  const selectImage = useViewerStore((s) => s.select);
```

（上記の 1 行を削除。`useViewerStore` の `select` アクション自体は他コンポーネント用に残す。）

`onKey` を登録している `useEffect` の依存配列（末尾 `}, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer, setRating, ratingMode, unratedOnly]);`）を次に置換（`selectImage` を除外）:

```ts
  }, [viewerOpen, results, selectedIndex, selection, columns, rowHeight, selectSingle, selectRange, selectAll, clearSelection, openViewer, rowVirtualizer, setRating, rateSelected, ratingMode, unratedOnly]);
```

- [ ] **Step 6: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし／PASS

- [ ] **Step 7: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): 全選択・選択解除・範囲拡張・一括レーティング/削除キーを追加"
```

---

### Task 10: 選択バーと削除確認ダイアログ

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`（import、削除実行関数、選択バー、ConfirmDialog）

- [ ] **Step 1: import を追加**

`src/components/ImageGridPanel.tsx` の import 群に追加:

```ts
import { ConfirmDialog } from "./ConfirmDialog";
import { clampAfterDelete } from "../util/selection";
```

- [ ] **Step 2: 削除実行と一括レーティングのハンドラを追加**

Task 8 のヘルパ群（`minSelectedIndex` の後ろ）に追加:

```ts
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
```

- [ ] **Step 3: 選択バーを描画する**

通常 return の `<>` 直後（`<div className="image-grid" ...>` の前）に追加:

```tsx
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
```

- [ ] **Step 4: 確認ダイアログを描画する**

通常 return の閉じ `</>` の直前（コンテキストメニューの即時関数 `})()}` の後ろ）に追加:

```tsx
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
```

- [ ] **Step 5: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし／PASS

- [ ] **Step 6: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): 選択バーと一括削除の確認ダイアログを追加"
```

---

### Task 11: 右クリックメニューの複数選択対応

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`（セルの onContextMenu、メニュー生成）

- [ ] **Step 1: セルに onContextMenu を付け、選択を確定させる**

Task 8 で編集したセルの `onDoubleClick={() => openViewer(globalIndex)}` の直後に追加:

```tsx
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // 選択外を右クリックしたらその項目を単一選択（Finder 標準挙動）。
                      if (!selection.has(globalIndex)) selectSingle(globalIndex);
                      parentRef.current?.focus();
                      showMenu(e.clientX, e.clientY, globalIndex);
                    }}
```

- [ ] **Step 2: コンテナの onContextMenu はブラウザメニュー抑止のみにする**

`<div className="image-grid" ...>` の既存 `onContextMenu`:

```tsx
      onContextMenu={(e) => {
        e.preventDefault();
        if (selectedIndex < 0 || !results[selectedIndex]) return;
        showMenu(e.clientX, e.clientY, results[selectedIndex].id);
      }}
```

を次に置換（余白の右クリックではメニューを出さない）:

```tsx
      onContextMenu={(e) => {
        e.preventDefault();
      }}
```

- [ ] **Step 3: メニュー生成を selection ベースに書き換える**

既存のメニュー即時関数:

```tsx
      {menuState.open && results[selectedIndex] && (() => {
        const target = results[selectedIndex];
        const menuItems: MenuEntry[] = [
          {
            label: "ビューアで開く",
            ...
          },
          ...
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
```

を次に置換:

```tsx
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
```

- [ ] **Step 4: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし／PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): 右クリックメニューを複数選択（一括レーティング/削除）に対応"
```

---

### Task 12: スタイル（選択バー・複数選択ハイライト）

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: スタイルを追加**

`src/App.css` の末尾に追加（既存の `.thumb-cell.selected` の配色・変数に合わせて微調整してよい）:

```css
/* 複数選択バー */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: var(--panel-bg, #2a2a2a);
  border-bottom: 1px solid var(--border, #444);
  flex: 0 0 auto;
}
.selection-count {
  font-weight: 600;
}
.selection-rating {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.selection-rate-btn {
  padding: 2px 6px;
}
.selection-bar .danger-btn {
  margin-left: auto;
}

/* 複数選択中のセル（アクティブ = .selected とは別の視覚表現） */
.thumb-cell.in-selection {
  outline: 2px solid var(--accent, #4a9eff);
  outline-offset: -2px;
}
```

- [ ] **Step 2: 手動確認**

Run: `npm run tauri dev`
確認:
- Cmd/Ctrl+クリックで複数トグル、Shift+クリックで範囲選択、Cmd/Ctrl+A で全選択、Esc で単一に戻る。
- Shift+矢印で範囲拡張。
- 選択バーの ★ ボタンで一括レーティング、「ゴミ箱へ移動」で確認ダイアログ→削除。
- 選択中に `0`–`5` で一括レーティング、`Delete`/`Backspace` で確認ダイアログ。
- 右クリック: 選択内は一括メニュー、選択外はその 1 件を選択して単一メニュー。
- 検索/ソート変更で選択が解除されること。

- [ ] **Step 3: コミット**

```bash
git add src/App.css
git commit -m "style(grid): 選択バーと複数選択ハイライトのスタイルを追加"
```

---

## Self-Review メモ

- **Spec coverage**:
  - A-1 選択モデル → Task 1, 7。
  - A-2 操作（クリック/矢印/Cmd+A/Esc/0-5/削除/Enter） → Task 8, 9。
  - A-3 UI（選択バー・ハイライト・右クリック・確認ダイアログ） → Task 8, 10, 11, 12。
  - A-4 バックエンド（set_ratings/delete_images） → Task 2, 3, 4, 5。
  - A-6 選択ライフサイクル（総入替で解除・削除後クランプ） → Task 6（runQuery フック）, 7（登録）, 10（doDelete のクランプ）。
  - A-7 エラー処理（失敗集計トースト） → Task 6。
  - A-8 テスト（純粋関数 vitest・Rust インライン） → Task 1, 2。
- **Type consistency**: `selectSingle/toggleSelect/selectRange/selectAll/clearSelection/resetSelection`、`rateSelected(ids, rating)`、`deleteSelected(items)`、`BatchDeleteResult{succeeded, failed[]}`、`set_ratings(&mut Connection, &[i64], Option<i64>)` を全タスクで統一。
- **既知の注意点**:
  - Backspace 単独でも削除確認が開く（設計で承認済み）。テキスト入力欄にフォーカスがあるときは `onKey` の `activeElement` ガードで無効。
  - `rustfmt` 未整形リポジトリのため、Rust は `cargo fmt` の全体適用をせず周囲のスタイルに手で合わせる。
  - 選択バーは `.image-grid` の親が縦フレックスである前提。レイアウトが崩れる場合は CSS（親の flex 配分）を手動調整。
