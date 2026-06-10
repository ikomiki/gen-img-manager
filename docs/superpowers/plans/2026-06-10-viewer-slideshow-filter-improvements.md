# ビューア/スライドショー/フィルタ改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レーティング入力モードの送り挙動変更・スライドショーへのレーティング/パスコピー追加・フィルタ詳細ダイアログの 4 改善（補完無効化・✕クリア・左端揃え・ESC/外側クリック制御）を実装する。

**Architecture:** フロントは React 19 + Zustand。共通ロジック（未評価探索）は純関数として `src/util` に切り出し vitest で検証。スライドショーは別ウィンドウのため Rust 側の `SlideshowPayload` に id を追加して `set_rating(id)` を呼べるようにする。UI レイアウトは CSS グリッドで左端を揃える。

**Tech Stack:** Tauri 2 (Rust) / React 19 / TypeScript / Zustand / Vitest / React Testing Library / cargo test

---

## 作業対象ファイル一覧

**新規作成**
- `src/util/ratingNav.ts` — 未評価探索の純関数
- `src/util/ratingNav.test.ts` — 上記のテスト

**変更**
- `src/store/useQueryStore.ts` — `runQuery` の絞り込み削除 / `setRating` の splice 削除
- `src/store/useQueryStore.test.ts` — 「未入力のみフィルタ」を新仕様に更新
- `src/store/useViewerStore.ts` — `goTo(index)` アクション追加
- `src/components/ImageViewer.tsx` — `applyRating` を新仕様に
- `src/components/ImageGridPanel.tsx` — レーティング後の次未評価送り / スライドショー起動に id 付与
- `src/components/FilterBar.tsx` — スライドショー起動に id 付与
- `src/components/SlideshowApp.tsx` — レーティング/パスコピーのキー追加・id/xmpAuto 保持
- `src/components/FilterDialog.tsx` — 補完無効化 / ✕ クリア / レイアウト / ESC・外側クリック
- `src/components/FilterDialog.test.tsx` — ✕ クリア・ESC・外側クリックのケース追加
- `src/components/HelpOverlay.tsx` — スライドショーのショートカット追記
- `src/App.css` — フィルタダイアログのフィールドグリッド
- `src/types.ts` — `SlideshowPayload` に `ids`
- `src/api/slideshow.ts` — `startSlideshow` に `ids`
- `src-tauri/src/commands/slideshow.rs` — payload に `ids` / コマンド引数 / テスト
- `src-tauri/src/menu.rs` — `unrated_only` の表示名変更

---

## Task 1: 未評価探索の純関数 `nextUnratedIndex`

**Files:**
- Create: `src/util/ratingNav.ts`
- Test: `src/util/ratingNav.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/ratingNav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextUnratedIndex } from "./ratingNav";

const r = (rating: number | null) => ({ rating });

describe("nextUnratedIndex", () => {
  it("fromIndex より後ろで最初の rating==null を返す", () => {
    const list = [r(3), r(4), r(null), r(2), r(null)];
    expect(nextUnratedIndex(list, 0)).toBe(2);
  });

  it("見つからなければ -1", () => {
    const list = [r(null), r(3), r(4)];
    expect(nextUnratedIndex(list, 0)).toBe(-1);
  });

  it("fromIndex 自身は探索対象外（前方のみ）", () => {
    const list = [r(null), r(null)];
    expect(nextUnratedIndex(list, 0)).toBe(1);
  });

  it("末尾 fromIndex では -1", () => {
    const list = [r(null), r(3)];
    expect(nextUnratedIndex(list, 1)).toBe(-1);
  });

  it("空配列では -1", () => {
    expect(nextUnratedIndex([], 0)).toBe(-1);
  });

  it("fromIndex が範囲外（負）でも先頭から探索する", () => {
    const list = [r(null), r(3)];
    expect(nextUnratedIndex(list, -1)).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/util/ratingNav.test.ts`
Expected: FAIL（`nextUnratedIndex` が未定義）

- [ ] **Step 3: 最小実装**

`src/util/ratingNav.ts`:
```ts
/** fromIndex より後ろで最初に rating==null の index を返す。無ければ -1。 */
export function nextUnratedIndex(
  results: { rating: number | null }[],
  fromIndex: number,
): number {
  for (let i = fromIndex + 1; i < results.length; i++) {
    if (results[i].rating == null) return i;
  }
  return -1;
}
```

