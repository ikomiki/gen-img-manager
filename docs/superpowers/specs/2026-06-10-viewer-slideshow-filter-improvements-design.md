# ビューア/スライドショー/フィルタ改善 設計

作成日: 2026-06-10

## 概要

6 件の UI 挙動変更・機能追加をまとめて実装する。

1. レーティング入力モードの「未入力へ送る」挙動の変更
2. スライドショーへのショートカット追加（レーティング設定・パスコピー）
3. フィルタ詳細ダイアログ: スペルチェック/入力補完の無効化
4. フィルタ詳細ダイアログ: 入力欄に ✕ クリアボタン追加
5. フィルタ詳細ダイアログ: 入力欄の左端揃え
6. フィルタ詳細ダイアログ: 外側クリックで閉じない／ESC で閉じる

## 確定した決定事項

- **#2 スライドショーのレーティング範囲**: DB へ書き込み + XMP 自動書き出しが ON なら XMP も更新。トーストで ★ を表示。メインウィンドウ一覧への即時反映は行わない（次回クエリ時に反映）。
- **#1 前方に未評価が無い場合**: その場に留まる。
- **#1 メニュー表示名**: 新挙動に合わせて改名する（「レーティング後に未入力へ送る」）。id・設定キーは据え置き。
- **#4 ✕ クリアボタンの対象**: テキスト欄 + 数値欄。レーティングのセレクトは対象外、作成日は既存「クリア」を使用。

---

## 共通: 未評価探索ヘルパー

`src/util/ratingNav.ts`（新規）

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

`src/util/ratingNav.test.ts`（新規）で純関数として検証する（前方探索・該当なしで -1・末尾・空配列・fromIndex が範囲外）。

---

## #1 レーティング入力モード「未入力へ送る」の挙動変更

### 現状の挙動（廃止する）

- `runQuery`（`useQueryStore.ts`）: `ratingMode && unratedOnly` のとき `results` を `rating==null` のみに絞り込む。
- `setRating`（`useQueryStore.ts`）: `ratingMode && unratedOnly && rating!==null` のとき評価済み画像を `results` から除去（splice）。インデックス据え置きで次の未入力が表示される副作用に依存していた。
- グリッド/ビューアともに、この splice の副作用で実質的に次へ送られていた。

### 変更後の挙動

- **リストは標準（全件）のまま**。`runQuery` の `unratedOnly` 絞り込みを削除する。
- `setRating` の splice を削除し、常にその場で `rating` を更新する（既存の else 分岐に一本化）。
- **評価付与（1〜5）時に「次の未評価」へ送る処理**を、ビューアとグリッドの双方に追加する。
  - 探索は `nextUnratedIndex(results, currentIndex)`（前方のみ）。
  - 見つかればそこへ移動、**見つからなければ留まる**。
  - レーティングのクリア（0 / null）では送らず留まる。
- カーソルキー左右はインデックス移動のまま（評価済みも対象）。これにより誤入力時に直前へ戻れる。
- `unratedOnly` OFF（入力モードのみ）の場合は従来どおり: ビューアは `next()`、グリッドは留まる（変更しない）。

### 変更ファイル

**`src/store/useQueryStore.ts`**
- `runQuery`: `if (ratingMode && unratedOnly) { results = results.filter(...) }` ブロックを削除。
- `setRating`: `ratingMode && unratedOnly && rating!==null` の splice 分岐を削除し、常に `results.map(...)` で rating を更新。XMP 連携部分は維持。

**`src/store/useViewerStore.ts`**
- ビューアの index を任意位置へ移すアクション `goTo(index: number)` を追加（`Math.min/max` でクランプ）。`first/last` と同様に index のみ変更。

