# PhaseB-1 レーティング（0-5）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像にレーティング（1-5、0でクリア）をキーボード（`0`-`5`）とマウス（★クリック）で付与・編集でき、一覧サムネイルとビューアに表示でき、再スキャンでも手動レーティングが消えないようにする。

**Architecture:** Rust 側に `images::set_rating` と Tauri コマンド `set_rating` を追加。再スキャン時に手動レーティングを保持するため upsert の ON CONFLICT を `rating=COALESCE(excluded.rating, images.rating)` に変更。フロントは `setRating` を `useQueryStore` に追加して `results` 行をその場で更新（再クエリしない）。一覧は ImageRow.rating を★バッジ表示、ビューアは `0-5` キーと MetadataPanel のクリック可能な★で編集する。

**Tech Stack:** Rust / rusqlite / Tauri 2 / React 19 / TypeScript / Zustand / Vitest（フロント）, `cargo test`（バックエンド）

---

## 既存実装の前提（壊さないこと）

- DB: `images.rating INTEGER`（nullable, indexed）。`ImageRow`/`ImageDetail`（`src-tauri/src/db/image_query.rs`）と `src/types.ts` 双方に `rating: Option<i64>` / `number | null` が既にある。
- レーティングのフィルタ（`rating:>=N`）は既に動作（parse.rs / FilterDialog）。本計画では**フィルタは触らない**。
- `upsert`（`src-tauri/src/db/images.rs`）の ON CONFLICT は現在 `rating=excluded.rating`。これを COALESCE に変える（Task 1）。
- 一覧キーボード: `ImageGridPanel.tsx` の keydown（`viewerOpen` 時は無効）。ビューア: `ImageViewer.tsx` の keydown。PhaseA のキー（Z/Home/End/PageUp/Down/I/F11 等）は維持。数字キー `0-5` はビューアでは PhaseA で解放済み（Zがズーム循環を担当）。一覧でも未使用。
- コマンド登録は `src-tauri/src/lib.rs` の `invoke_handler![...]`。フロント invoke ラッパーは `src/api/images.ts`。

## ファイル構成

- 変更: `src-tauri/src/db/images.rs` … `set_rating` 追加 + upsert の COALESCE 化
- 変更: `src-tauri/src/commands/query.rs` … `set_rating` コマンド追加
- 変更: `src-tauri/src/lib.rs` … コマンド登録
- 変更: `src/api/images.ts` … `setRating` ラッパー
- 変更: `src/store/useQueryStore.ts` / `src/store/useQueryStore.test.ts` … `setRating` アクション（results 行を更新）
- 変更: `src/components/ImageGridPanel.tsx` … `0-5` キー + ★バッジ
- 変更: `src/components/ImageViewer.tsx` … `0-5` キー + detail パッチ + MetadataPanel への onRate 配線
- 変更: `src/components/MetadataPanel.tsx` … クリック可能な★（onRate 任意プロップ）
- 変更: `src/App.css` … ★バッジ / ★コントロールのスタイル

---

## Task 1: Rust — `set_rating` と再スキャン時のレーティング保持