- [ ] **Step 4: テスト合格を確認**

Run: `pnpm vitest run src/util/ratingNav.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add src/util/ratingNav.ts src/util/ratingNav.test.ts
git commit -m "feat(util): add nextUnratedIndex for rating navigation"
```

---

## Task 2: ストアの絞り込み・splice を廃止

**Files:**
- Modify: `src/store/useQueryStore.ts`（`runQuery` / `setRating`）
- Test: `src/store/useQueryStore.test.ts`（「未入力のみフィルタ」describe）

- [ ] **Step 1: テストを新仕様に更新**

`src/store/useQueryStore.test.ts` の `describe("未入力のみフィルタ", ...)` ブロック全体を次に置き換える:
```ts
describe("レーティング入力モード（リスト非絞り込み）", () => {
  it("ratingMode && unratedOnly でも runQuery は絞り込まない", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([
      { id: 1, path: "/a", filename: "a", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      { id: 2, path: "/b", filename: "b", thumb_path: null, width: 1, height: 1, pixels: 1, rating: 4, created_at: null, modified_at: null, source_tool: "x", model: null },
    ]);
    useQueryStore.setState({ ratingMode: true, unratedOnly: true });
    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().results.map((r) => r.id)).toEqual([1, 2]);
  });

  it("ratingMode && unratedOnly でも setRating は splice せず in-place 更新", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({
      ratingMode: true,
      unratedOnly: true,
      xmpAutoExport: false,
      results: [
        { id: 1, path: "/a", filename: "a", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
        { id: 2, path: "/b", filename: "b", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      ],
    });
    await useQueryStore.getState().setRating(1, 4);
    const st = useQueryStore.getState();
    expect(st.results.map((r) => r.id)).toEqual([1, 2]);
    expect(st.results.find((r) => r.id === 1)?.rating).toBe(4);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/store/useQueryStore.test.ts`
Expected: FAIL（現行コードは絞り込み/ splice する）

- [ ] **Step 3: `runQuery` の絞り込みを削除**

`src/store/useQueryStore.ts` の `runQuery` を次のように変更（filter ブロックを除去）:
```ts
  runQuery: async () => {
    const { query, sort, dir } = get();
    const results = await imagesApi.queryImages(query, sort, dir, -1, 0);
    set({ results, total: results.length });
    prefsApi
      .setSetting("filter_query", query)
      .catch((e) => console.error("setSetting(filter_query) failed:", e));
  },
```

- [ ] **Step 4: `setRating` の splice を削除**

`src/store/useQueryStore.ts` の `setRating` 末尾の分岐を、常に in-place 更新へ一本化する。XMP 連携部分（前半）は維持し、後半を次に置き換える:
```ts
    // ratingMode/unratedOnly でもリストからは除去しない（送り制御は呼び出し側で行う）。
    set({ results: get().results.map((r) => (r.id === id ? { ...r, rating } : r)) });
```
（`const { xmpAutoExport, ratingMode, unratedOnly } = get();` は `ratingMode`/`unratedOnly` を参照しなくなるため `const { xmpAutoExport } = get();` に変更。）

- [ ] **Step 5: テスト合格を確認**

Run: `pnpm vitest run src/store/useQueryStore.test.ts`
Expected: PASS（既存ケース含め全件）

- [ ] **Step 6: コミット**

```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "refactor(store): keep full list in rating mode, drop unrated filter/splice"
```

---

## Task 3: ビューアストアに `goTo` を追加

**Files:**
- Modify: `src/store/useViewerStore.ts`
- Test: `src/store/useViewerStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/store/useViewerStore.test.ts` に追記（既存 describe 内、もしくは新 describe）。まず先頭付近の results をセットする方法を既存テストに合わせる。`useQueryStore` の results をセットして `goTo` のクランプを検証する:
```ts
import { useQueryStore } from "./useQueryStore";

describe("goTo", () => {
  it("index を範囲内にクランプして設定する", () => {
    useQueryStore.setState({
      results: [
        { id: 1, path: "/a", filename: "a", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
        { id: 2, path: "/b", filename: "b", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
        { id: 3, path: "/c", filename: "c", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      ],
    });
    useViewerStore.getState().goTo(1);
    expect(useViewerStore.getState().index).toBe(1);
    useViewerStore.getState().goTo(99);
    expect(useViewerStore.getState().index).toBe(2);
    useViewerStore.getState().goTo(-5);
    expect(useViewerStore.getState().index).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/store/useViewerStore.test.ts`
