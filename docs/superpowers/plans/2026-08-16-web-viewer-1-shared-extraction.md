# web ビューア 計画1: 共有コードの抽出 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デスクトップ版の振る舞いを一切変えずに、web 版と共有する Rust コード（`gim-core` クレート）と TypeScript コード（`@gim/shared` パッケージ）を切り出し、検索対象ディレクトリを呼び出し側から指定できるようにする。

**Architecture:** Cargo workspace を導入して `crates/core` を新設し、`src-tauri/src/` から `models.rs`・`query/`・`db/` をそのまま移設する。移設後は `src-tauri/src/lib.rs` で `pub use gim_core::{db, models, query};` と再エクスポートするため、既存の `crate::db::...` 参照は書き換え不要。TypeScript 側は pnpm workspace の `packages/shared` に純粋関数を移し、`src/types.ts` が共有型を再エクスポートすることで desktop 側の import を維持する。

**Tech Stack:** Rust 2021 / Cargo workspace / rusqlite 0.32 / pnpm workspace / Vite 7 / vitest 4

**Spec:** `docs/superpowers/specs/2026-08-16-web-viewer-design.md`

## Global Constraints

- `src/` と `src-tauri/` は物理的に移動しない。`src-tauri/src/` 配下のファイルの移動のみ行う
- `crates/core` の `version` は `"0.0.0"` 固定。`npm run bump` の対象に含めない
- SQL の列名は許可リストの `&'static str` のみを埋め込み、値は必ずバインドパラメータで渡す
- `db/migrations.rs` の `MIGRATIONS` 配列は追記のみ・並び替え禁止。この計画では一切変更しない
- **`cargo fmt` をリポジトリ全体に適用しない。** `src-tauri` は rustfmt 未整形であり、全体整形は巨大な無関係差分を生む。新規ファイルは周囲のスタイルに手で合わせる
- コードコメントは非自明な WHY のみ。WHAT・変更履歴・タスク ID は書かない
- コミットメッセージは Conventional Commits のプリフィックスを英語、要約と本文を日本語で書く
- パッケージマネージャは **pnpm**（`node_modules/react` が `.pnpm` へのシンボリックリンク）。`package-lock.json` は使われていない残骸なので触らない

---

## ファイル構成

このプランで作成・変更されるファイルと、その責務。

**新規作成**

| ファイル | 責務 |
|---|---|
| `Cargo.toml` | workspace ルート。メンバの列挙のみ |
| `crates/core/Cargo.toml` | 共有クレートの依存定義 |
| `crates/core/src/lib.rs` | 共有クレートのモジュール宣言のみ |
| `packages/shared/package.json` | 共有 TS パッケージ。`src/*.ts` を exports で直接公開する（ビルド段を持たない） |

**移動（内容は変更しない）**

| 移動元 | 移動先 |
|---|---|
| `src-tauri/Cargo.lock` | `Cargo.lock` |
| `src-tauri/src/models.rs` | `crates/core/src/models.rs` |
| `src-tauri/src/query/` | `crates/core/src/query/` |
| `src-tauri/src/db/` | `crates/core/src/db/` |
| `src/util/{queryTokens,promptQuery,normalizeText,imageDates,ratingFilter,historyMatch,historyNav,playlist,gridNav}.ts` とその `.test.ts` | `packages/shared/src/` |

**変更**

| ファイル | 変更内容 |
|---|---|
| `scripts/version-core.mjs` | バージョン対象ファイルのパス一覧 `VERSION_FILES` を追加 |
| `scripts/version-core.test.ts` | `VERSION_FILES` のテストを追加 |
| `scripts/bump-version.mjs` | `VERSION_FILES` を使い、`Cargo.lock` をルートから読む |
| `src-tauri/Cargo.toml` | `gim-core` への依存を追加 |
| `src-tauri/src/lib.rs` | `mod db/models/query` を削除し `pub use gim_core::{db, models, query};` に置換 |
| `crates/core/src/db/image_query.rs` | `DirScope` を追加し `query_images` / `count_query` を引数化 |
| `src-tauri/src/commands/query.rs` | `DirScope::Visible` を渡す |
| `pnpm-workspace.yaml` | `packages:` を追加 |
| `package.json` | `@gim/shared` を依存に追加 |
| `src/types.ts` | 共有型を `@gim/shared/types` から再エクスポート |
| `src/components/{FilterDialog,FilterBar,MetadataPanel,SlideshowApp,ImageGridPanel}.tsx` | `../util/x` → `@gim/shared/x` |