**Files:**
- Modify: `src-tauri/src/db/images.rs`

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/db/images.rs` の `mod tests` 内、最後のテストの後に追加:

```rust
    #[test]
    fn set_rating_updates_and_clears() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        set_rating(&c, id, Some(4)).unwrap();
        let r: Option<i64> = c
            .query_row("SELECT rating FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(r, Some(4));
        set_rating(&c, id, None).unwrap();
        let r2: Option<i64> = c
            .query_row("SELECT rating FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(r2, None);
    }

    #[test]
    fn rescan_preserves_manual_rating() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        set_rating(&c, id, Some(5)).unwrap();
        // 再スキャン相当: 同じ path を rating=None で upsert（メタデータにレーティングが無い通常ケース）。
        let again = upsert(&c, &sample("/d/a.png")).unwrap();
        assert_eq!(again, id);
        let r: Option<i64> = c
            .query_row("SELECT rating FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(r, Some(5), "manual rating must survive a rescan");
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd src-tauri && cargo test set_rating rescan_preserves`
Expected: コンパイルエラー（`set_rating` 未定義）

- [ ] **Step 3: `set_rating` を実装**

`src-tauri/src/db/images.rs` の `mark_missing` 関数の下に追加:

```rust
/// 画像のレーティングを更新する。None でクリア（NULL）。
pub fn set_rating(conn: &Connection, id: i64, rating: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE images SET rating = ?2 WHERE id = ?1",
        params![id, rating],
    )?;
    Ok(())
}
```

- [ ] **Step 4: upsert を再スキャン保持に変更**

同ファイルの `upsert` の ON CONFLICT 句で、`rating=excluded.rating,` の行を次に置換:

```rust
            rating=COALESCE(excluded.rating, images.rating), format=excluded.format, thumb_path=excluded.thumb_path,
```

（元は `rating=excluded.rating, format=excluded.format, thumb_path=excluded.thumb_path,` の1行。`format`/`thumb_path` 部分はそのまま、`rating` のみ COALESCE 化する。）

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cd src-tauri && cargo test`
Expected: 既存テスト含め全 PASS（`set_rating_updates_and_clears`, `rescan_preserves_manual_rating` 追加）

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/db/images.rs
git commit -m "feat(db): set_rating and preserve manual rating across rescans"
```
コミット本文末尾に: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 2: Rust — `set_rating` Tauri コマンド

**Files:**
- Modify: `src-tauri/src/commands/query.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: コマンドを追加**

`src-tauri/src/commands/query.rs` の末尾（`get_image_detail` の後）に追加。ファイル先頭の `use crate::db::Db;` は既にある:

```rust
/// 画像のレーティングを設定する（None でクリア）。
#[tauri::command]
pub fn set_rating(db: State<Db>, id: i64, rating: Option<i64>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::images::set_rating(&conn, id, rating).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: コマンドを登録**

`src-tauri/src/lib.rs` の `invoke_handler![...]` 内、`commands::query::get_image_detail,` の行の下に追加:

```rust
            commands::query::set_rating,
```

- [ ] **Step 3: ビルド確認**

Run: `cd src-tauri && cargo build`
Expected: コンパイル成功（警告なし）

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/commands/query.rs src-tauri/src/lib.rs
git commit -m "feat(commands): set_rating tauri command"
```
末尾に Co-Authored-By 行。

---

## Task 3: Frontend — API ラッパーと `useQueryStore.setRating`

**Files:**
- Modify: `src/api/images.ts`
- Modify: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`

- [ ] **Step 1: API ラッパーを追加**

`src/api/images.ts` の末尾に追加:

```ts
export const setRating = (id: number, rating: number | null) =>
  invoke<void>("set_rating", { id, rating });
```

- [ ] **Step 2: ストアの失敗するテストを書く**

`src/store/useQueryStore.test.ts` の `describe` 末尾に追加。`imagesApi` は既に `vi.mock("../api/images")` 済み:

```ts
  it("setRating calls api and patches the row in results", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({ results: [row(1, "a.png"), row(2, "b.png")] });
    await useQueryStore.getState().setRating(2, 4);
    expect(imagesApi.setRating).toHaveBeenCalledWith(2, 4);
    expect(useQueryStore.getState().results.find((r) => r.id === 2)?.rating).toBe(4);
    expect(useQueryStore.getState().results.find((r) => r.id === 1)?.rating).toBeNull();
  });

  it("setRating with null clears the row rating", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({ results: [{ ...row(1, "a.png"), rating: 5 }] });
    await useQueryStore.getState().setRating(1, null);
    expect(imagesApi.setRating).toHaveBeenCalledWith(1, null);
    expect(useQueryStore.getState().results[0].rating).toBeNull();
  });
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: FAIL（`setRating is not a function`）

- [ ] **Step 4: ストアに `setRating` を実装**

`src/store/useQueryStore.ts`:
- interface `QueryState` に追加（`loadSettings: () => Promise<void>;` の前あたり、メソッド群の中）:
```ts
  setRating: (id: number, rating: number | null) => Promise<void>;
```
- 実装に追加（`toggleShowFilename` などのアクションの近く、`loadSettings` の前）:
```ts
  setRating: async (id, rating) => {
    await imagesApi.setRating(id, rating);
    set({
      results: get().results.map((r) => (r.id === id ? { ...r, rating } : r)),
    });
  },
```

注: `imagesApi` は `import * as imagesApi from "../api/images";` で既に読み込まれている（ファイル冒頭）。

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: PASS

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/api/images.ts src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "feat(store): setRating action patches results row"
```
末尾に Co-Authored-By 行。

---

## Task 4: Frontend — 一覧の `0-5` キーと★バッジ

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: ストアから `setRating` を取得**

`src/components/ImageGridPanel.tsx` のフック取得部（`const showFilename = useQueryStore((s) => s.showFilename);` の下）に追加:

```ts
  const setRating = useQueryStore((s) => s.setRating);