Expected: FAIL（`goTo` が未定義）

- [ ] **Step 3: `goTo` を実装**

`src/store/useViewerStore.ts` の `ViewerState` インターフェースに追加:
```ts
  goTo: (index: number) => void;
```
ストア実装の `last:` の直後あたりに追加:
```ts
  goTo: (index) =>
    set({ index: Math.min(Math.max(index, 0), Math.max(resultsLength() - 1, 0)) }),
```

- [ ] **Step 4: テスト合格を確認**

Run: `pnpm vitest run src/store/useViewerStore.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/store/useViewerStore.ts src/store/useViewerStore.test.ts
git commit -m "feat(viewer-store): add goTo(index) action"
```

---

## Task 4: ビューアの `applyRating` を新仕様へ

**Files:**
- Modify: `src/components/ImageViewer.tsx`

注: このタスクはコンポーネントロジック変更で、純粋ロジックの単体テストは持たない（手動確認 + 後続 `pnpm test` 通過で担保）。`applyRating` の `unratedOnly` 分岐を `nextUnratedIndex` ベースに置き換える。

- [ ] **Step 1: import と `goTo` 取得を追加**

`src/components/ImageViewer.tsx` 冒頭の import に追加:
```ts
import { nextUnratedIndex } from "../util/ratingNav";
```
`useViewerStore` のセレクタ群（`const last = useViewerStore((s) => s.last);` の近く）に追加:
```ts
  const goTo = useViewerStore((s) => s.goTo);
```

- [ ] **Step 2: `applyRating` の本体を置き換える**

現行の `applyRating` 内、`if (!ratingMode) return;` 以降を次に置き換える:
```ts
        if (!ratingMode) return;
        if (unratedOnly) {
          if (rating === null) return; // クリアは留まる
          const results = useQueryStore.getState().results;
          const ni = nextUnratedIndex(results, useViewerStore.getState().index);
          if (ni >= 0) goTo(ni); // 見つからなければ留まる
        } else {
          next(); // 従来どおり
        }
```
（旧 `if (unratedOnly && rating !== null) { ... close()/last() ... } else { next() }` ブロックを丸ごと置換。`close`/`last` はキー処理など他で使われていれば残し、未使用になったら依存配列から外す。）

- [ ] **Step 3: `applyRating` の依存配列を更新**

`useCallback` の依存配列を `[image, setRating, ratingMode, unratedOnly, next, goTo]` に更新する（`close`/`last` が `applyRating` 内で未使用になったため除去。ただし `deleteCurrent` など他で `close`/`last` を使う箇所は変更しない）。

- [ ] **Step 4: 型チェックとテスト**

Run: `pnpm test`
Expected: PASS（ビルド/型エラーなし、既存テスト通過）

- [ ] **Step 5: コミット**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat(viewer): advance to next unrated after rating in unratedOnly mode"
```

---

## Task 5: グリッドのレーティング後送り

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: import とストア購読を追加**

`src/components/ImageGridPanel.tsx` の import に追加:
```ts
import { nextUnratedIndex } from "../util/ratingNav";
```
`results`/`setRating` の購読近くに追加:
```ts
  const ratingMode = useQueryStore((s) => s.ratingMode);
  const unratedOnly = useQueryStore((s) => s.unratedOnly);
```

- [ ] **Step 2: `0–5` キー処理に送り処理を追加**

現行の `case "0": ... case "5": { ... }` ブロックを次に置き換える:
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

- [ ] **Step 3: keydown effect の依存配列を更新**

`useEffect` の依存配列に `ratingMode, unratedOnly` を追加する。

- [ ] **Step 4: 型チェックとテスト**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): advance selection to next unrated after rating"
```

---

## Task 6: メニュー表示名の変更

**Files:**
- Modify: `src-tauri/src/menu.rs:36-37`

- [ ] **Step 1: 表示名を変更**

