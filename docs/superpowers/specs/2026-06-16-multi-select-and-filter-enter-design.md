# 設計: 画像一覧の複数選択（一括ゴミ箱／レーティング）＋ フィルタダイアログ Enter 適用

- 日付: 2026-06-16
- 対象: gen-img-manager（Tauri 2 + React 19 + TypeScript / SQLite）

## 概要

2 つの独立した UI 改善を扱う。

- **機能A**: 画像一覧（`ImageGridPanel`）で複数選択を可能にし、選択した画像をまとめてゴミ箱へ移動・レーティング付けできるようにする。
- **機能B**: 詳細フィルタダイアログ（`FilterDialog`）で、テキスト/数値入力欄での Enter を「適用」ボタン押下と同等に扱う。

実装プランは機能ごとに分割できる。機能B は小規模なので機能A 完了後（または並行）に着手して構わない。

---

## 機能A: 画像一覧の複数選択

### 目的

現状の画像一覧は単一選択のみ（`useViewerStore.selectedIndex`）。複数枚をまとめて整理（不要画像のゴミ箱移動・レーティング一括付与）したい。

### A-1. 選択状態のモデル

`useViewerStore` を拡張し、二層構造で選択を表現する。いずれも `useQueryStore.results` のインデックスを指す。

- **`selectedIndex: number`（アクティブ項目／カーソル）**: 既存。ビューア起動・スライドショー起点・スクロール追従に流用。複数選択中も「いま操作の中心にある1枚」を指す。
- **`selection: Set<number>`（選択集合）**: 一括操作の対象。単一選択時は `{selectedIndex}` と一致する。
- **`anchorIndex: number`**: Shift 範囲選択の起点。

> **index ベースを採用する理由**: レーティングは結果リストの並び・件数を変えないため index が安定する。削除・クエリ再実行・ソート変更時は後述のとおり選択をクリアするため、index ズレ問題は発生しない。

#### 新規アクション（`useViewerStore`）

- `selectSingle(index)`: `selection = {index}`, `selectedIndex = index`, `anchorIndex = index`
- `toggleSelect(index)`: `index` を `selection` にトグル、`selectedIndex = index`, `anchorIndex = index`
- `selectRange(index)`: `anchorIndex..index`（昇順レンジ）を `selection` に設定、`selectedIndex = index`（`anchorIndex` は維持）。Shift+クリックと Shift+矢印で共通利用する（実装では `extendRange` を別に設けず `selectRange` に統合した）。
- `selectAll(count)`: `selection = {0..count-1}`
- `clearSelection()`: `selection = {selectedIndex}` に戻す（単一選択へ）

選択集合の更新計算（レンジ算出・トグル・全選択）は UI から純粋関数に切り出し、`src/util/selection.ts` に実装して vitest 対象とする。`useViewerStore` のアクションはその純粋関数を呼ぶ薄い層にする。

### A-2. 操作仕様（修飾キー方式）

| 操作 | 挙動 |
|---|---|
| 通常クリック | `selectSingle(i)`（単一選択にリセット） |
| Cmd/Ctrl+クリック | `toggleSelect(i)` |
| Shift+クリック | `selectRange(i)` |
| 矢印キー（既存） | 移動先で `selectSingle(新index)`（範囲リセット） |
| Shift+矢印 | `selectRange(新index)` |
| Cmd/Ctrl+A | `selectAll(results.length)`。グリッド/ body にフォーカスがある時のみ。デフォルトの全選択を `preventDefault` |
| Esc | `clearSelection()`（完全クリアではなく単一に戻す） |
| `0`–`5` | **`selection` 全体**に一括レーティング。複数選択中（`selection.size > 1`）は auto-advance（次の未評価へ移動）を無効化 |
| 削除キー（Cmd/Ctrl+Delete, Cmd/Ctrl+Backspace, Delete, Backspace） | **`selection` 全体**をゴミ箱（確認ダイアログ経由）。グリッドに新設 |
| ダブルクリック / Enter | アクティブ1枚（`selectedIndex`）をビューアで開く。`selection` は維持 |

> **ビューア往復時の選択挙動**: 複数選択中にダブルクリック/Enter でビューアを開き、ビューア内でナビゲートして戻った場合、戻り時にアクティブ項目（`selectedIndex`）が選択集合の外にあれば単一選択へ収束させる（画面外の旧選択に対する `0`-`5`/削除キーの誤爆を防ぐ）。ナビゲートせず閉じた場合はアクティブが選択集合内に留まるため複数選択を維持する。

