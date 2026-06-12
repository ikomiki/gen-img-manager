# 現在レーティング表示オーバーレイ 設計

## 目的

画像ビューア画面とスライドショー画面の**左下**に、現在表示中の画像のレーティングを
5つ星で表示する。表示の ON/OFF は「表示」メインメニューのトグルで切り替える。

## 要件

- 表示内容: サムネイルグリッドのレーティングと同様の星表示。`rating` 個まで金の★、
  残りはグレーの☆。未評価(0/null)は ☆☆☆☆☆。
- サイズ: 「現在のファイル位置を表示」オーバーレイと同程度（font-size 13px）。
  任意の画像上でも視認できるよう、位置オーバーレイと同じ暗いピル背景に載せる。
- 表示位置: 画面左下。
- 表示条件: 「表示」メニュー内のトグルで切り替え。設定キー `show_current_rating` に永続化。
  トグル1つでビューア・スライドショー双方に効く（既存の「ファイル名/位置」表示と同じ共有方式）。

## 設計

### A. メニュー＆設定（既存 `show_current_position` をミラー）

- `src-tauri/src/menu.rs` — `ViewMenu` に `show_current_rating: CheckMenuItem` を追加。
  メニュー項目「現在のレーティングを表示」を「現在のファイル位置を表示」の下に配置。
  `sync_current_rating(on)` メソッドを追加。
- `src-tauri/src/commands/view_menu.rs` — `sync_current_rating_menu` コマンドを追加。
- `src-tauri/src/lib.rs` — `invoke_handler` に登録。
- `src/api/prefs.ts` — `syncCurrentRatingMenu(on)` を追加。
- `src/store/useQueryStore.ts` — `showCurrentRating: boolean` 状態、`toggleShowCurrentRating()`、
  `loadSettings()` での `show_current_rating` 読込とメニュー同期を追加。
- `src/App.tsx` — `menu-action` の `show_current_rating` を `toggleShowCurrentRating` へ振り分け。

### B. 共有の星表示コンポーネント（重複回避）

- `src/util/ratingStars.ts` — 純関数 `ratingStarFills(rating: number | null): boolean[]`
  （長さ5の真偽配列。`rating` 個まで true）。vitest 対象。
- `src/components/RatingStars.tsx` — 表示専用コンポーネント。`ratingStarFills` を使い
  ★（filled）/☆（empty）を5個描画する。ビューア・スライドショー双方で利用。

### C. ビューア表示

- `src/components/ImageViewer.tsx` — `showCurrentRating` を購読し、左下に `RatingStars`
  を表示（`image.rating` を使用。レーティング変更は既存 `applyRating` が results/detail を
  同期済みのため追加対応不要）。
- `src/App.css` — `.viewer-overlay-rating`（左下・暗ピル・13px・金/グレー星）を追加。

### D. スライドショー表示（レーティングデータの受け渡しが必要）

スライドショーは現在 `paths`/`ids` のみ保持し、レーティングを持たない。毎スライドでの
DB 再取得を避けるため、`paths`/`ids` と同じスナップショット方式で payload に含める。

- `src-tauri/src/commands/slideshow.rs` — `SlideshowPayload` に `ratings: Vec<Option<i64>>`
  を追加。`start_slideshow` 引数に `ratings` を追加。`set_payload`/`get_payload` の
  インラインテストを `ratings` 込みに更新。
- `src/types.ts` — `SlideshowPayload.ratings: (number | null)[]` を追加。
- `src/api/slideshow.ts` — `startSlideshow(paths, ids, ratings, startIndex)`。
- `src/components/ImageGridPanel.tsx` — `results.map(r => r.rating)` を渡す。
- `src/components/SlideshowApp.tsx` — `ratings` を state で保持し payload から初期化。
  スライドショー内でのレーティング変更時は `applyRating` で該当 index の `ratings` を即時更新し
  表示へ反映。`showRating` state、設定 `show_current_rating` の読込、`menu-action` 購読を追加。
  左下に `RatingStars` を表示。
- `src/SlideshowApp.css` — `.ss-rating`（左下・13px・暗ピル）を追加。

## テスト

- Rust: `slideshow.rs` の payload set/get インラインテストを `ratings` 込みに更新。
- フロント: `ratingStarFills` の vitest（rating=0/null/3/5、範囲外の防御）。

## 非対象（YAGNI）

- レーティング表示の位置・サイズのユーザカスタマイズ。
- スライドショー起動後に主ウィンドウで変更したレーティングのライブ反映
  （スナップショット方式の既存仕様を踏襲。スライドショー内での変更のみ即時反映）。