`src-tauri/src/menu.rs` の `unrated_only` 生成行の文字列を変更:
```rust
    let unrated_only =
        CheckMenuItem::with_id(app, "unrated_only", "レーティング後に未入力へ送る", false, false, None::<&str>)?;
```
（id `"unrated_only"`・有効/無効初期値・以降の同期処理は変更しない。）

- [ ] **Step 2: Rust ビルド確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 成功（警告のみ可）

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/menu.rs
git commit -m "feat(menu): rename unrated-only item to reflect new behavior"
```

---

## Task 7: スライドショー payload に id を追加（Rust）

**Files:**
- Modify: `src-tauri/src/commands/slideshow.rs`

- [ ] **Step 1: テストを新仕様に更新**

`src-tauri/src/commands/slideshow.rs` の `tests` モジュール内 2 つの `SlideshowPayload { ... }` リテラルに `ids` を追加する:
```rust
    #[test]
    fn set_then_get_roundtrip_and_overwrite() {
        let state = SlideshowState::default();
        set_payload(
            &state,
            SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], ids: vec![1, 2], start_index: 1 },
        );
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], ids: vec![1, 2], start_index: 1 })
        );
        set_payload(&state, SlideshowPayload { paths: vec!["/c.png".into()], ids: vec![3], start_index: 0 });
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/c.png".into()], ids: vec![3], start_index: 0 })
        );
    }
```

- [ ] **Step 2: テストが失敗（コンパイルエラー）することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slideshow`
Expected: FAIL（`ids` フィールド未定義でコンパイルエラー）

- [ ] **Step 3: 構造体とコマンドに `ids` を追加**

`SlideshowPayload` に追加:
```rust
pub struct SlideshowPayload {
    pub paths: Vec<String>,
    pub ids: Vec<i64>,
    pub start_index: usize,
}
```
`start_slideshow` コマンド:
```rust
pub fn start_slideshow(
    app: AppHandle,
    state: State<SlideshowState>,
    paths: Vec<String>,
    ids: Vec<i64>,
    start_index: usize,
) -> Result<(), String> {
    set_payload(&state, SlideshowPayload { paths, ids, start_index });
    // 以降は変更なし
```

- [ ] **Step 4: テスト合格を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slideshow`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/commands/slideshow.rs
git commit -m "feat(slideshow-rs): carry image ids in slideshow payload"
```

---

## Task 8: TS 型と API に id を反映、呼び出し元を更新

**Files:**
- Modify: `src/types.ts`, `src/api/slideshow.ts`, `src/components/FilterBar.tsx`, `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: 型を更新**

`src/types.ts` の `SlideshowPayload`:
```ts
export interface SlideshowPayload {
  paths: string[];
  ids: number[];
  start_index: number;
}
```

- [ ] **Step 2: API シグネチャを更新**

`src/api/slideshow.ts`:
```ts
/** 現在のリストのスナップショットを保存し、スライドショーウィンドウを起動する。 */
export const startSlideshow = (paths: string[], ids: number[], startIndex: number) =>
  invoke<void>("start_slideshow", { paths, ids, startIndex });