既存のキーボード処理は `ImageGridPanel.tsx` のウィンドウレベル `keydown` リスナー（`document.activeElement` が body かグリッドの時のみ有効、ビューア表示中は無効）。この枠組みを踏襲し、Shift / Cmd 併用判定を追加する。`hasPrimaryModifier` で Cmd/Ctrl を判定済みのため、Cmd+A・Cmd+Delete はこの分岐内に追加する（現状 Cmd 併用は即 `return` しているので、その手前で A / Delete を拾う）。

### A-3. UI

- **選択バー**: `ImageGridPanel` 内のグリッド上部に、`selection.size >= 1` のときだけ表示する固定バー。内容:
  - `N件選択中`
  - レーティング設定: クリア（=0/なし）, ★1, ★2, ★3, ★4, ★5 のボタン群 → `rateSelected(rating)`
  - `ゴミ箱へ移動` ボタン → 確認ダイアログ
  - `選択解除` ボタン → `clearSelection()`
- **選択ハイライト**: 既存の `.thumb-cell.selected` は「アクティブ項目」用に残しつつ、`selection` に含まれるセルへ別クラス（例 `.thumb-cell.in-selection`）を付与して複数選択を視認できるようにする。アクティブ項目は両方付く。
- **右クリックメニュー拡張**（`ImageGridPanel` のコンテキストメニュー）:
  - 右クリック対象が `selection` に含まれる場合 → 選択全体に対するメニュー（「レーティング設定 ▶ なし/★1〜★5」「ゴミ箱へ移動（N件）」＋既存項目）。
  - 含まれない場合 → その項目を `selectSingle` してから従来の単一メニュー（Finder 標準挙動）。
- **削除確認ダイアログ**: 「N件をゴミ箱に移動しますか？」。OK で実行。実行後は `selection` をクリアし、`selectedIndex` を削除した最小インデックス付近へクランプ（`min(削除前の最小index, 残り件数-1)`、空なら -1）。完了トーストで結果（成功件数・失敗件数）を通知。

### A-4. バックエンド（バッチコマンド新設）

Rust 側に 1 回の IPC でまとめて処理するコマンドを追加する。

- `delete_images(db, items: Vec<DeleteItem>) -> Result<BatchResult, String>`
  - `DeleteItem { id: i64, path: String }`
  - 各要素について `trash::delete(&path)`、成功したら `db::images::mark_missing(id, true)`。
  - 個別失敗は握りつぶさず集計し、`BatchResult { succeeded: usize, failed: Vec<{id, error}> }` を返す。1件の失敗で全体を中断しない。
  - 配置: `src-tauri/src/commands/fs.rs`。
- `set_ratings(db, ids: Vec<i64>, rating: Option<i64>) -> Result<(), String>`
  - 既存 `set_rating` と同じ範囲検証（1..=5 または None）。
  - 単一トランザクションで `db::images::set_rating` 相当を全 id に適用。`src-tauri/src/db/images.rs` に `set_ratings(conn, ids, rating)` を追加し、`commands/query.rs` から呼ぶ。

`lib.rs` の `invoke_handler` に両コマンドを登録する。

#### フロント側

- `src/api/fs.ts`: `deleteImages(items)` を追加。
- `src/api/images.ts`: `setRatings(ids, rating)` を追加。
- `src/store/useQueryStore.ts`:
  - `rateSelected(ids, rating)`: 渡された id 群へ `setRatings` を呼び、`results` をローカル更新。`xmpAutoExport` ON のときは各画像へ `writeXmpRating` を実行（既存の単一フローを踏襲）。XMP の失敗は集計してトースト通知し、本体処理は継続。
  - `deleteSelected(items)`: 確認は呼び出し側（UI）で取得済みの前提。渡された {id, path} 群へ `deleteImages` を呼び、`results` から除去・`total` 更新。結果をトースト通知。
  - **循環依存回避**: `useViewerStore` は `useQueryStore` を import 済みのため、逆向き参照（`useQueryStore`→`useViewerStore`）は避ける。一括操作の対象（id / {id,path}）は UI 側（`ImageGridPanel`／選択バー）で `selection`（index 集合）から `results` を引いて組み立て、アクションへ**引数として渡す**。選択集合のクリアやアクティブ位置の更新は UI 側で `useViewerStore` のアクションを呼んで行う。

### A-5. データフロー

