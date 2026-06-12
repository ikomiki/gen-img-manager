# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

gen-img-manager は、AI生成画像（Stable Diffusion WebUI/A1111・ComfyUI 等）を取り込み、埋め込みメタデータで検索・閲覧・レーティングするデスクトップアプリ。**Tauri 2**（Rustバックエンド）＋ **React 19 + TypeScript + Vite**（フロント）、ローカル **SQLite** ライブラリで構成される。

## コマンド

```bash
# フロント開発（Viteのみ。Tauriウィンドウは開かない）
npm run dev

# アプリ開発（Tauriウィンドウ起動。Rust + フロントをまとめてビルド/HMR）
npm run tauri dev

# 配布ビルド
npm run tauri build

# フロントのテスト（vitest）
npm test
npx vitest run src/util/queryTokens.test.ts    # 単一ファイル
npx vitest run -t "parseRatingToken"           # テスト名で絞り込み

# Rust（バックエンド）のテスト・lint。src-tauri 内で実行する
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Rustのテストは各モジュール内の `#[cfg(test)]` インラインテスト（別 `tests/` ディレクトリは無い）。

## バージョン管理（重要）

アプリのバージョンは **4ファイル**（`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`）に分散する。必ず専用スクリプトで一括更新し、**個別ファイルを手編集しない**。

```bash
npm run bump -- patch     # 0.1.1 -> 0.1.2
npm run bump -- minor     # 0.1.1 -> 0.2.0
npm run bump -- major     # 0.1.1 -> 1.0.0
npm run bump -- 1.2.3     # 明示指定
npm run bump -- patch --dry-run   # 書き込まず変更内容を確認
```

ファイルを書き換えるだけで git 操作は行わない。4ファイルが食い違う場合、キーワード指定はエラーで中断し、明示バージョンを指定すると全ファイルをその値へ揃え直す。ロジックは `scripts/version-core.mjs`、実行層は `scripts/bump-version.mjs`（テスト: `scripts/version-core.test.ts`）。Tauri はアプリ版を `tauri.conf.json > version` から読む（未設定時のみ `Cargo.toml`）。

## コミットメッセージ

AI（Claude Code）が生成するコミットメッセージは、Conventional Commits 形式のプリフィックス（`feat:` / `fix(cli):` / `docs:` など type・scope 部分）は英語のまま残し、それに続く要約・本文は**日本語**で記述する。

例: `fix(viewer): サイドバーで Cmd+C のテキストコピーが効くようにする`

## アーキテクチャ

### 2ウィンドウ・単一バンドル

`index.html` の単一バンドルから2つのUIを出し分ける。`src/main.tsx` が `window.location.hash` を見て、`#slideshow` なら `SlideshowApp`、それ以外はメインの `App` をマウントする。スライドショーは Rust 側 `start_slideshow`（`commands/slideshow.rs`）が `index.html#slideshow` を URL に持つ別ウィンドウを生成する。ウィンドウごとに Tauri ケイパビリティが分かれる（`src-tauri/capabilities/default.json` = メイン、`slideshow.json` = スライドショー：フルスクリーン許可など）。

### フロント↔バックエンドの境界

フロントは Rust コマンドを直接 `invoke` せず、必ず `src/api/*.ts`（`images`/`directories`/`scan`/`prefs`/`fs`/`slideshow`）の薄いラッパ経由で呼ぶ。UI状態は **zustand** ストア3つに集約：

- `useQueryStore` — 検索クエリ・ソート・結果リスト・各種トグル（ファイル名表示・レーティングモード・未評価のみ・XMP自動書出など）と、それらの **SQLite settings テーブルへの永続化**。アプリ全体のハブ。
- `useLibraryStore` — 記憶ディレクトリ一覧とスキャン進捗。
- `useViewerStore` — 画像ビューア（ズームモード等）。

ネイティブメニュー操作は Rust が `app.emit("menu-action", id)` で発火し、`App.tsx` の `listen("menu-action")` が対応するストアアクションへ振り分ける。逆向きの「メニューのチェック状態同期」は `commands/view_menu.rs` の `sync_*` コマンドで行う（状態の正はフロント側）。

### バックエンドのデータフロー

`src-tauri/src/` は層構造：`commands/`（`invoke_handler` に登録された公開API。一覧は `lib.rs`）→ `db/`（rusqlite）／`query/`（検索DSL）／`parser/`（メタデータ抽出）／`scanner.rs`／`thumbnail.rs`。

1. **スキャン** (`scanner.rs`, `commands/scan.rs`): 登録ディレクトリを走査し、各画像を `parser` で解析、サムネイル生成、SQLite へ upsert。
2. **メタデータ解析** (`parser/mod.rs`): 拡張子で振り分け。PNG の tEXt チャンク（A1111 の `parameters` / ComfyUI の `prompt`・`workflow`）、JPEG/WebP の EXIF UserComment を読み、`a1111.rs`／`comfyui.rs` で正規化。XMP サイドカーはレーティング用（`xmp.rs`）。
3. **DB** (`db/`, `migrations.rs`): `images` 本体＋ **FTS5 仮想テーブル `images_fts`**（`positive`/`negative`/`model`/`filename`/`raw_parameters` を全文検索）。FTS はトリガで本体と自動同期。マイグレーションは `MIGRATIONS` 配列（index+1 = `PRAGMA user_version`、**追記のみ・並び替え禁止**）。
4. **検索DSL** (`query/`): ユーザのクエリ文字列を `parse.rs` でトークン化 → `ParsedQuery`（FTS式 + 構造化条件 `Cond`）→ `compile.rs` で SQL の WHERE 式＋束縛値へ。`prompt:`/`model:` 等のテキストフィールドは FTS、`rating:`/`width:`/`created:` 等は構造化条件（範囲・集合・日付）。**SQLインジェクション対策**：列名は許可リストの `&'static str` のみ、値は必ずバインドパラメータ。

### その他の要所

- **asset protocol**: 原画像とサムネイルは Tauri の asset protocol で表示する。`lib.rs` の setup で `thumbnails/` と登録ディレクトリ配下を `allow_directory` する（新規ディレクトリ追加時も許可が必要）。
- **オフラインドライブ対策** (`fs_guard.rs`): 切断されたネットワークドライブで `exists()` がハングしてUIを止めないよう、別スレッド＋タイムアウトで到達性を判定する。
- **設定の永続化**: ユーザ設定・フィルタ履歴・最後のクエリは SQLite の `settings`/`filter_history` テーブルに保存（`commands/prefs.rs`）。DBは `app_data_dir()/library.db`。

### テスト指向

ロジックは UI/IO から純粋関数へ切り出してテストする方針（フロントは `src/util/*` に多数の vitest、Rust は各モジュールのインラインテスト）。新しいロジックを足すときは同じ分離を踏襲する。