```

- [ ] **Step 3: 呼び出し元を更新**

`src/components/FilterBar.tsx` の `launchSlideshow`:
```ts
  const launchSlideshow = () => {
    if (results.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : 0;
    void startSlideshow(
      results.map((r) => r.path),
      results.map((r) => r.id),
      start,
    ).catch((e) => console.error("スライドショー起動に失敗しました:", e));
  };
```
`src/components/ImageGridPanel.tsx` のコンテキストメニュー「スライドショー開始」:
```ts
              void startSlideshow(
                results.map((r) => r.path),
                results.map((r) => r.id),
                selectedIndex,
              ).catch((e) => console.error("スライドショー起動に失敗しました:", e));
```

- [ ] **Step 4: 型チェックとテスト**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/api/slideshow.ts src/components/FilterBar.tsx src/components/ImageGridPanel.tsx
git commit -m "feat(slideshow): pass image ids when launching slideshow"
```

---

## Task 9: スライドショーのレーティング/パスコピー キー

**Files:**
- Modify: `src/components/SlideshowApp.tsx`

- [ ] **Step 1: import と state を追加**

`src/components/SlideshowApp.tsx` の import に追加:
```ts
import { setRating as setRatingApi } from "../api/images";
import { writeXmpRating } from "../api/fs";
```
state 群に追加:
```ts
  const [ids, setIds] = useState<number[]>([]);
  const [xmpAuto, setXmpAuto] = useState(false);
```
多重実行防止の ref（`toastTimer` の近く）:
```ts
  const ratingBusy = useRef(false);
```

- [ ] **Step 2: 初期化で ids と xmp_auto を読み込む**

初期化 `useEffect` の `Promise.all` に `getSetting("xmp_auto")` を追加し、分解と適用を行う:
```ts
      const [payload, iv, lp, rnd, sf, sp, xa] = await Promise.all([
        getSlideshowPayload(),
        getSetting("slideshow_interval"),
        getSetting("slideshow_loop"),
        getSetting("slideshow_random"),
        getSetting("show_current_filename"),
        getSetting("show_current_position"),
        getSetting("xmp_auto"),
      ]);
```
適用部（`setShowPosition(...)` の後あたり）:
```ts
      setXmpAuto(xa === "true");
```
`setPaths(p);` の近くで ids も保存:
```ts
      setIds(payload?.ids ?? []);
```

- [ ] **Step 3: レーティング適用関数を追加**

`toggleFullscreen` の近くに追加:
```ts
  // 現在表示中の画像にレーティングを適用（DB + XMP）。一覧へは即時反映しない。
  const applyRating = useCallback(
    async (rating: number | null) => {
      if (ratingBusy.current) return;
      const ord = orderRef.current;
      const imgIndex = ord[posRef.current];
      const id = ids[imgIndex];
      const path = paths[imgIndex];
      if (id == null) return;
      ratingBusy.current = true;
      try {
        await setRatingApi(id, rating);
        if (xmpAuto && path) {
          try {
            await writeXmpRating(path, rating);
          } catch (e) {
            console.error("XMP書き出しに失敗しました:", e);
            showToast("XMPの書き出しに失敗しました");
          }
        }
        showToast(rating === null ? "レーティングをクリア" : `★${rating} を設定`);
      } catch (e) {
        console.error("レーティング設定に失敗しました:", e);
        showToast("レーティング設定に失敗しました");
      } finally {
        ratingBusy.current = false;
      }
    },
    [ids, paths, xmpAuto, showToast],
  );
```

- [ ] **Step 4: キーボードハンドラに 0–5 と C を追加**

キーボード `useEffect` の `onKey` 内、最初の `isFullscreenToggleKey` ガードの直後に入力欄フォーカスのガードを追加:
```ts
      const ae = document.activeElement;
      const typing =
        ae instanceof HTMLElement &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
```
`switch (e.key)` に `case` を追加（`default` の前）:
```ts
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          if (typing) break;
          e.preventDefault();
          void applyRating(e.key === "0" ? null : Number(e.key));
          break;
        case "c":
        case "C": {
          if (typing) break;
          e.preventDefault();
          const cur = orderRef.current.length > 0 ? paths[orderRef.current[posRef.current]] : undefined;
          if (cur) {
            void navigator.clipboard
              .writeText(cur)
              .catch((err) => console.error("パスのコピーに失敗しました:", err));
            showToast("パスをコピーしました");
          }
          break;
        }
```

- [ ] **Step 5: キーボード effect の依存配列を更新**

`useEffect(..., [advance, toggleFullscreen])` を `[advance, toggleFullscreen, applyRating, paths, showToast]` に更新する。

- [ ] **Step 6: 型チェックとテスト**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/components/SlideshowApp.tsx
git commit -m "feat(slideshow): add rating (0-5) and copy-path (C) shortcuts"
```

---

## Task 10: ヘルプにスライドショーのショートカット追記

**Files:**
- Modify: `src/components/HelpOverlay.tsx`

- [ ] **Step 1: スライドショーセクションに行を追加**

`src/components/HelpOverlay.tsx` の「スライドショー」セクションの rows に追加（Home/End の後、Esc の前）:
```ts
      { keys: "0 - 5", desc: "レーティング設定（0でクリア）" },
      { keys: "C", desc: "パスをコピー" },
```

- [ ] **Step 2: テスト**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/components/HelpOverlay.tsx
git commit -m "docs(help): add slideshow rating and copy-path shortcuts"
```

---

## Task 11: フィルタダイアログ — 補完無効化（#3）

**Files:**
- Modify: `src/components/FilterDialog.tsx`

- [ ] **Step 1: 全 input に補完無効化属性を付与**

`src/components/FilterDialog.tsx` の 7 つの `<input>`（幅下限・高さ下限・プロンプト・ネガティブ・モデル名・サンプラー・ツール）すべてに次を付与:
```tsx
spellCheck={false}
autoCorrect="off"
autoCapitalize="off"
autoComplete="off"
```
例（プロンプト）:
```tsx
<input
  type="text"
  value={prompt}
  onChange={(e) => setPrompt(e.target.value)}
  aria-label="プロンプト"
  spellCheck={false}
  autoCorrect="off"
  autoCapitalize="off"
  autoComplete="off"
/>
```

- [ ] **Step 2: テスト**

Run: `pnpm vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（既存ケース）

- [ ] **Step 3: コミット**

```bash
git add src/components/FilterDialog.tsx
git commit -m "feat(filter-dialog): disable spellcheck/autocomplete on inputs"
```

---

## Task 12: フィルタダイアログ — ✕クリア & 左端揃え（#4 + #5）

**Files:**
- Modify: `src/components/FilterDialog.tsx`, `src/App.css`
- Test: `src/components/FilterDialog.test.tsx`

- [ ] **Step 1: ✕ クリアの失敗テストを追加**

`src/components/FilterDialog.test.tsx` の `describe("FilterDialog", ...)` 内に追加:
```ts
  it("✕ ボタンでプロンプト入力をクリアできる", () => {
    render(<FilterDialog onClose={() => {}} />);
    const input = screen.getByLabelText("プロンプト") as HTMLInputElement;
    expect(input.value).toBe("best quality");
    fireEvent.click(screen.getByLabelText("プロンプトをクリア"));
    expect(input.value).toBe("");
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/components/FilterDialog.test.tsx`
Expected: FAIL（`プロンプトをクリア` のボタンが無い）

- [ ] **Step 3: フィールド群を `.filter-fields` グリッドに再構成**

`src/components/FilterDialog.tsx` の `<h3>詳細フィルタ</h3>` から作成日フィールド（`<div className="date-fields">`）の直前までの `<label>` 群を `<div className="filter-fields">...</div>` で囲い、各 `<label>` を次の構造にする。

レーティング:
```tsx
<label>
  <span className="field-label">レーティング下限</span>
  <span className="field-input">
    <select value={minRating} onChange={(e) => setMinRating(e.target.value)} aria-label="レーティング下限">
      <option value="">指定なし</option>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>★{n}以上</option>
      ))}
    </select>
  </span>