```

- [ ] **Step 2: keydown に `0-5` を追加**

keydown ハンドラの `switch` 内、`case "Enter":` ブロックの直前に挿入する（`0-5` はナビゲーションではないので `nextIndex` の経路に流さず、その場で `return` する）:

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
            void setRating(target.id, e.key === "0" ? null : Number(e.key));
          }
          return;
        }
```

注: `cur`（`selectedIndex < 0 ? 0 : selectedIndex`）と `results` は同ハンドラ内のスコープに既にある。`len === 0` の早期 return も既存（その下なので空一覧では到達しない）。

- [ ] **Step 3: keydown useEffect の依存配列に `setRating` を追加**

現在の依存配列:
`  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer]);`
を次に変更:
`  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer, setRating]);`

- [ ] **Step 4: サムネイルに★バッジを表示（設定時のみ常時表示）**

セル内の `thumb-square` div（`<div className="thumb-square" style={{ height: cellSize }}>...</div>`）の閉じタグの直後、`{showFilename && (...)}` の前に追加:

```tsx
                    {img.rating != null && img.rating > 0 && (
                      <div className="thumb-rating" aria-label={`レーティング ${img.rating}`}>
                        {"★".repeat(img.rating)}
                      </div>
                    )}
```

注: `img` はセルの `ImageRow`、`img.rating` は `number | null`。

- [ ] **Step 5: CSS を追加**

`src/App.css` の末尾に追加:

```css
.thumb-cell {
  position: relative;
}
.thumb-rating {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 11px;
  line-height: 1;
  color: #ffce3d;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
```

注: `.thumb-cell` に `position: relative` が既存 CSS で付いていない前提で追加する。既に付いていれば重複定義は無害だが、確認して重複を避けてよい。

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 7: 手動確認**

Run: `npm run tauri dev`
確認: 一覧でサムネイルを選択し `3` を押す→★★★ バッジが出る。`0` でクリア。アプリ再起動後も保持（DB永続）。検索欄入力中は数字が入力に流れる（一覧ショートカットは発火しない＝activeElement ガード）。

- [ ] **Step 8: コミット**

```bash
git add src/components/ImageGridPanel.tsx src/App.css
git commit -m "feat(grid): rate selected image with 0-5 keys and show star badge"
```
末尾に Co-Authored-By 行。

---

## Task 5: Frontend — ビューアの `0-5` キーと MetadataPanel のクリック★

**Files:**
- Modify: `src/components/ImageViewer.tsx`
- Modify: `src/components/MetadataPanel.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: MetadataPanel をレーティング編集可能にする**

`src/components/MetadataPanel.tsx`:

(a) `Props` に任意コールバックを追加:
```ts
interface Props {
  detail: ImageDetail | null;
  onRate?: (rating: number | null) => void;
}
```
(b) 関数シグネチャを `export function MetadataPanel({ detail, onRate }: Props) {` に変更。
(c) レーティング表示行を、`onRate` がある時はクリック可能な★、無い時は従来表示に置き換える。現在の
```tsx
      <Row label="レーティング" value={detail.rating !== null ? `★${detail.rating}` : null} />
```
を次に置換:
```tsx
      {onRate ? (
        <div className="meta-row">
          <span className="meta-label">レーティング</span>
          <span className="meta-rating-stars" role="radiogroup" aria-label="レーティング">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = (detail.rating ?? 0) >= n;
              return (
                <button
                  key={n}
                  className={filled ? "star filled" : "star"}
                  aria-label={`${n} つ星`}
                  aria-pressed={filled}
                  // 同じ値を押したらクリア、それ以外はその値に設定。
                  onClick={() => onRate(detail.rating === n ? null : n)}
                >
                  {filled ? "★" : "☆"}
                </button>
              );
            })}
          </span>
        </div>
      ) : (
        <Row label="レーティング" value={detail.rating !== null ? `★${detail.rating}` : null} />
      )}
```

- [ ] **Step 2: ImageViewer に `0-5` キーと detail パッチを追加**

`src/components/ImageViewer.tsx`:

(a) ストアから取得を追加（`const cycleZoom = useViewerStore((s) => s.cycleZoom);` などの近く、ただし `setRating` は `useQueryStore` 側）。ファイル冒頭で `useQueryStore` は既に import 済み（`const results = useQueryStore((s) => s.results);` がある）。その近くに追加:
```ts
  const setRating = useQueryStore((s) => s.setRating);
```

(b) レーティング適用のヘルパーを、コンポーネント内（`if (!isOpen || !image) return null;` より前、フックの後）に定義:
```ts
  // 現在表示中の画像にレーティングを適用し、detail もその場で更新する。
  const applyRating = (rating: number | null) => {
    if (!image) return;
    void setRating(image.id, rating);
    setDetail((d) => (d ? { ...d, rating } : d));
  };