1. ユーザーがクリック/キーで `useViewerStore` の選択アクションを呼ぶ → `selection` 更新 → グリッド再描画（ハイライト）・選択バー表示。
2. 一括レーティング: 選択バー/キー/メニュー → `useQueryStore.rateSelected` → `api.setRatings` → Rust `set_ratings`（DB トランザクション）→ 必要なら各 XMP 書出 → `results` ローカル更新。
3. 一括削除: 選択バー/キー/メニュー → 確認ダイアログ → `useQueryStore.deleteSelected` → `api.deleteImages` → Rust `delete_images`（trash + mark_missing）→ `results` から除去 → 選択クリア＋アクティブ位置クランプ。

### A-6. 選択のライフサイクル（クリア条件）

次のとき `selection` と `selectedIndex` をリセットする（`useQueryStore` 側で結果が差し替わる箇所にフックする）:

- クエリ再実行（`runQuery`）・ソート変更・フィルタ適用で `results` が入れ替わったとき → 選択クリア。
- 一括削除直後 → 選択クリア、アクティブをクランプ。

### A-7. エラー処理

- バッチ削除/レーティングの個別失敗は集計し、トーストで「N件成功 / M件失敗」を表示。失敗詳細は `console.error`。
- XMP 書出失敗は本体（DB 更新）を妨げない。トーストで件数のみ通知。

### A-8. テスト

- `src/util/selection.ts`: レンジ算出（昇順/降順 anchor）、トグル、全選択、クランプ計算の純粋関数を vitest。
- Rust: `db::images::set_ratings` のインライン `#[cfg(test)]`（複数 id への適用・None クリア）。`delete_images` は trash 副作用があるため、集計ロジック部分を切り出せる範囲でテスト（実ファイル削除は対象外）。

---

## 機能B: フィルタダイアログで Enter＝適用

### 目的

`FilterDialog` で入力後に Enter を押すと「適用」ボタンを押したのと同じ挙動（`apply()`）にする。現状 Enter は no-op、ESC のみハンドル。

### 実装

- `FilterDialog` のコンテナ（`.dialog.filter-dialog`）に `onKeyDown` を追加。
- Enter かつ **IME 変換確定でない** かつ **フォーカスがテキスト/数値入力欄** のとき `apply()` を呼ぶ。
  - IME 判定: `e.nativeEvent.isComposing === false` かつ `e.nativeEvent.keyCode !== 229`（日本語入力中の変換確定 Enter を誤爆させない。prompt/negative 等に日本語を入れる前提）。
  - 対象要素: `e.target` が `HTMLInputElement` で `type` が `text` または `number`。
  - select（下限一括）・DayPicker（カレンダー）・各 `<button>`（✕クリア・適用・キャンセル）上の Enter は対象外＝ネイティブ挙動を維持。`<button>` は input 判定で自然に除外される。
- 判定ロジックは純粋関数に切り出す: `src/util/dialogKeys.ts` の `isApplyEnter({ key, isComposing, keyCode, tagName, inputType }): boolean`。`onKeyDown` ハンドラはイベントからこれらを取り出して関数に渡すだけにする。

### テスト

- `src/util/dialogKeys.test.ts`: Enter+text→true、Enter+number→true、Enter+IME変換中（isComposing/keyCode 229）→false、Enter+select/button→false、Enter以外→false。

---

## 影響ファイル一覧

### 機能A
- `src/store/useViewerStore.ts`（選択状態・アクション追加）
- `src/util/selection.ts`（新規・純粋関数）＋ `selection.test.ts`
- `src/components/ImageGridPanel.tsx`（クリック/キー処理・選択バー・ハイライト・右クリック拡張）
- `src/store/useQueryStore.ts`（`rateSelected` / `deleteSelected` / 選択クリアのフック）
- `src/api/fs.ts`（`deleteImages`）, `src/api/images.ts`（`setRatings`）
- `src-tauri/src/commands/fs.rs`（`delete_images`）, `src-tauri/src/commands/query.rs`（`set_ratings`）
- `src-tauri/src/db/images.rs`（`set_ratings`）
- `src-tauri/src/lib.rs`（`invoke_handler` 登録）
- スタイル: 選択バー・複数選択ハイライト用 CSS

### 機能B
- `src/components/FilterDialog.tsx`（`onKeyDown` 追加）
- `src/util/dialogKeys.ts`（新規）＋ `dialogKeys.test.ts`

---

## 非対象（YAGNI）

- プログラムによる削除の Undo（trash クレートでは確実な復元が困難。復元は OS ゴミ箱から手動）。
- 大量選択時の進捗バー（バッチコマンドは一括処理で十分高速の想定。XMP 同期ループが体感で遅い場合のみ将来検討）。
- 選択のクエリ跨ぎ永続化（結果が入れ替わったら選択はクリアする）。
- ドラッグによる矩形選択。