</label>
```
幅下限（数値、✕ あり。Step 1 のプロンプト同様に他フィールドも同型）:
```tsx
<label>
  <span className="field-label">幅下限(px)</span>
  <span className="field-input">
    <input type="number" min="0" step="1" value={minWidth} onChange={(e) => setMinWidth(e.target.value)}
      aria-label="幅下限(px)" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
    {minWidth && (
      <button type="button" className="field-clear" aria-label="幅下限(px)をクリア" onClick={() => setMinWidth("")}>✕</button>
    )}
  </span>
</label>
```
高さ下限（同型、`aria-label="高さ下限(px)"`、`setMinHeight`）。
プロンプト（text、✕ あり）:
```tsx
<label>
  <span className="field-label">プロンプト</span>
  <span className="field-input">
    <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)}
      aria-label="プロンプト" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
    {prompt && (
      <button type="button" className="field-clear" aria-label="プロンプトをクリア" onClick={() => setPrompt("")}>✕</button>
    )}
  </span>
</label>
```
ネガティブ（`aria-label="ネガティブ"`, `negative`/`setNegative`）、モデル名（`aria-label="モデル名"`, `model`/`setModel`）、サンプラー（`aria-label="サンプラー"`, `sampler`/`setSampler`）、ツール（`aria-label="ツール"`, `tool`/`setTool`）も同型で記述する。

注: 数値欄は number 入力。`minWidth`/`minHeight` は文字列 state なので空判定 `{minWidth && ...}` で可。

- [ ] **Step 4: CSS を追加**

`src/App.css` の `.filter-dialog label { ... }` と `.filter-dialog input[type="text"], .filter-dialog input[type="number"] { ... }` の 2 ブロックを次に置き換える（`.filter-dialog` 本体定義は残す）:
```css
.filter-fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 8px 12px;
}
.filter-fields label { display: contents; }
.filter-fields .field-label { white-space: nowrap; }
.filter-fields .field-input {
  position: relative;
  display: flex;
  align-items: center;
}
.filter-fields .field-input input,
.filter-fields .field-input select {
  flex: 1;
  min-width: 0;
}
.filter-fields .field-input input {
  padding-right: 1.8em;
}
.filter-fields .field-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  color: #666;
}
```

- [ ] **Step 5: テスト合格を確認**

Run: `pnpm vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（既存 + 新規 ✕ クリア）