```
注: `image` は `results[index]`、`setDetail` は既存の useState セッター。

(c) keydown の `switch` に `0-5` を追加（`case "End": ... break;` の後あたり、`case "F11":` の前後どこでもよいが default の前）:
```ts
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          e.preventDefault();
          applyRating(e.key === "0" ? null : Number(e.key));
          break;
```

(d) keydown useEffect の依存配列に `applyRating` を含める必要を避けるため、`applyRating` は `image`/`setRating` に依存する。確実に最新を参照させるため、依存配列へ `image` と `setRating` を追加する。現在の依存配列:
`  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom, first, last, toggleMeta]);`
を次に変更:
`  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom, first, last, toggleMeta, image, setRating]);`
（`applyRating` は毎レンダー新規生成のクロージャだが、ハンドラ内で直接呼ぶので依存に入れる必要はない。`image`/`setRating` を入れれば最新値を捕捉できる。）

(e) detail 取得 effect が行パッチのたびに再フェッチしてちらつくのを防ぐため、依存を `image` から `image?.id` に変更する。現在:
```ts
  }, [isOpen, image]);
```
を次に変更:
```ts
  }, [isOpen, image?.id]);
```
（ナビゲーション時は id が変わるので従来どおり再フェッチ。同一画像の rating 行パッチでは再フェッチしない＝ローカル detail パッチで反映。）

(f) MetadataPanel に `onRate` を渡す。現在のレンダリング:
```tsx
      {metaOpen && <MetadataPanel detail={detail} />}
```
を次に変更:
```tsx
      {metaOpen && <MetadataPanel detail={detail} onRate={applyRating} />}
```

- [ ] **Step 3: ★コントロールの CSS を追加**

`src/App.css` の末尾に追加:

```css
.meta-rating-stars {
  display: inline-flex;
  gap: 2px;
}
.meta-rating-stars .star {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 1px;
  font-size: 15px;
  line-height: 1;
  color: #c9a227;
}
.meta-rating-stars .star:hover {
  color: #ffce3d;
}
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS（MetadataPanel の既存テストがあれば壊れていないこと。`onRate` 省略時は従来の `★N` 表示にフォールバック）

- [ ] **Step 5: 手動確認**

Run: `npm run tauri dev`
確認: ビューアで `4` を押すと情報パネルの★が4つ点灯、`0` でクリア。情報パネルの★クリックでも変更でき、同じ★を再クリックでクリア。一覧へ戻ると★バッジに反映されている（results 行が更新済み）。

- [ ] **Step 6: コミット**

```bash
git add src/components/ImageViewer.tsx src/components/MetadataPanel.tsx src/App.css
git commit -m "feat(viewer): rate current image with 0-5 keys and clickable stars"
```
末尾に Co-Authored-By 行。

---

## 完了確認（全タスク後）

- [ ] **全検証**

Run: `cd src-tauri && cargo test && cd .. && npx tsc --noEmit && npx vitest run && npm run build`
Expected: cargo テスト・フロントテスト・型チェック・ビルドすべて成功

- [ ] **総合手動確認**

Run: `npm run tauri dev`
1. 一覧で `1`-`5`/`0` でレーティング設定・クリア、★バッジ表示。
2. ビューアで `0`-`5` と情報パネルの★クリックで編集、双方向に一致。
3. 一覧↔ビューアで表示が同期。
4. 再スキャン（ディレクトリの再スキャン）後も手動レーティングが残る。
5. `rating:>=3` フィルタ（既存）が手動付与の値で正しく効く。

---

## Self-Review

**1. Spec coverage:**
- 0-5 キーでレーティング（0クリア）: 一覧 Task 4 / ビューア Task 5 ✅
- マウス編集（★クリック）: Task 5（MetadataPanel）✅
- 一覧サムネイル表示（設定時のみ常時）: Task 4 ✅
- ビューア表示: Task 5（情報パネル★）✅
- 再スキャンで保持: Task 1（COALESCE）✅
- フィルタ連携: 既存機能を流用（新規作業なし）✅

**2. Placeholder scan:** プレースホルダなし。各ステップに実コード。

**3. Type consistency:**
- Rust `set_rating(conn, id: i64, rating: Option<i64>)` … db/command/登録で一致。
- Frontend `setRating(id: number, rating: number | null)` … api/store/呼び出し側で一致。
- `MetadataPanel` の `onRate?: (rating: number | null) => void` … ImageViewer の `applyRating` と一致。
- ストアアクション名 `setRating` … interface 宣言・実装・各コンポーネントの取得で一致。