**`src/components/ImageViewer.tsx`** — `applyRating` を更新:
```ts
await setRating(image.id, rating);
setDetail((d) => (d ? { ...d, rating } : d));
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
- 空リストで閉じる処理（旧 `len===0` 分岐）は splice 廃止により不要になるため削除。

**`src/components/ImageGridPanel.tsx`** — `0–5` キー処理を更新:
- `ratingMode` / `unratedOnly` をストアから購読。
- 評価が 1〜5 かつ `ratingMode && unratedOnly` のとき `nextUnratedIndex(results, cur)` を計算し、`>=0` なら `selectImage(ni)` + `rowVirtualizer.scrollToIndex(...)`。見つからなければ留まる。
- それ以外（クリア含む）は従来どおり選択据え置き。

**`src-tauri/src/menu.rs`**
- `unrated_only` の表示文字列を `"未入力の画像のみ表示"` → `"レーティング後に未入力へ送る"` に変更。id `unrated_only`・有効/無効同期ロジック・チェック同期は据え置き。

### テスト

- `src/store/useQueryStore.test.ts`: 「未入力のみフィルタ」describe を新仕様に更新（`runQuery` は絞り込まない／`setRating` は splice せず in-place 更新）。
- `src/util/ratingNav.test.ts`: 新規。

---

## #2 スライドショーのショートカット追加

Home/End は実装済み（`SlideshowApp.tsx` 既存）。本項では **レーティング設定（0–5）** と **パスコピー（C）** を追加する。スライドショーは別ウィンドウで `paths` スナップショットしか持たないため、`set_rating(id)` を呼べるよう **payload に id を追加**する。

### Rust

**`src-tauri/src/commands/slideshow.rs`**
- `SlideshowPayload` に `pub ids: Vec<i64>` を追加。
- `start_slideshow` コマンドに `ids: Vec<i64>` 引数を追加し、payload に格納。
- 既存テスト（roundtrip / overwrite）に `ids` を追加。

### TS 型 / API

**`src/types.ts`**: `SlideshowPayload` に `ids: number[]` を追加。

**`src/api/slideshow.ts`**: `startSlideshow(paths, ids, startIndex)` に拡張。

**呼び出し元の更新**:
- `src/components/FilterBar.tsx` `launchSlideshow`: `startSlideshow(results.map(r=>r.path), results.map(r=>r.id), start)`。
- `src/components/ImageGridPanel.tsx` コンテキストメニュー「スライドショー開始」: 同様に id を渡す。

### SlideshowApp

**`src/components/SlideshowApp.tsx`**
- `ids: number[]` を state に保持し、payload から `setIds`。
- 初期化の `Promise.all` に `getSetting("xmp_auto")` を追加し、`xmpAuto` を保持。
- キーボードハンドラに追加（テキスト入力欄＝間隔欄にフォーカス時はガードして委譲）:
  - `0–5`: `rating = key==='0' ? null : Number(key)`。`id = ids[order[pos]]`, `path = paths[order[pos]]`。
    - `await setRating(id, rating)`（`api/images` の `setRating`）。
    - `xmpAuto` が true なら `await writeXmpRating(path, rating)`（`api/fs`）。失敗時は console.error + トースト。
    - トースト: `rating===null ? "レーティングをクリア" : `★${rating} を設定``。
    - 多重実行防止に簡易 in-flight ガード（ref）。
  - `c` / `C`: `navigator.clipboard.writeText(currentPath)` + トースト「パスをコピーしました」。
- メインウィンドウ一覧への即時反映は行わない（DB は更新済み、次回クエリで反映）。

### ヘルプ

**`src/components/HelpOverlay.tsx`**: 「スライドショー」セクションに `0 - 5` レーティング設定（0でクリア）と `C` パスをコピーを追加。

---

## #3 スペルチェック/入力補完の無効化

**`src/components/FilterDialog.tsx`**: 全 `<input>`（text/number 計 7 個）に
`spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"` を付与（`FilterBar` の入力欄と同じ）。

---

## #4 + #5 ✕ クリアボタン & 左端揃え（統合レイアウト）

フィールド群を 1 つのグリッドにまとめ、全入力欄の左端を最長ラベル幅で揃える。各入力欄右端（内側オーバーレイ）に値があるときだけ ✕ を表示する。

### `src/components/FilterDialog.tsx`

- レーティング/幅/高さ/プロンプト/ネガティブ/モデル/サンプラー/ツールの各 `<label>` を `<div className="filter-fields">` でまとめる。
- 各 `<label>` 内を次の構造にする:
  ```tsx
  <label>
    <span className="field-label">プロンプト</span>
    <span className="field-input">
      <input ... aria-label="プロンプト" />
      {prompt && (
        <button type="button" className="field-clear"
                aria-label="プロンプトをクリア" onClick={() => setPrompt("")}>✕</button>
      )}
    </span>
  </label>
  ```
- レーティングのセレクトも `<span className="field-label">` + `<span className="field-input"><select .../></span>`（✕ なし）として入力欄と幅・左端を揃える。`aria-label="レーティング下限"` は維持。
- ✕ は text/number 入力（プロンプト/ネガティブ/モデル/サンプラー/ツール/幅下限/高さ下限）に付与。クリアは対応する setState("") で空にする。
- aria-label は既存テスト（`getByLabelText`）互換のため入力要素側に維持。✕ ボタンの aria-label は「○○をクリア」とし、`getByText("クリア")`（作成日用）と衝突させない。

### `src/App.css`

```css
.filter-fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 8px 12px;
}
.filter-fields label { display: contents; }
.field-label { white-space: nowrap; }
.field-input { position: relative; display: flex; }
.field-input input,
.field-input select { flex: 1; min-width: 0; }
.field-input input { padding-right: 1.8em; }
.field-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  /* 余白の少ない小さなクリアボタン */
}
```
- 既存の `.filter-dialog label { display:flex; ... }` と `.filter-dialog input[...]{ flex:1 }` は新レイアウトに置き換え/調整する。

---

## #6 外側クリックで閉じない / ESC で閉じる

### `src/components/FilterDialog.tsx`

- `.dialog-backdrop` の `onClick={onClose}` を削除（背景は単なるコンテナに）。内側 `.dialog` の `onClick={(e)=>e.stopPropagation()}` も不要になるため整理。
- 「キャンセル」ボタンの close は維持。
- ダイアログ表示中に window レベル（capture フェーズ）の `keydown` を張る useEffect を追加:
  ```ts
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
- 注: macOS ネイティブ全画面の ESC は OS レベルで抑止しきれない場合があるが、ビューアの ESC 処理と同じくベストエフォート（メインウィンドウは通常全画面でないため実害は小さい）。

---

## テスト方針（TDD）

- `src/util/ratingNav.test.ts`（新規）: 純関数。
- `src/store/useQueryStore.test.ts`: 「未入力のみフィルタ」を新仕様へ更新。
- `src/components/FilterDialog.test.tsx`: 既存ケースを維持（`getByLabelText` が引き続き通ること）。必要に応じて ✕ クリア・外側クリックで閉じない・ESC で閉じるのケースを追加。
- Rust: `slideshow.rs` のテストに `ids` を追加。
- 全体: `pnpm test`（vitest）と `cargo test`（src-tauri）を通す。

## スコープ外

- スライドショーでの評価をメインウィンドウ一覧へリアルタイム反映すること。
- ダイアログのフォーカストラップ。
- フィルタ詳細以外の UI 変更。