- [ ] **Step 6: コミット**

```bash
git add src/components/FilterDialog.tsx src/App.css src/components/FilterDialog.test.tsx
git commit -m "feat(filter-dialog): clear buttons and aligned field layout"
```

---

## Task 13: フィルタダイアログ — 外側クリック無効化 & ESC で閉じる（#6）

**Files:**
- Modify: `src/components/FilterDialog.tsx`
- Test: `src/components/FilterDialog.test.tsx`

- [ ] **Step 1: 失敗テストを追加（外側クリックで閉じない / ESC で閉じる）**

`src/components/FilterDialog.test.tsx` に追加。`container` を使うため `render` の戻り値を受ける:
```ts
  it("背景クリックでは閉じない", () => {
    const onClose = vi.fn();
    const { container } = render(<FilterDialog onClose={onClose} />);
    fireEvent.click(container.querySelector(".dialog-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ESC で閉じる", () => {
    const onClose = vi.fn();
    render(<FilterDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/components/FilterDialog.test.tsx`
Expected: FAIL（背景クリックで現状は閉じる / ESC ハンドラ未実装）

- [ ] **Step 3: 背景 onClick を削除し、ESC ハンドラを追加**

`src/components/FilterDialog.tsx`:
- import に `useEffect` を追加（現行は `useMemo, useState`）。
- 返り値の最外周を変更:
```tsx
    <div className="dialog-backdrop">
      <div className="dialog filter-dialog">
```
（`onClick={onClose}` と `onClick={(e) => e.stopPropagation()}` を削除。）
- コンポーネント本体（return 前）に ESC 用 effect を追加:
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();   // フルスクリーン解除抑止（ベストエフォート）
        e.stopPropagation();  // App グローバルキーへ伝播させない
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
```

- [ ] **Step 4: テスト合格を確認**

Run: `pnpm vitest run src/components/FilterDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx
git commit -m "feat(filter-dialog): keep open on backdrop click, close on Esc"
```

---

## Task 14: 全体検証

- [ ] **Step 1: フロントの全テスト**

Run: `pnpm test`
Expected: PASS（全件）

- [ ] **Step 2: Rust の全テスト**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS（全件）

- [ ] **Step 3: 型チェック/ビルド**

Run: `pnpm build`
Expected: 成功（tsc + vite build がエラーなし）

- [ ] **Step 4: 手動確認（任意・実機）**

`pnpm tauri dev` で以下を確認:
- レーティング入力モード + 「レーティング後に未入力へ送る」ON: ビューア/グリッドで評価すると次の未評価へ進む。誤入力時に ← で直前へ戻れる。前方に未評価が無いと留まる。
- スライドショー: 0–5 で ★ トースト・C でパスコピートースト。間隔欄フォーカス中は数字でレーティングされない。
- フィルタ詳細: ✕ で各欄クリア・入力欄左端が揃う・補完が出ない・背景クリックで閉じない・ESC で閉じる（全画面が解除されない）。

---

## Self-Review メモ（作成者確認済み）

- **Spec coverage**: #1=Task1-6, #2=Task7-10, #3=Task11, #4/#5=Task12, #6=Task13。全項目に対応タスクあり。
- **Placeholders**: 各ステップに実コード/実コマンドを記載。プレースホルダなし。
- **Type consistency**: `nextUnratedIndex`（Task1）を Task4/5 で同名使用。`SlideshowPayload.ids`（Task7 Rust / Task8 TS）一致。`startSlideshow(paths, ids, startIndex)` を Task8 の全呼び出し元で一致。`goTo`（Task3 定義 / Task4 使用）一致。