---

## Task 1: Cargo workspace 化とバージョンスクリプトの追従

**Files:**
- Create: `Cargo.toml`
- Move: `src-tauri/Cargo.lock` → `Cargo.lock`
- Modify: `scripts/version-core.mjs`, `scripts/bump-version.mjs:11-16,70-75`
- Test: `scripts/version-core.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: workspace ルート `Cargo.toml`（`members = ["src-tauri", "crates/*"]`）。`scripts/version-core.mjs` が `VERSION_FILES: readonly string[]` を export する

- [ ] **Step 1: `VERSION_FILES` の失敗するテストを書く**

`scripts/version-core.test.ts` の import 文に `VERSION_FILES` を追加する。

```ts
import {
  isValidVersion,
  parseVersion,
  bumpVersion,
  analyzeVersions,
  planBump,
  VERSION_FILES,
} from "./version-core.mjs";
```

ファイル末尾に以下を追加する。

```ts
describe("VERSION_FILES", () => {
  it("バージョンを持つ4ファイルを順に列挙する", () => {
    expect([...VERSION_FILES]).toEqual([
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "Cargo.lock",
    ]);
  });

  it("Cargo.lock は workspace ルートを指す", () => {
    expect(VERSION_FILES).not.toContain("src-tauri/Cargo.lock");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run scripts/version-core.test.ts`
Expected: FAIL — `VERSION_FILES` が undefined のため `[...VERSION_FILES]` が TypeError になる

- [ ] **Step 3: `VERSION_FILES` を実装する**

`scripts/version-core.mjs` の `RELEASE_TYPES` の定義の直後に追加する。

```js
/**
 * バージョンを保持するファイル（プロジェクトルート起点の相対パス）。
 * Cargo.lock は Cargo workspace のルートにある。
 */
export const VERSION_FILES = /** @type {const} */ ([
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "Cargo.lock",
]);
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run scripts/version-core.test.ts`
Expected: PASS（既存のテストもすべて緑）

- [ ] **Step 5: `bump-version.mjs` を `VERSION_FILES` 経由に変える**

import に `VERSION_FILES` を追加する。

```js
import { planBump, VERSION_FILES } from "./version-core.mjs";
```

冒頭のドキュメントコメント（11-15行目）の対象ファイル一覧を書き換える。

```js
 * 対象ファイル:
 *   - package.json                 (npm パッケージ版)
 *   - src-tauri/tauri.conf.json    (Tauri アプリ版・正)
 *   - src-tauri/Cargo.toml         ([package] 版)
 *   - Cargo.lock                   (自身のパッケージブロック版・workspace ルート)
```

`targets` の定義（70-75行目）を置き換える。

```js
/** @type {Record<string, RegExp>} */
const PATTERN_BY_FILE = {
  "package.json": JSON_VERSION,
  "src-tauri/tauri.conf.json": JSON_VERSION,
  "src-tauri/Cargo.toml": CARGO_TOML_VERSION,
  "Cargo.lock": CARGO_LOCK_VERSION,
};

const targets = VERSION_FILES.map((f) => fileTarget(f, PATTERN_BY_FILE[f]));
```

- [ ] **Step 6: workspace ルートの `Cargo.toml` を作る**

```toml
[workspace]
resolver = "2"
members = ["src-tauri", "crates/*"]
```

- [ ] **Step 7: `Cargo.lock` をルートへ移動する**

```bash
git mv src-tauri/Cargo.lock Cargo.lock
```

- [ ] **Step 8: ビルドが通ることを確認する**

Run: `cargo check --workspace`
Expected: 成功。`crates/` はまだ空なので `src-tauri` のみがビルドされる。`Cargo.lock` がルートで更新される

- [ ] **Step 9: bump スクリプトが4ファイルを読めることを確認する**

Run: `npm run bump -- patch --dry-run`
Expected: `package.json: 0.1.1 -> 0.1.2` のように4ファイルすべてが `0.1.1` として表示され、`(読み取り不可)` が出ない。`[dry-run] 書き込みは行っていません。` で終わる

- [ ] **Step 10: 全テストを実行する**

Run: `npm test && cargo test --workspace`
Expected: 両方 PASS

- [ ] **Step 11: コミット**

```bash
git add Cargo.toml Cargo.lock scripts/version-core.mjs scripts/version-core.test.ts scripts/bump-version.mjs
git add -u src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
build(cargo): Cargo workspace を導入し Cargo.lock をルートへ移動

バージョン一括更新スクリプトの対象ファイル一覧を version-core.mjs へ
切り出し、Cargo.lock のパスを workspace ルートに合わせた。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `gim-core` クレートへの移設

**Files:**
- Create: `crates/core/Cargo.toml`, `crates/core/src/lib.rs`
- Move: `src-tauri/src/models.rs`, `src-tauri/src/query/`, `src-tauri/src/db/` → `crates/core/src/`
- Modify: `src-tauri/Cargo.toml:20-35`, `src-tauri/src/lib.rs:1-10`

**Interfaces:**
- Consumes: Task 1 の workspace ルート `Cargo.toml`
- Produces: クレート `gim-core`（ライブラリ名 `gim_core`）が `gim_core::models`・`gim_core::query`・`gim_core::db` を公開する。`src-tauri` 側では `crate::db` 等の既存パスがそのまま使える

**移設対象ファイルは1行も編集しない。** 移設対象の内部参照はすべて `crate::db::` / `crate::query::` / `crate::models::` の形であり、`gim-core` の中でも同じパスで解決されるため。

- [ ] **Step 1: `crates/core/Cargo.toml` を作る**

```toml
[package]
name = "gim-core"
version = "0.0.0"
edition = "2021"

[dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
chrono = "0.4"
```

- [ ] **Step 2: `crates/core/src/lib.rs` を作る**

```rust
pub mod db;
pub mod models;
pub mod query;
```

- [ ] **Step 3: ファイルを移動する**

```bash
mkdir -p crates/core/src
git mv src-tauri/src/models.rs crates/core/src/models.rs
git mv src-tauri/src/query crates/core/src/query
git mv src-tauri/src/db crates/core/src/db
```

- [ ] **Step 4: core 単体のテストが通ることを確認する**

Run: `cargo test -p gim-core`
Expected: PASS。`db/` と `query/` の既存インラインテストがすべて実行される（移設前と同じ件数）

- [ ] **Step 5: `src-tauri` から core への依存を追加する**

`src-tauri/Cargo.toml` の `[dependencies]` 先頭に追加する。

```toml
gim-core = { path = "../crates/core" }
```

- [ ] **Step 6: `src-tauri/src/lib.rs` のモジュール宣言を再エクスポートに置き換える**

1-10行目を以下に置き換える。

```rust
mod backfill;
mod commands;
mod fs_guard;
mod menu;
mod parser;
mod scanner;
mod thumbnail;

// 既存コードの `crate::db::...` 等のパスを維持するための再エクスポート。
pub use gim_core::{db, models, query};
```

- [ ] **Step 7: workspace 全体がビルド・テストできることを確認する**

Run: `cargo test --workspace`
Expected: PASS。`src-tauri` 側で `crate::db` / `crate::models` / `crate::query` の未解決エラーが出ないこと

- [ ] **Step 8: デスクトップ版が従来通り動くことを確認する**

Run: `npm run tauri dev`
Expected: ウィンドウが起動し、画像一覧が表示される。フィルタ欄にクエリ（例: `rating:>=3`）を入れて結果が絞られる。ディレクトリパネルの表示 ON/OFF が一覧に反映される。確認したらウィンドウを閉じる

- [ ] **Step 9: コミット**

```bash
git add crates/ src-tauri/Cargo.toml src-tauri/src/lib.rs Cargo.lock
git add -u src-tauri/src
git commit -m "$(cat <<'EOF'
refactor(core): models/query/db を gim-core クレートへ移設

web サーバと共有するため、データモデル・検索DSL・SQLite アクセスを
別クレートに切り出した。src-tauri 側は再エクスポートで既存パスを維持する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `@gim/shared` パッケージへの TypeScript 移設

**Files:**
- Create: `packages/shared/package.json`
- Move: `src/util/{queryTokens,promptQuery,normalizeText,imageDates,ratingFilter,historyMatch,historyNav,playlist,gridNav}.ts` と対応する `.test.ts` → `packages/shared/src/`
- Create: `packages/shared/src/types.ts`
- Modify: `pnpm-workspace.yaml`, `package.json`, `src/types.ts:1-40`, `src/components/FilterDialog.tsx`, `src/components/FilterBar.tsx`, `src/components/MetadataPanel.tsx`, `src/components/SlideshowApp.tsx`, `src/components/ImageGridPanel.tsx`

**Interfaces:**
- Consumes: なし（Task 1・2 と独立）
- Produces: パッケージ `@gim/shared`。サブパス import で `@gim/shared/queryTokens`・`@gim/shared/promptQuery`・`@gim/shared/normalizeText`・`@gim/shared/imageDates`・`@gim/shared/ratingFilter`・`@gim/shared/historyMatch`・`@gim/shared/historyNav`・`@gim/shared/playlist`・`@gim/shared/gridNav`・`@gim/shared/types` が解決される。`@gim/shared/types` は `Directory`・`ImageRow`・`SortKey`・`SortDir` を export する

- [ ] **Step 1: `packages/shared/package.json` を作る**

`exports` のサブパスパターンで `src/*.ts` を直接公開する。ビルド段を持たないので、共有コードの修正が反映漏れを起こさない。

```json
{
  "name": "@gim/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*.ts"
  }
}
```

- [ ] **Step 2: pnpm workspace に登録する**

`pnpm-workspace.yaml` を以下にする。

```yaml
packages:
  - "packages/*"

allowBuilds:
  esbuild: true
```

ルート `package.json` の `dependencies` に追加する（`@tanstack/react-virtual` の直前、アルファベット順）。

```json
    "@gim/shared": "workspace:*",
```

- [ ] **Step 3: 依存をインストールしてリンクを確認する**

Run: `pnpm install`
Expected: 成功。`ls -l node_modules/@gim/shared` が `packages/shared` へのシンボリックリンクを示す

- [ ] **Step 4: 純粋関数ファイルとテストを移動する**

```bash
mkdir -p packages/shared/src
for f in queryTokens promptQuery normalizeText imageDates ratingFilter historyMatch historyNav playlist gridNav; do
  git mv "src/util/$f.ts" "packages/shared/src/$f.ts"
  git mv "src/util/$f.test.ts" "packages/shared/src/$f.test.ts"
done
```

- [ ] **Step 5: 移動したテストがそのまま通ることを確認する**

Run: `npx vitest run packages/shared`
Expected: PASS。移動した9モジュール分のテストが実行される（vitest の既定 include が `packages/shared/src/*.test.ts` を拾うため設定変更は不要）

- [ ] **Step 6: 共有型ファイルを作る**

`packages/shared/src/types.ts` を新規作成する。

```ts
export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
  visible: boolean;
  image_count: number;
}

export interface ImageRow {
  id: number;
  path: string;
  filename: string;
  thumb_path: string | null;
  width: number;
  height: number;
  pixels: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  source_tool: string;
  model: string | null;
}

export type SortKey = "filename" | "created" | "modified";
export type SortDir = "asc" | "desc";
```

- [ ] **Step 7: `src/types.ts` から重複定義を削除して再エクスポートに置き換える**

`src/types.ts` の先頭にある `Directory` インターフェース（1-10行目）、`ImageRow` インターフェース、`SortKey` / `SortDir` の型エイリアスを削除し、ファイル先頭に以下を置く。`ScanProgress`・`ScanDone`・`ImageDetail`・`ZoomMode`・`SlideshowPayload`・`TagFreq`・`LiftRow`・`RatingBucket`・`TagRatingAnalysis`・`AnalysisParams` はデスクトップ専用なのでそのまま残す。

```ts
export type { Directory, ImageRow, SortKey, SortDir } from "@gim/shared/types";
```

- [ ] **Step 8: コンポーネントの import を差し替える**

macOS の BSD grep は基本正規表現の `\|` を解釈しないので `-E` を使う。

```bash
grep -rlE 'from "\.\./util/(queryTokens|promptQuery|normalizeText|imageDates|ratingFilter|historyMatch|historyNav|playlist|gridNav)"' src \
  | xargs sed -i '' -E 's#from "\.\./util/(queryTokens|promptQuery|normalizeText|imageDates|ratingFilter|historyMatch|historyNav|playlist|gridNav)"#from "@gim/shared/\1"#g'
```

対象は `src/components/FilterDialog.tsx`（`queryTokens`・`promptQuery`・`imageDates`・`ratingFilter`）、`src/components/FilterBar.tsx`（`historyMatch`・`historyNav`）、`src/components/MetadataPanel.tsx`（`normalizeText`）、`src/components/SlideshowApp.tsx`（`playlist`）、`src/components/ImageGridPanel.tsx`（`gridNav`）の5ファイル。

- [ ] **Step 9: 置き換え漏れがないことを確認する**

Run: `grep -rnE "util/(queryTokens|promptQuery|normalizeText|imageDates|ratingFilter|historyMatch|historyNav|playlist|gridNav)" src`
Expected: 一致なし（exit code 1）

- [ ] **Step 10: 型チェックとテストを実行する**

Run: `npm run build && npm test`
Expected: 両方 PASS。`tsc` が `@gim/shared/*` を解決できること、既存のコンポーネントテストが緑であること

- [ ] **Step 11: デスクトップ版が従来通り動くことを確認する**

Run: `npm run tauri dev`
Expected: フィルタダイアログを開いてレーティング・サイズ・日付の条件を設定するとクエリ文字列に反映される。フィルタ欄の履歴ドロップダウンが上下キーで選べる。スライドショーが起動して自動送りする。確認したらウィンドウを閉じる

- [ ] **Step 12: コミット**

```bash
git add packages/ pnpm-workspace.yaml package.json pnpm-lock.yaml src/types.ts
git add -u src
git commit -m "$(cat <<'EOF'
refactor(shared): 純粋ロジックと共有型を @gim/shared へ移設

web フロントと共有するため、UI にも Tauri にも依存しない関数群と
一覧表示用の型を pnpm workspace パッケージへ切り出した。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `DirScope` の導入

**Files:**
- Modify: `crates/core/src/db/image_query.rs:42-79`（実装）、同ファイルのテストモジュール
- Modify: `src-tauri/src/commands/query.rs:8-32`

**Interfaces:**
- Consumes: Task 2 の `gim-core` クレート
- Produces:
  - `gim_core::db::image_query::DirScope`（`Visible` / `Ids(Vec<i64>)`）
  - `query_images(conn: &Connection, query_text: &str, scope: &DirScope, sort: SortKey, dir: SortDir, limit: i64, offset: i64) -> rusqlite::Result<Vec<ImageRow>>`
  - `count_query(conn: &Connection, query_text: &str, scope: &DirScope) -> rusqlite::Result<i64>`

**設計上の決定:** `DirScope::Ids` は `directories.visible` を参照しない。ID を明示した呼び出しがデスクトップ版の表示設定に上書きされるのは意図に反するため。web 側の初期選択が `visible = 1` になるかどうかはクライアントの責務であり、この層は関知しない。

- [ ] **Step 1: 失敗するテストを書く**

`crates/core/src/db/image_query.rs` のテストモジュール末尾に追加する。既存のテスト用ヘルパ `conn()`（ディレクトリ `/d` を1件だけ作る = ID 1）・`img()`・`seed()`（`/d` 配下に `a.png` rating 5 / `b.png` rating 3 / `c.png` rating 4 の3件）をそのまま使う。

2つ目のディレクトリを足すテストでは `directories` へ直接 INSERT し、その ID（2）を使う。

```rust
    /// 2つ目のディレクトリと、そこに属する画像1件を足す。
    fn seed_second_dir(c: &Connection) {
        c.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/e', 'e', 1)",
            [],
        )
        .unwrap();
        let mut extra = img("/e/z.png", "desert dune", Some(2), 800);
        extra.directory_id = 2;
        crate::db::images::upsert(c, &extra).unwrap();
    }

    #[test]
    fn dir_scope_ids_limits_to_listed_directories() {
        let c = conn();
        seed(&c);
        seed_second_dir(&c);
        assert_eq!(count_query(&c, "", &DirScope::Visible).unwrap(), 4);

        let only_first =
            query_images(&c, "", &DirScope::Ids(vec![1]), SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(only_first.len(), 3);

        let only_second =
            query_images(&c, "", &DirScope::Ids(vec![2]), SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(only_second.len(), 1);
        assert_eq!(only_second[0].filename, "z.png");

        assert_eq!(count_query(&c, "", &DirScope::Ids(vec![1, 2])).unwrap(), 4);
    }

    #[test]
    fn dir_scope_empty_ids_returns_nothing() {
        let c = conn();
        seed(&c);
        let rows =
            query_images(&c, "", &DirScope::Ids(vec![]), SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert!(rows.is_empty());
        assert_eq!(count_query(&c, "", &DirScope::Ids(vec![])).unwrap(), 0);
    }

    #[test]
    fn dir_scope_unknown_id_returns_nothing() {
        let c = conn();
        seed(&c);
        let rows =
            query_images(&c, "", &DirScope::Ids(vec![999]), SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn dir_scope_ids_still_applies_query_conditions() {
        let c = conn();
        seed(&c);
        seed_second_dir(&c);
        // FTS条件・構造化条件・スコープ・LIMIT/OFFSET のバインド順が崩れていないこと。
        let rows = query_images(
            &c,
            "forest rating:>=4",
            &DirScope::Ids(vec![1]),
            SortKey::Filename,
            SortDir::Asc,
            100,
            0,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].filename, "a.png");
        assert_eq!(count_query(&c, "forest rating:>=4", &DirScope::Ids(vec![1])).unwrap(), 1);
    }

    #[test]
    fn dir_scope_visible_excludes_hidden_directories() {
        let c = conn();
        seed(&c);
        seed_second_dir(&c);
        c.execute("UPDATE directories SET visible = 0 WHERE id = 2", []).unwrap();
        assert_eq!(count_query(&c, "", &DirScope::Visible).unwrap(), 3);
        // Ids は visible を無視して指定 ID をそのまま対象にする。
        assert_eq!(count_query(&c, "", &DirScope::Ids(vec![2])).unwrap(), 1);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-core dir_scope`
Expected: コンパイルエラー。`DirScope` が見つからない、および `query_images` の引数の数が合わない

- [ ] **Step 3: `DirScope` を実装する**

`crates/core/src/db/image_query.rs` の `SELECT_COLS` 定数の直後に追加する。

```rust
/// 検索対象ディレクトリの範囲。
#[derive(Debug, Clone, PartialEq)]
pub enum DirScope {
    /// visible = 1 のディレクトリのみ（デスクトップ版の従来の挙動）。
    Visible,
    /// 指定 ID のディレクトリのみ。
    Ids(Vec<i64>),
}

impl DirScope {
    /// WHERE 句に AND 連結する SQL 断片と、追加のバインド値を返す。
    /// ID は必ずバインドパラメータで渡し、SQL には埋め込まない。
    fn sql_and_params(&self) -> (String, Vec<Value>) {
        match self {
            DirScope::Visible => (
                "directory_id IN (SELECT id FROM directories WHERE visible = 1)".to_string(),
                Vec::new(),
            ),
            DirScope::Ids(ids) => {
                if ids.is_empty() {
                    // IN () は構文エラーになるため、常に偽になる式へ落とす。
                    return ("0".to_string(), Vec::new());
                }
                let placeholders = vec!["?"; ids.len()].join(", ");
                (
                    format!("directory_id IN ({placeholders})"),
                    ids.iter().map(|i| Value::Integer(*i)).collect(),
                )
            }
        }
    }
}
```

- [ ] **Step 4: `query_images` と `count_query` を引数化する**

42-79行目を以下に置き換える。

```rust
/// クエリ文字列でフィルタし、ソート・ページングして画像行を返す。
pub fn query_images(
    conn: &Connection,
    query_text: &str,
    scope: &DirScope,
    sort: SortKey,
    dir: SortDir,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<ImageRow>> {
    let cf = compile::compile(&parse::parse(query_text));
    let (dir_sql, dir_params) = scope.sql_and_params();
    let sql = format!(
        "SELECT {cols} FROM images WHERE ({where_sql}) \
         AND {dir_sql} \
         ORDER BY {sortcol} {sortdir}, id {sortdir} LIMIT ? OFFSET ?",
        cols = SELECT_COLS,
        where_sql = cf.where_sql,
        dir_sql = dir_sql,
        sortcol = sort.column(),
        sortdir = dir.sql(),
    );
    let mut p = cf.params;
    p.extend(dir_params);
    p.push(Value::Integer(limit));
    p.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(p), row_to_image)?;
    rows.collect()
}

/// クエリ文字列に一致する画像件数を返す。
pub fn count_query(conn: &Connection, query_text: &str, scope: &DirScope) -> rusqlite::Result<i64> {
    let cf = compile::compile(&parse::parse(query_text));
    let (dir_sql, dir_params) = scope.sql_and_params();
    let sql = format!(
        "SELECT count(*) FROM images WHERE ({}) AND {}",
        cf.where_sql, dir_sql
    );
    let mut p = cf.params;
    p.extend(dir_params);
    conn.query_row(&sql, params_from_iter(p), |r| r.get(0))
}
```

- [ ] **Step 5: 既存テストの呼び出しに `&DirScope::Visible` を足す**

テストモジュール内の既存の `query_images(&c, ...)` / `count_query(&c, ...)` 呼び出しに `scope` 引数を追加する。既存の呼び出しはすべて1行で、クエリ文字列リテラルを直接渡している。

```bash
cd /Users/ikomiki/workspace/gen-img-manager
sed -i '' -E \
  -e 's/query_images\(&c, ("[^"]*"), SortKey::/query_images(\&c, \1, \&DirScope::Visible, SortKey::/g' \
  -e 's/count_query\(&c, ("[^"]*")\)/count_query(\&c, \1, \&DirScope::Visible)/g' \
  crates/core/src/db/image_query.rs
```

Step 1 で追加した新規テストは `query_images` の第3引数が `&DirScope::...`、`count_query` の第2引数の後に `, &DirScope::...` が続くため、どちらのパターンにも一致せず二重には付かない。

対象は既存の8テスト内の呼び出し: `empty_query_returns_all_non_missing`・`fts_include_filters`・`fts_exclude_filters`・`rating_and_width_conds`・`rating_set_with_none_matches_null_and_listed`・`sort_asc_desc_by_filename`・`limit_and_offset_paginate`・`missing_rows_excluded`。

Run: `grep -n "query_images(&c\|count_query(&c" crates/core/src/db/image_query.rs`
Expected: すべての行に `&DirScope::` が含まれている（複数行に分かれた新規テストの呼び出しを除く）

- [ ] **Step 6: core のテストを実行して通ることを確認する**

Run: `cargo test -p gim-core`
Expected: PASS。Step 1 で追加した5件を含め、`image_query` のテストがすべて緑

- [ ] **Step 7: Tauri コマンドの呼び出しを直す**

`src-tauri/src/commands/query.rs` の1行目の import を変更する。

```rust
use crate::db::image_query::{self, DirScope, ImageDetail, ImageRow};
```

`query_images` コマンド（17-24行目）の呼び出しを変更する。

```rust
    image_query::query_images(
        &conn,
        &query,
        &DirScope::Visible,
        SortKey::parse(&sort),
        SortDir::parse(&dir),
        limit,
        offset,
    )
    .map_err(|e| e.to_string())
```

`count_query` コマンド（32行目）の呼び出しを変更する。

```rust
    image_query::count_query(&conn, &query, &DirScope::Visible).map_err(|e| e.to_string())
```

- [ ] **Step 8: workspace 全体のテストを実行する**

Run: `cargo test --workspace`
Expected: PASS

- [ ] **Step 9: デスクトップ版の検索結果が変わっていないことを確認する**

Run: `npm run tauri dev`
Expected: 画像一覧の件数が変更前と同じ。ディレクトリパネルで表示を OFF にすると該当ディレクトリの画像が一覧から消え、ON に戻すと現れる。クエリ（例: `rating:>=3 width:>=1024`）で絞った結果が正しい。確認したらウィンドウを閉じる

- [ ] **Step 10: コミット**

```bash
git add crates/core/src/db/image_query.rs src-tauri/src/commands/query.rs
git commit -m "$(cat <<'EOF'
feat(core): 検索対象ディレクトリを DirScope で指定できるようにする

web 版が任意のディレクトリ集合で絞り込めるよう、visible=1 の直書きを
呼び出し側からの指定に置き換えた。デスクトップ版は DirScope::Visible を渡す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- `cargo test --workspace` が緑
- `npm test` が緑
- `npm run build` が緑
- `npm run bump -- patch --dry-run` が4ファイルすべてのバージョンを読める
- `npm run tauri dev` でデスクトップ版が起動し、一覧・フィルタ・履歴・スライドショー・ディレクトリ表示切替が従来通り動く
- `crates/core` が `gim_core::{models, query, db}` を公開し、`DirScope::Ids` で任意のディレクトリ集合に絞れる
- `@gim/shared` が9つの純粋モジュールと共有型を公開する

この計画の完了時点でデスクトップ版の振る舞いは変わっていない。web サーバの実装は計画2、web フロントは計画3で扱う。

spec の `packages/shared` 節にある「履歴操作の純粋関数（記録・重複時の先頭への昇格・上限50件）」は、localStorage 履歴を使う web フロント側でのみ必要になるため計画3で追加する。この計画では既存関数の移設だけを行う。
