# web ビューア 計画3: フロント基盤と一覧・フィルタ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LAN 内のブラウザ（スマホ・タブレット・PC）から画像一覧を閲覧し、クエリ・履歴・GUI フォーム・ディレクトリ選択で絞り込めるようにする。

**Architecture:** `web/` に Vite + React 19 の SPA を新設し、開発時は Vite dev server が `/api` を `gim-server`（計画2）へプロキシする。純粋ロジックは `@gim/shared` から取り、UI は web 専用に書く。サーバ側は先に整地する（レスポンスから絶対パスを落とす、エラー応答を JSON に統一する、アクセスログを出す）。

**Tech Stack:** React 19 / TypeScript 5.8 / Vite 7 / zustand 5 / @tanstack/react-virtual 3 / vitest 4 / Rust (axum 0.8)

**Spec:** `docs/superpowers/specs/2026-08-16-web-viewer-design.md`

## Global Constraints

- **`library.db` に一切書き込まない。** サーバの接続は `gim_core::db::open_read_only` 経由のみ
- **web の状態はすべてクライアント側に持つ。** サーバはステートレス。履歴・ソート・ディレクトリ選択・最後のクエリは localStorage
- SQL の列名は許可リストの `&'static str` のみを埋め込み、値は必ずバインドパラメータで渡す
- `db/migrations.rs` の `MIGRATIONS` 配列は一切変更しない
- `crates/server` と `web` の `version` は `"0.0.0"` 固定。`npm run bump` の対象に含めない
- **`cargo fmt` をリポジトリ全体に適用しない。** `crates/core` は rustfmt 未整形。`crates/server` は `cargo fmt -p gim-server` に限れば可
- **デスクトップ版（`src/`・`src-tauri/`）の振る舞いを変えない。** 共有コードに手を入れるときは既存テストで担保する
- パッケージマネージャは **pnpm**。`package-lock.json` は残骸なので触らない
- コードコメントは非自明な WHY のみ。WHAT・変更履歴・タスク ID は書かない
- コミットメッセージは Conventional Commits のプリフィックスを英語、要約と本文を日本語で書く

## この計画のスコープ

含む: サーバ整地（DTO・エラー応答・ログ）、`web/` の足場、localStorage 層、一覧画面（仮想スクロール + 無限スクロール）、フィルタバーと履歴、フィルタシート、ディレクトリシート。

含まない: ビューア、スライドショー、`rust-embed` による単一バイナリ化、ユーザ向け HTML ドキュメント（すべて計画4）。

この計画の完了時点で、スマホのブラウザから一覧が見え、クエリと GUI フォームで絞り込め、ディレクトリを選べる状態になる。サムネイルをタップしても何も起きない（ビューアは計画4）。

## UI の方向性

デスクトップ版と同じ製品に見えるよう、配色を揃える。デスクトップ版は暗色でアクセントが `#3a6ea5`。

| トークン | 値 | 用途 |
|---|---|---|
| `--bg` | `#121212` | アプリ背景 |
| `--bg-media` | `#0d0d0d` | 画像が載る領域 |
| `--surface` | `#1a1a1a` | バー・シート |
| `--surface-raised` | `#232323` | シート内のコントロール |
| `--border` | `#2e2e2e` | 罫線 |
| `--text` | `#e6e6e6` | 本文 |
| `--text-dim` | `#8a8a8a` | 副次情報 |
| `--accent` | `#3a6ea5` | 選択・強調 |

モバイル前提の作法:

- **タップ対象は最小 44×44 px**（指で押せない UI を作らない）
- **`env(safe-area-inset-*)` を尊重する**（iPhone のノッチとホームバーに潜り込ませない）
- 下部固定のバーは `padding-bottom: env(safe-area-inset-bottom)` を持つ
- シートは下から出す（ボトムシート）。上部に閉じるためのつまみとタップ領域を置く
- ホバー前提の UI を作らない。ホバーは PC の付加要素に留める

---

## ファイル構成

**新規作成（サーバ側）**

| ファイル | 責務 |
|---|---|
| `crates/server/src/dto.rs` | HTTP 応答用の型。`ImageDto` と `gim_core` の型からの変換 |
| `crates/server/src/logging.rs` | アクセスログのミドルウェア |

**新規作成（web 側）**

| ファイル | 責務 |
|---|---|
| `web/package.json` | 依存とスクリプト |
| `web/vite.config.ts` | dev server と `/api` プロキシ |
| `web/tsconfig.json` | web 用の TS 設定 |
| `web/index.html` | エントリ |
| `web/src/main.tsx` | マウントのみ |
| `web/src/App.tsx` | 画面の骨格。バー・グリッド・シートの配置 |
| `web/src/theme.css` | 配色トークンとリセット |
| `web/src/api/client.ts` | fetch ラッパ。エラーを `ApiError` に正規化 |
| `web/src/api/images.ts` | 画像系エンドポイントの薄いラッパと URL 生成 |
| `web/src/api/directories.ts` | ディレクトリ一覧 |
| `web/src/storage.ts` | localStorage の読み書き（`gim.web.*` 名前空間） |
| `web/src/store/useQueryStore.ts` | クエリ・ソート・ディレクトリ選択・結果・ページング |
| `web/src/components/ImageGrid.tsx` | 仮想スクロールのグリッドと無限スクロール |
| `web/src/components/FilterBar.tsx` | クエリ入力・件数・ソート切替・シートを開くボタン |
| `web/src/components/HistoryList.tsx` | 履歴の絞り込み表示と選択 |
| `web/src/components/FilterSheet.tsx` | GUI フォーム → クエリ文字列 |
| `web/src/components/DirectorySheet.tsx` | ディレクトリのチェックボックス一覧 |
| `web/src/components/Sheet.tsx` | ボトムシートの器（開閉・背景・safe-area） |

**新規作成（共有）**

| ファイル | 責務 |
|---|---|
| `packages/shared/src/history.ts` | 履歴の記録・昇格・上限の純粋関数 |

**変更**

| ファイル | 変更内容 |
|---|---|
| `Cargo.toml`（ルート） | `[workspace.dependencies]` に共通依存を集約 |
| `crates/core/Cargo.toml`・`crates/server/Cargo.toml`・`src-tauri/Cargo.toml` | 集約した依存を `workspace = true` に置換 |
| `crates/server/src/routes/images.rs` | `ImageDto` を返す |
| `crates/server/src/routes/mod.rs` | fallback route とログのミドルウェアを追加 |
| `crates/server/src/error.rs` | `Query`/`Path` の rejection を JSON に揃える |
| `crates/server/src/main.rs` | `mod dto; mod logging;` |
| `pnpm-workspace.yaml` | `web` をメンバに追加 |

---

## Task 1: `[workspace.dependencies]` への依存集約

**Files:**
- Modify: `Cargo.toml`（ルート）, `crates/core/Cargo.toml`, `crates/server/Cargo.toml`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: なし
- Produces: ルート `Cargo.toml` の `[workspace.dependencies]` に `rusqlite` / `serde` / `serde_json` / `chrono` / `thiserror` / `image` / `webp` / `tempfile` が定義され、各クレートは `{ workspace = true }`（features は各クレート側で追加）で参照する

**振る舞いは一切変わりません。** `Cargo.lock` の解決結果が変わっていないことが成功条件です。

`rusqlite::Connection` はクレート境界を越えて受け渡される型なので、`gim-core` と `gim-server` でバージョンがずれると型が非互換になり、原因の分かりにくいコンパイルエラーになります。集約はそれを構造的に防ぎます。

- [ ] **Step 1: 現在の依存バージョンを記録する**

Run: `grep -n "rusqlite\|serde\|chrono\|thiserror\|image\|webp\|tempfile" src-tauri/Cargo.toml crates/core/Cargo.toml crates/server/Cargo.toml`
Expected: 各クレートの現在の指定が一覧できる。**この出力をレポートに貼り、集約後と突き合わせること**

- [ ] **Step 2: 現在の `Cargo.lock` の解決バージョンを記録する**

Run: `grep -A1 '^name = "rusqlite"\|^name = "serde"\|^name = "chrono"\|^name = "image"\|^name = "webp"\|^name = "thiserror"' Cargo.lock`
Expected: 解決済みバージョンが一覧できる。**この出力もレポートに貼ること**

- [ ] **Step 3: ルート `Cargo.toml` に `[workspace.dependencies]` を足す**

Step 1 で読み取った実際のバージョンを使うこと（下は現時点の想定値。食い違ったら実測値を優先する）。

```toml
[workspace.dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = "0.4"
thiserror = "1"
image = "0.25"
webp = "0.3"
tempfile = "3"
```

- [ ] **Step 4: 各クレートの指定を `workspace = true` へ置き換える**

`crates/core/Cargo.toml`・`crates/server/Cargo.toml`・`src-tauri/Cargo.toml` の該当行を、

```toml
rusqlite = { workspace = true }
serde = { workspace = true }
```

の形にする。**そのクレートが元々使っていなかった依存を足さないこと。** 各クレートの依存の集合は変えず、バージョン指定の場所だけを移します。

`src-tauri` が `thiserror = "1"` を使い `crates/server` が使っていないなら、`crates/server` には書かないままにします。

- [ ] **Step 5: `Cargo.lock` が変わっていないことを確認する**

Run: `cargo check --workspace && git diff --stat Cargo.lock`
Expected: `cargo check` が成功し、`Cargo.lock` に差分が無い（依存の解決結果が同じ）。**差分が出た場合は、どのパッケージのバージョンがどう変わったかをレポートに書き、意図しない変更なら Step 3 のバージョン指定を実測値へ直すこと**

- [ ] **Step 6: 全テストを実行する**

Run: `cargo test --workspace`
Expected: PASS（src-tauri 64 + gim-core 135 + gim-server 37 = 236）

- [ ] **Step 7: コミット**

```bash
git add Cargo.toml Cargo.lock crates/core/Cargo.toml crates/server/Cargo.toml src-tauri/Cargo.toml
git commit -m "$(cat <<'EOF'
build(cargo): 共通依存を workspace.dependencies へ集約する

クレート境界を越える rusqlite などのバージョンずれを構造的に防ぐ。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: サーバ応答から絶対パスを落とす

**Files:**
- Create: `crates/server/src/dto.rs`
- Modify: `crates/server/src/routes/images.rs`, `crates/server/src/routes/directories.rs`, `crates/server/src/main.rs`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `dto::ImageDto { id, filename, width, height, rating, created_at, modified_at, source_tool, model }`
  - `dto::DirectoryDto { id, label, is_online, visible, image_count }`
  - `impl From<gim_core::db::image_query::ImageRow> for ImageDto`、`impl From<gim_core::models::Directory> for DirectoryDto`
  - `GET /api/images` が `Vec<ImageDto>` を、`GET /api/directories` が `Vec<DirectoryDto>` を返す

### なぜやるか

`ImageRow.path` と `Directory.path` は `/Users/<ユーザ名>/...` という絶対パスです。このサーバは**認証なしで LAN に公開される**ので、同一ネットワークの誰でもディレクトリ構成とユーザ名が見えます。フロントは `/api/thumb/{id}` と `/api/image/{id}` を使うので `path` は不要です。

`thumb_path` と `pixels` も同じ理由・同じ判断で落とします（`thumb_path` は絶対パス、`pixels` は `width * height` で導出できる）。

**`gim_core` 側の `ImageRow` は変更しません。** デスクトップ版が `path` を使っています（Finder で開く・削除する）。変換はサーバ側で行います。

- [ ] **Step 1: 失敗するテストを書く**

`crates/server/src/routes/images.rs` のテストモジュールに追加する。

```rust
    #[tokio::test]
    async fn list_does_not_expose_filesystem_paths() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images").await;
        let first = &body.as_array().unwrap()[0];

        assert!(first.get("path").is_none(), "絶対パスを返してはいけない");
        assert!(first.get("thumb_path").is_none(), "サムネイルの絶対パスも返してはいけない");

        // フロントが必要とする列は残っていること。
        for key in ["id", "filename", "width", "height", "rating", "created_at", "source_tool"] {
            assert!(first.get(key).is_some(), "{key} が欠けている");
        }
    }
```

`crates/server/src/routes/directories.rs` のテストモジュールに追加する。

```rust
    #[tokio::test]
    async fn directories_do_not_expose_filesystem_paths() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/directories").await;
        let first = &body.as_array().unwrap()[0];

        assert!(first.get("path").is_none(), "絶対パスを返してはいけない");
        assert_eq!(first["label"], "d");
        assert_eq!(first["image_count"], 3);
        assert_eq!(first["visible"], true);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-server does_not_expose`
Expected: FAIL。`path` が存在するため `is_none()` が false になる

- [ ] **Step 3: `dto.rs` を書く**

```rust
//! HTTP 応答の型。ファイルシステム上のパスをクライアントへ出さないための境界。

use gim_core::db::image_query::ImageRow;
use gim_core::models::Directory;
use serde::Serialize;

/// 一覧表示に必要な列だけ。画像の取得は id 経由（/api/thumb/{id}・/api/image/{id}）なので
/// パスは要らない。認証なしで LAN に公開する以上、出さないものは持たせない。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageDto {
    pub id: i64,
    pub filename: String,
    pub width: i64,
    pub height: i64,
    pub rating: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub source_tool: String,
    pub model: Option<String>,
}

impl From<ImageRow> for ImageDto {
    fn from(r: ImageRow) -> Self {
        Self {
            id: r.id,
            filename: r.filename,
            width: r.width,
            height: r.height,
            rating: r.rating,
            created_at: r.created_at,
            modified_at: r.modified_at,
            source_tool: r.source_tool,
            model: r.model,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DirectoryDto {
    pub id: i64,
    pub label: String,
    pub is_online: bool,
    pub visible: bool,
    pub image_count: i64,
}

impl From<Directory> for DirectoryDto {
    fn from(d: Directory) -> Self {
        Self {
            id: d.id,
            label: d.label,
            is_online: d.is_online,
            visible: d.visible,
            image_count: d.image_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_dto_carries_display_columns() {
        let row = ImageRow {
            id: 7,
            path: "/Users/someone/pics/a.png".to_string(),
            filename: "a.png".to_string(),
            thumb_path: Some("/Users/someone/thumbs/x.webp".to_string()),
            width: 1024,
            height: 1536,
            pixels: 1024 * 1536,
            rating: Some(4),
            created_at: Some(1000),
            modified_at: Some(2000),
            source_tool: "a1111".to_string(),
            model: Some("sd_xl".to_string()),
        };
        let dto = ImageDto::from(row);
        assert_eq!(dto.id, 7);
        assert_eq!(dto.filename, "a.png");
        assert_eq!(dto.width, 1024);
        assert_eq!(dto.height, 1536);
        assert_eq!(dto.rating, Some(4));
        assert_eq!(dto.model.as_deref(), Some("sd_xl"));

        // シリアライズ結果にパスが混ざらないこと。
        let json = serde_json::to_string(&dto).unwrap();
        assert!(!json.contains("/Users/"), "パスが漏れている: {json}");
        assert!(!json.contains("thumb_path"));
    }
}
```

- [ ] **Step 4: ハンドラを差し替える**

`crates/server/src/routes/images.rs` の `list` を変更する。

```rust
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<crate::dto::ImageDto>>, ApiError> {
    let conn = state.conn()?;
    let rows = image_query::query_images(
        &conn,
        &params.q,
        &scope(&params)?,
        params.sort_key(),
        params.sort_dir(),
        params.limit()?,
        params.offset()?,
    )?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}
```

`crates/server/src/routes/directories.rs` の `list` も同様に `DirectoryDto` へ変換する。

`crates/server/src/main.rs` に `mod dto;` を追加する。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server`
Expected: PASS（37 + 3 = 40件）

- [ ] **Step 6: 実ライブラリでパスが出ないことを確認する**

```bash
cargo run -p gim-server -- --port 5180 > /tmp/gim-t3-2.log 2>&1 &
PID=$!
sleep 3
curl -s "http://127.0.0.1:5180/api/images?limit=1"; echo
curl -s "http://127.0.0.1:5180/api/directories"; echo
kill $PID
```

Expected: どちらの JSON にも `/Users/` を含む文字列が現れない

- [ ] **Step 7: コミット**

```bash
git add crates/server
git commit -m "$(cat <<'EOF'
feat(server): 応答をDTO化しファイルシステムのパスを返さない

認証なしでLANに公開するため、一覧と画像取得に不要な絶対パスを
クライアントへ出さない。画像は id 経由で取得する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: エラー応答の JSON 統一とアクセスログ

**Files:**
- Create: `crates/server/src/logging.rs`
- Modify: `crates/server/src/error.rs`, `crates/server/src/routes/mod.rs`, `crates/server/src/main.rs`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - 未知のパス（404）・許可されないメソッド（405）・クエリパラメータの型不一致（400）が、すべて `{"error": "..."}` の JSON を返す
  - `logging::access_log` ミドルウェア（メソッド・パス・ステータス・所要時間を標準エラーへ1行）

### なぜやるか

現在、自前の 400 は `{"error": "..."}` の JSON ですが、axum の `Query` 抽出が失敗したとき（`?w=abc` など）は既定の `text/plain` が返ります。フロントが `res.json()` を無条件に呼べないと、エラー処理が場所ごとに分岐して汚れます。**フロントを書き始める前に揃えておきます。**

ログについては、現状サーバ側に起動メッセージ以外ほぼ何も出ません。スマホから届かないとき（ファイアウォール・URL 間違い・404）の手掛かりがゼロです。

- [ ] **Step 1: 失敗するテストを書く**

`crates/server/src/routes/mod.rs` にテストモジュールを追加する。

```rust
#[cfg(test)]
mod tests {
    use crate::test_support::{get_raw, test_state};
    use axum::http::header;
    use http_body_util::BodyExt;

    async fn assert_json_error(res: axum::response::Response, expected_status: u16) {
        assert_eq!(res.status(), expected_status);
        assert_eq!(
            res.headers()[header::CONTENT_TYPE],
            "application/json",
            "エラー応答は JSON であること"
        );
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(v.get("error").is_some(), "error キーが無い: {v}");
    }

    #[tokio::test]
    async fn unknown_path_returns_json_404() {
        let (state, _tmp) = test_state();
        assert_json_error(get_raw(state, "/api/nope").await, 404).await;
    }

    #[tokio::test]
    async fn malformed_query_returns_json_400() {
        let (state, _tmp) = test_state();
        // limit は i64。文字列を渡すと Query 抽出が失敗する。
        assert_json_error(get_raw(state, "/api/images?limit=abc").await, 400).await;
    }

    #[tokio::test]
    async fn wrong_method_returns_json_405() {
        let (state, _tmp) = test_state();
        let res = crate::test_support::request_raw(state, "POST", "/api/images").await;
        assert_json_error(res, 405).await;
    }
}
```

`crates/server/src/test_support.rs` に、メソッドを指定できる補助を足す。

```rust
/// メソッドを指定してリクエストする。
pub async fn request_raw(state: AppState, method: &str, uri: &str) -> axum::response::Response {
    routes::router(state)
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-server returns_json`
Expected: FAIL。404・405 は本体が空、400 は `text/plain`

- [ ] **Step 3: `ApiError` に rejection からの変換を足す**

`crates/server/src/error.rs` に追加する。

```rust
impl From<axum::extract::rejection::QueryRejection> for ApiError {
    fn from(r: axum::extract::rejection::QueryRejection) -> Self {
        ApiError::BadRequest(r.body_text())
    }
}

impl From<axum::extract::rejection::PathRejection> for ApiError {
    fn from(r: axum::extract::rejection::PathRejection) -> Self {
        ApiError::BadRequest(r.body_text())
    }
}
```

- [ ] **Step 4: ハンドラの抽出器を `Result` 受けにする**

`Query<T>` を直接引数に取ると、失敗時に axum が自前で応答してしまいます。`Result<Query<T>, QueryRejection>` で受けて `?` で変換すると、`ApiError` の `IntoResponse` を通ります。

`crates/server/src/routes/images.rs` の3ハンドラを変える（`list` の例）。

```rust
pub async fn list(
    State(state): State<AppState>,
    params: Result<Query<ListParams>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Vec<crate::dto::ImageDto>>, ApiError> {
    let Query(params) = params?;
    // 以降は変更なし
```

`crates/server/src/routes/media.rs` の `image` の `Query<ImageParams>` と、`thumb`/`image` の `Path<i64>` も同様にする。

- [ ] **Step 5: fallback route と 405 を JSON にする**

`crates/server/src/routes/mod.rs` の `router` に追加する。

```rust
use crate::error::ApiError;
use axum::response::IntoResponse;

/// 未知のパスは JSON の 404 を返す。クライアントが res.json() を無条件に呼べる状態を保つ。
async fn not_found() -> impl IntoResponse {
    ApiError::NotFound
}

pub fn router(state: AppState) -> Router {
    Router::new()
        // ... 既存のルート
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .layer(axum::middleware::from_fn(crate::logging::access_log))
        .with_state(state)
}

async fn method_not_allowed() -> impl IntoResponse {
    (
        axum::http::StatusCode::METHOD_NOT_ALLOWED,
        axum::Json(serde_json::json!({ "error": "このメソッドは使えません" })),
    )
}
```

`Router::method_not_allowed_fallback` は導入済みの axum 0.8.9 に存在します（`src/routing/mod.rs:374` で確認済み）。`QueryRejection` / `PathRejection` の `body_text()` も同様に存在します。

- [ ] **Step 6: アクセスログを書く**

`crates/server/src/logging.rs`:

```rust
use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use std::time::Instant;

/// 到達性の問題（URL 違い・ファイアウォール・404）を切り分ける最低限の手掛かり。
/// スマホから繋がらないとき、サーバ側に何も出ないと原因が絞れない。
pub async fn access_log(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_default();
    let started = Instant::now();

    let res = next.run(req).await;

    eprintln!(
        "{} {} -> {} ({} ms)",
        method,
        path,
        res.status().as_u16(),
        started.elapsed().as_millis()
    );
    res
}
```

`crates/server/src/main.rs` に `mod logging;` を追加する。

- [ ] **Step 7: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server`
Expected: PASS（40 + 3 = 43件、405 を諦めた場合も同数）

- [ ] **Step 8: `cargo clippy -p gim-server --all-targets` が警告ゼロであることを確認する**

Run: `cargo clippy -p gim-server --all-targets`
Expected: `gim-server` の警告がゼロ（`gim-core` の `type_complexity` は持ち越しで対象外）

- [ ] **Step 9: 実起動でログとエラー形式を確認する**

```bash
cargo run -p gim-server -- --port 5180 > /tmp/gim-t3-3.log 2>&1 &
PID=$!
sleep 3
curl -s "http://127.0.0.1:5180/api/nope"; echo
curl -s "http://127.0.0.1:5180/api/images?limit=abc"; echo
curl -s -o /dev/null "http://127.0.0.1:5180/api/images?limit=5"
kill $PID
cat /tmp/gim-t3-3.log
```

Expected: どちらのエラーも `{"error": ...}` の JSON。ログに `GET /api/nope -> 404 (0 ms)` のような行が3件出る

- [ ] **Step 10: コミット**

```bash
git add crates/server
git commit -m "$(cat <<'EOF'
feat(server): エラー応答をJSONに統一しアクセスログを出す

未知パス・メソッド不許可・クエリの型不一致まで {"error": ...} に揃え、
クライアントが res.json() を無条件に呼べるようにする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `web/` の足場と API クライアント

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/theme.css`, `web/src/api/client.ts`, `web/src/api/images.ts`, `web/src/api/directories.ts`
- Modify: `pnpm-workspace.yaml`, `package.json`（ルート、スクリプト追加）

**Interfaces:**
- Consumes: Task 2・3 のサーバ API
- Produces:
  - `web` パッケージ（`@gim/web`）。`pnpm -C web dev` で Vite dev server が立ち、`/api` を `localhost:5180` へプロキシする
  - `api/client.ts`: `getJson<T>(path, params?) -> Promise<T>`、`ApiError { status, message }`
  - `api/images.ts`: `listImages(params)`、`countImages(params)`、`listImageIds(params)`、`thumbUrl(id)`、`imageUrl(id, w?)`、`type ImageDto`
  - `api/directories.ts`: `listDirectories()`、`type DirectoryDto`
  - `dirsParam(dirs: number[] | null): string | undefined`

### 決定事項

**`dirs` の送り方**（計画2の申し送り）。3状態を1箇所に閉じ込めます。

| クライアントの状態 | 送るもの |
|---|---|
| `null`（未選択・初期値） | `dirs` キーを送らない → サーバは `visible = 1` に従う |
| `[]`（全部のチェックを外した） | `dirs=`（空文字列）→ 0件 |
| `[1, 3]` | `dirs=1,3` |

`URLSearchParams` に `undefined` を渡すと文字列 `"undefined"` になるので、**キーを足すかどうかの判定を必ず経由**します。

- [ ] **Step 1: `web/package.json` を作る**

```json
{
  "name": "@gim/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@gim/shared": "workspace:*",
    "@tanstack/react-virtual": "^3.14.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "typescript": "~5.8.3",
    "vite": "^7.0.4"
  }
}
```

- [ ] **Step 2: pnpm workspace に登録してインストールする**

`pnpm-workspace.yaml` を以下にする。

```yaml
packages:
  - "packages/*"
  - "web"

allowBuilds:
  esbuild: true
```

Run: `pnpm install`
Expected: 成功。`ls -l web/node_modules/@gim/shared` がシンボリックリンクを示す

- [ ] **Step 3: Vite 設定を書く**

`web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // スマホの実機から dev server を直接見られるようにする。
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5180",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: API クライアントの失敗するテストを書く**

`web/src/api/client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getJson, ApiError, buildQuery, dirsParam } from "./client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": contentType },
      }),
    ),
  );
}

describe("dirsParam", () => {
  it("null はキーを送らない意味の undefined を返す", () => {
    expect(dirsParam(null)).toBeUndefined();
  });

  it("空配列は空文字列（0件の意味）", () => {
    expect(dirsParam([])).toBe("");
  });

  it("配列はカンマ区切り", () => {
    expect(dirsParam([1, 3])).toBe("1,3");
  });
});

describe("buildQuery", () => {
  it("undefined のキーは落とす", () => {
    expect(buildQuery({ a: "1", b: undefined })).toBe("?a=1");
  });

  it("空文字列のキーは残す", () => {
    expect(buildQuery({ dirs: "" })).toBe("?dirs=");
  });

  it("すべて undefined なら空文字列", () => {
    expect(buildQuery({ a: undefined })).toBe("");
  });

  it("値をエスケープする", () => {
    expect(buildQuery({ q: "a b&c" })).toBe("?q=a+b%26c");
  });
});

describe("getJson", () => {
  it("成功時は本文を返す", async () => {
    stubFetch(200, { total: 3 });
    await expect(getJson("/api/images/count")).resolves.toEqual({ total: 3 });
  });

  it("エラー時は error キーを message にした ApiError を投げる", async () => {
    stubFetch(400, { error: "limit は 1〜1000 で指定してください: 0" });
    await expect(getJson("/api/images")).rejects.toMatchObject({
      status: 400,
      message: "limit は 1〜1000 で指定してください: 0",
    });
  });

  it("JSON でないエラー本文でも ApiError になる", async () => {
    stubFetch(500, "boom", "text/plain");
    const err = await getJson("/api/images").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});
```

- [ ] **Step 5: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/api/client.test.ts`
Expected: FAIL。`./client` が存在しない

- [ ] **Step 6: API クライアントを書く**

`web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * `dirs` の3状態をここに閉じ込める。
 * null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。
 */
export function dirsParam(dirs: number[] | null): string | undefined {
  return dirs === null ? undefined : dirs.join(",");
}

/**
 * undefined のキーを落としてクエリ文字列を作る。
 * URLSearchParams に undefined を渡すと文字列 "undefined" になるため、
 * キーを足すかどうかの判定をここで必ず経由させる。
 */
export function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function getJson<T>(
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const res = await fetch(`${path}${buildQuery(params)}`);
  if (!res.ok) {
    // サーバは全エラーを {"error": ...} で返すが、経路によっては届かないこともある。
    const message = await res
      .json()
      .then((b: unknown) =>
        typeof b === "object" && b !== null && "error" in b ? String(b.error) : res.statusText,
      )
      .catch(() => res.statusText);
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
```

`web/src/api/images.ts`:

```ts
import { getJson, dirsParam } from "./client";
import type { SortKey, SortDir } from "@gim/shared/types";

/** サーバの ImageDto。ファイルシステム上のパスは含まれない。 */
export interface ImageDto {
  id: number;
  filename: string;
  width: number;
  height: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  source_tool: string;
  model: string | null;
}

export interface ListParams {
  q: string;
  sort: SortKey;
  dir: SortDir;
  dirs: number[] | null;
  limit?: number;
  offset?: number;
}

function toQuery(p: ListParams): Record<string, string | undefined> {
  return {
    q: p.q || undefined,
    sort: p.sort,
    dir: p.dir,
    dirs: dirsParam(p.dirs),
    limit: p.limit?.toString(),
    offset: p.offset?.toString(),
  };
}

export const listImages = (p: ListParams) => getJson<ImageDto[]>("/api/images", toQuery(p));

export const countImages = (p: ListParams) =>
  getJson<{ total: number }>("/api/images/count", toQuery(p));

export const listImageIds = (p: ListParams) => getJson<number[]>("/api/images/ids", toQuery(p));

export const thumbUrl = (id: number) => `/api/thumb/${id}`;

export const imageUrl = (id: number, w?: number) =>
  w === undefined ? `/api/image/${id}` : `/api/image/${id}?w=${w}`;
```

`web/src/api/directories.ts`:

```ts
import { getJson } from "./client";

export interface DirectoryDto {
  id: number;
  label: string;
  is_online: boolean;
  visible: boolean;
  image_count: number;
}

export const listDirectories = () => getJson<DirectoryDto[]>("/api/directories");
```

- [ ] **Step 7: 最小の画面を書く**

`web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>gen-img-manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`viewport-fit=cover` は `env(safe-area-inset-*)` を効かせるために必要です。

`web/src/theme.css`:

```css
:root {
  --bg: #121212;
  --bg-media: #0d0d0d;
  --surface: #1a1a1a;
  --surface-raised: #232323;
  --border: #2e2e2e;
  --text: #e6e6e6;
  --text-dim: #8a8a8a;
  --accent: #3a6ea5;
  --tap: 44px;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
  /* モバイルでのバウンススクロールが固定バーと喧嘩するのを避ける。 */
  overscroll-behavior: none;
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx`（この時点では疎通確認だけ。Task 6 以降で中身を入れる）:

```tsx
import { useEffect, useState } from "react";
import { getJson } from "./api/client";

export function App() {
  const [health, setHealth] = useState<string>("...");

  useEffect(() => {
    getJson<{ schema_version: number; image_count: number }>("/api/health")
      .then((h) => setHealth(`schema ${h.schema_version} / ${h.image_count} 枚`))
      .catch((e) => setHealth(`エラー: ${e.message}`));
  }, []);

  return <p style={{ padding: 16 }}>{health}</p>;
}
```

- [ ] **Step 8: ルート `package.json` にスクリプトを足す**

`scripts` に追加する（pnpm workspace 上で動かすため `pnpm -C` を使う。ユーザは `npm run web:dev` で呼べる）。

```json
    "web:dev": "pnpm -C web dev",
    "web:build": "pnpm -C web build",
```

- [ ] **Step 9: テストと型チェックを実行する**

Run: `npx vitest run web && npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS。`npm test` は既存270件 + client のテスト（vitest の既定 include が `web/src/**/*.test.ts` を拾う想定。拾わなければルートの `vite.config.ts` に最小限の設定を足し、その旨をレポートに書くこと）

- [ ] **Step 10: サーバと web を同時に立てて疎通を確認する**

```bash
cargo run -p gim-server -- --port 5180 > /tmp/gim-t3-4-server.log 2>&1 &
SPID=$!
pnpm -C web dev > /tmp/gim-t3-4-web.log 2>&1 &
WPID=$!
sleep 6
curl -s http://127.0.0.1:5181/ | head -c 200; echo
curl -s http://127.0.0.1:5181/api/health; echo
kill $WPID $SPID
cat /tmp/gim-t3-4-web.log
```

Expected: `/` が HTML を返し、`/api/health` がプロキシ経由でサーバの JSON を返す

- [ ] **Step 11: コミット**

```bash
git add web pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): Vite + React の足場とAPIクライアントを追加

dev server は /api を gim-server へプロキシする。dirs パラメータの
3状態（未指定・0件・指定ID）をクライアント側の1箇所に閉じ込めた。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 履歴の純粋関数と localStorage 層

**Files:**
- Create: `packages/shared/src/history.ts`, `packages/shared/src/history.test.ts`, `web/src/storage.ts`, `web/src/storage.test.ts`

**Interfaces:**
- Consumes: Task 4
- Produces:
  - `@gim/shared/history`: `recordHistory(history: string[], query: string, max: number): string[]`
  - `web/src/storage.ts`: `loadPrefs(): Prefs`、`savePrefs(p: Partial<Prefs>): void`、`type Prefs { query, sort, dir, dirs, history }`

### 決定事項

履歴の上限は **50件**（Rust 側の `db/history.rs` は20件）。localStorage は容量に余裕があり、スマホでの手入力を減らす価値が大きいためです。

`recordHistory` は Rust の `db::history::record` と同じ規則にします: 前後の空白を落とす、空文字列は無視、既存の同一文字列は先頭へ昇格（重複を作らない）、上限を超えたら古いものから捨てる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/src/history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recordHistory } from "./history";

describe("recordHistory", () => {
  it("新しいものを先頭に足す", () => {
    expect(recordHistory(["a"], "b", 50)).toEqual(["b", "a"]);
  });

  it("空文字列と空白のみは無視する", () => {
    expect(recordHistory(["a"], "", 50)).toEqual(["a"]);
    expect(recordHistory(["a"], "   ", 50)).toEqual(["a"]);
  });

  it("前後の空白を落として記録する", () => {
    expect(recordHistory([], "  rating:5  ", 50)).toEqual(["rating:5"]);
  });

  it("既存の同一文字列は先頭へ昇格し、重複を作らない", () => {
    expect(recordHistory(["a", "b", "c"], "c", 50)).toEqual(["c", "a", "b"]);
  });

  it("上限を超えたら古いものから捨てる", () => {
    const hist = ["a", "b", "c"];
    expect(recordHistory(hist, "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("元の配列を書き換えない", () => {
    const hist = ["a"];
    recordHistory(hist, "b", 50);
    expect(hist).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run packages/shared/src/history.test.ts`
Expected: FAIL。`./history` が存在しない

- [ ] **Step 3: `recordHistory` を実装する**

`packages/shared/src/history.ts`:

```ts
/**
 * クエリ履歴へ1件記録する。Rust の db::history::record と同じ規則。
 * 空は無視、既存の同一文字列は先頭へ昇格（重複を作らない）、上限超過は古いものから捨てる。
 */
export function recordHistory(history: string[], query: string, max: number): string[] {
  const trimmed = query.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, max);
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run packages/shared/src/history.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: localStorage 層の失敗するテストを書く**

`web/src/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, DEFAULT_PREFS } from "./storage";

beforeEach(() => localStorage.clear());

describe("loadPrefs", () => {
  it("何も無ければ既定値を返す", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("保存した値を読み戻す", () => {
    savePrefs({ query: "rating:5", dirs: [1, 2] });
    const p = loadPrefs();
    expect(p.query).toBe("rating:5");
    expect(p.dirs).toEqual([1, 2]);
    expect(p.sort).toBe(DEFAULT_PREFS.sort);
  });

  it("dirs の null と空配列を区別して保存できる", () => {
    savePrefs({ dirs: [] });
    expect(loadPrefs().dirs).toEqual([]);
    savePrefs({ dirs: null });
    expect(loadPrefs().dirs).toBeNull();
  });

  it("壊れた JSON があっても既定値へ落ちる", () => {
    localStorage.setItem("gim.web.prefs", "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("知らないキーが混ざっていても既定値で補う", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ query: "x", bogus: 1 }));
    const p = loadPrefs();
    expect(p.query).toBe("x");
    expect(p.history).toEqual([]);
  });
});
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/storage.test.ts`
Expected: FAIL。`./storage` が存在しない

- [ ] **Step 7: localStorage 層を実装する**

`web/src/storage.ts`:

```ts
import type { SortKey, SortDir } from "@gim/shared/types";

export interface Prefs {
  query: string;
  sort: SortKey;
  dir: SortDir;
  /** null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。 */
  dirs: number[] | null;
  history: string[];
}

export const DEFAULT_PREFS: Prefs = {
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  history: [],
};

export const HISTORY_MAX = 50;

const KEY = "gim.web.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // 既定値で補うので、保存形式が増えても古い保存内容で壊れない。
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // プライベートブラウジング等で書けなくても、閲覧そのものは続けられるべき。
  }
}
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `npx vitest run packages/shared/src/history.test.ts web/src/storage.test.ts && npm test`
Expected: PASS。全体も緑

- [ ] **Step 9: コミット**

```bash
git add packages/shared/src/history.ts packages/shared/src/history.test.ts web/src/storage.ts web/src/storage.test.ts
git commit -m "$(cat <<'EOF'
feat(web): クエリ履歴の純粋関数とlocalStorage層を追加

履歴の規則は Rust の db::history::record に揃える（空は無視・
重複は先頭へ昇格・上限超過は古いものから）。上限は50件。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 一覧画面（仮想スクロールと無限スクロール）

**Files:**
- Create: `web/src/store/useQueryStore.ts`, `web/src/store/useQueryStore.test.ts`, `web/src/components/ImageGrid.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 4 の API クライアント、Task 5 の `storage`
- Produces:
  - `useQueryStore`: 状態 `{ query, sort, dir, dirs, results, total, loading, exhausted, error }`、アクション `{ setQuery, setSort, setDirs, runQuery, loadMore, init }`
  - `<ImageGrid />`

### 決定事項

- 1ページ **200件**。`loadMore` は `offset = results.length` で次を取る
- 総件数は `/api/images/count` で別に取る（表示と、`exhausted` の判定に使う）
- `runQuery` は結果を総入れ替えし、`loadMore` は末尾に足す
- **セルは正方形にしない。** サムネイルは既に正方形（デスクトップ版が中央クロップで生成）なので、グリッドは正方形セルでよい。`width`/`height` はビューア（計画4）で使う
- 列数は幅から計算する（デスクトップ版と同じ式）。スマホ縦は2〜3列、横やタブレットで増える

- [ ] **Step 1: ストアの失敗するテストを書く**

`web/src/store/useQueryStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    filename: `f${from + i}.png`,
    width: 512,
    height: 768,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  localStorage.clear();
  useQueryStore.setState({
    query: "",
    sort: "created",
    dir: "desc",
    dirs: null,
    results: [],
    total: 0,
    loading: false,
    exhausted: false,
    error: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("runQuery", () => {
  it("結果を総入れ替えし、件数を取る", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue(rows(1, 3));
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 3 });

    useQueryStore.setState({ results: rows(100, 5) });
    await useQueryStore.getState().runQuery();

    const s = useQueryStore.getState();
    expect(s.results.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(s.total).toBe(3);
    expect(s.exhausted).toBe(true);
  });

  it("失敗したら error に入れ、結果は空にする", async () => {
    vi.spyOn(imagesApi, "listImages").mockRejectedValue(new Error("boom"));
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().error).toContain("boom");
    expect(useQueryStore.getState().results).toEqual([]);
  });
});

describe("loadMore", () => {
  it("末尾に足し、offset は現在の件数", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue(rows(201, 2));
    useQueryStore.setState({ results: rows(1, 200), total: 202 });

    await useQueryStore.getState().loadMore();

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ offset: 200 }));
    expect(useQueryStore.getState().results).toHaveLength(202);
    expect(useQueryStore.getState().exhausted).toBe(true);
  });

  it("すべて読み終えていたら何もしない", async () => {
    const spy = vi.spyOn(imagesApi, "listImages");
    useQueryStore.setState({ results: rows(1, 3), total: 3, exhausted: true });

    await useQueryStore.getState().loadMore();
    expect(spy).not.toHaveBeenCalled();
  });

  it("読み込み中は重ねて呼ばない", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    useQueryStore.setState({ results: rows(1, 200), total: 400, loading: true });

    await useQueryStore.getState().loadMore();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("setQuery / setSort / setDirs", () => {
  it("localStorage へ保存する", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.getState().setQuery("rating:5");
    await useQueryStore.getState().setSort("filename", "asc");
    await useQueryStore.getState().setDirs([2]);

    const saved = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(saved.query).toBe("rating:5");
    expect(saved.sort).toBe("filename");
    expect(saved.dirs).toEqual([2]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts`
Expected: FAIL。`./useQueryStore` が存在しない

- [ ] **Step 3: ストアを実装する**

`web/src/store/useQueryStore.ts`:

```ts
import { create } from "zustand";
import type { SortKey, SortDir } from "@gim/shared/types";
import * as imagesApi from "../api/images";
import type { ImageDto } from "../api/images";
import { loadPrefs, savePrefs } from "../storage";

export const PAGE_SIZE = 200;

interface QueryState {
  query: string;
  sort: SortKey;
  dir: SortDir;
  dirs: number[] | null;
  results: ImageDto[];
  total: number;
  loading: boolean;
  exhausted: boolean;
  error: string | null;

  init: () => Promise<void>;
  setQuery: (q: string) => void;
  setSort: (sort: SortKey, dir: SortDir) => Promise<void>;
  setDirs: (dirs: number[] | null) => Promise<void>;
  runQuery: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  results: [],
  total: 0,
  loading: false,
  exhausted: false,
  error: null,

  init: async () => {
    const p = loadPrefs();
    set({ query: p.query, sort: p.sort, dir: p.dir, dirs: p.dirs });
    await get().runQuery();
  },

  setQuery: (q) => set({ query: q }),

  setSort: async (sort, dir) => {
    set({ sort, dir });
    savePrefs({ sort, dir });
    await get().runQuery();
  },

  setDirs: async (dirs) => {
    set({ dirs });
    savePrefs({ dirs });
    await get().runQuery();
  },

  runQuery: async () => {
    const { query, sort, dir, dirs } = get();
    set({ loading: true, error: null });
    const params = { q: query, sort, dir, dirs };
    try {
      const [rows, count] = await Promise.all([
        imagesApi.listImages({ ...params, limit: PAGE_SIZE, offset: 0 }),
        imagesApi.countImages(params),
      ]);
      set({
        results: rows,
        total: count.total,
        exhausted: rows.length >= count.total,
        loading: false,
      });
      savePrefs({ query });
    } catch (e) {
      set({
        results: [],
        total: 0,
        exhausted: true,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  loadMore: async () => {
    const { loading, exhausted, results, query, sort, dir, dirs, total } = get();
    if (loading || exhausted) return;
    set({ loading: true });
    try {
      const rows = await imagesApi.listImages({
        q: query,
        sort,
        dir,
        dirs,
        limit: PAGE_SIZE,
        offset: results.length,
      });
      const next = [...results, ...rows];
      set({
        results: next,
        exhausted: rows.length === 0 || next.length >= total,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: グリッドを書く**

`web/src/components/ImageGrid.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryStore } from "../store/useQueryStore";
import { thumbUrl } from "../api/images";

const MIN_CELL = 110;
const GAP = 4;

export function ImageGrid() {
  const results = useQueryStore((s) => s.results);
  const loadMore = useQueryStore((s) => s.loadMore);
  const exhausted = useQueryStore((s) => s.exhausted);
  const error = useQueryStore((s) => s.error);

  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
  const cell = columns > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL;
  const rowCount = Math.ceil(results.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cell + GAP,
    overscan: 4,
  });

  // 末尾付近まで来たら次のページを取る。
  const items = rowVirtualizer.getVirtualItems();
  const lastRow = items.length > 0 ? items[items.length - 1].index : 0;
  useEffect(() => {
    if (!exhausted && rowCount > 0 && lastRow >= rowCount - 3) {
      void loadMore();
    }
  }, [lastRow, rowCount, exhausted, loadMore]);

  if (error) {
    return <p style={{ padding: 16, color: "var(--text-dim)" }}>読み込みに失敗しました: {error}</p>;
  }

  return (
    <div
      ref={parentRef}
      style={{
        flex: 1,
        overflowY: "auto",
        background: "var(--bg-media)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vrow) => {
          const start = vrow.index * columns;
          const rowItems = results.slice(start, start + columns);
          return (
            <div
              key={vrow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vrow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowItems.map((img) => (
                <img
                  key={img.id}
                  src={thumbUrl(img.id)}
                  alt={img.filename}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    display: "block",
                    background: "var(--surface)",
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `App.tsx` に組み込む**

```tsx
import { useEffect } from "react";
import { useQueryStore } from "./store/useQueryStore";
import { ImageGrid } from "./components/ImageGrid";

export function App() {
  const init = useQueryStore((s) => s.init);
  const total = useQueryStore((s) => s.total);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: `env(safe-area-inset-top) 12px 8px`,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{total} 枚</span>
      </header>
      <ImageGrid />
    </div>
  );
}
```

- [ ] **Step 7: テストと型チェックを実行する**

Run: `npm test && pnpm -C web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 8: 実ライブラリで一覧を確認する**

サーバと dev server を立て、**PC のブラウザとスマホの両方で** `http://<LAN IP>:5181/` を開く。

Expected: サムネイルが並び、スクロールすると次のページが読み込まれる。件数が実ライブラリの数（16,892 前後）と一致する。スマホで指スクロールが引っかからない

**この確認は目視が要ります。実行して確認できない場合はその旨をレポートに書いてください**（コントローラが行います）。

- [ ] **Step 9: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): 仮想スクロールの画像一覧と無限スクロールを追加

200件ずつ取得し、末尾付近で次ページを読む。列数は幅から算出する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: フィルタバーと履歴

**Files:**
- Create: `web/src/components/FilterBar.tsx`, `web/src/components/HistoryList.tsx`, `web/src/components/FilterBar.test.tsx`
- Modify: `web/src/App.tsx`, `web/src/store/useQueryStore.ts`（履歴の記録）

**Interfaces:**
- Consumes: Task 5・6
- Produces:
  - `useQueryStore` に `history: string[]` と `commitQuery(): Promise<void>`（クエリを確定して履歴へ記録し、検索する）
  - `<FilterBar />`（クエリ入力・件数・ソート切替・「絞り込み」ボタン）
  - `<HistoryList />`（前方一致で絞った履歴、上下キーで選択）

### 決定事項

- 履歴は**入力欄にフォーカスしたときに開く**。入力中は `matchHistory` で絞り込む
- 履歴の項目をタップしたら、その文字列を入力欄に入れて即検索する
- PC ではキーボードでも操作できるようにする（`historyNav` を使う。↓↑ で選択、Enter で確定、Esc で閉じる）
- 検索の確定は Enter またはソフトキーボードの「検索」。**入力のたびには検索しない**（17,000件のライブラリで打鍵ごとにクエリを投げない）

- [ ] **Step 1: ストアに履歴を足す（テスト先行）**

`web/src/store/useQueryStore.test.ts` に追加する。

```ts
describe("commitQuery", () => {
  it("履歴へ記録して検索する", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.setState({ query: "rating:5", history: [] });
    await useQueryStore.getState().commitQuery();

    expect(useQueryStore.getState().history).toEqual(["rating:5"]);
    expect(JSON.parse(localStorage.getItem("gim.web.prefs")!).history).toEqual(["rating:5"]);
  });

  it("空のクエリは履歴に残さないが検索はする", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.setState({ query: "  ", history: ["a"] });
    await useQueryStore.getState().commitQuery();

    expect(useQueryStore.getState().history).toEqual(["a"]);
    expect(spy).toHaveBeenCalled();
  });
});
```

`beforeEach` の `setState` に `history: []` を足すこと。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts`
Expected: FAIL。`commitQuery` が存在しない

- [ ] **Step 3: ストアを拡張する**

`useQueryStore.ts` に追加する。`init` で `loadPrefs().history` を読み込むこと。

```ts
import { recordHistory } from "@gim/shared/history";
import { HISTORY_MAX } from "../storage";

// state に history: string[] を足し、init で p.history を読む。

  commitQuery: async () => {
    const { query, history } = get();
    const next = recordHistory(history, query, HISTORY_MAX);
    set({ history: next });
    savePrefs({ history: next });
    await get().runQuery();
  },
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: `HistoryList` を書く**

`web/src/components/HistoryList.tsx`:

候補の算出は `historyNav` が持つので、このコンポーネントは受け取った配列を描くだけにします。

```tsx
interface Props {
  items: string[];
  selected: number;
  onPick: (q: string) => void;
}

export function HistoryList({ items, selected, onPick }: Props) {
  if (items.length === 0) return null;

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: "50vh",
        overflowY: "auto",
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {items.map((h, i) => (
        <li key={h}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(h)}
            style={{
              display: "block",
              width: "100%",
              minHeight: "var(--tap)",
              textAlign: "left",
              padding: "0 12px",
              border: "none",
              background: i === selected ? "var(--accent)" : "transparent",
              color: "var(--text)",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            {h}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

`onMouseDown` で `preventDefault` するのは、入力欄の blur が click より先に走って一覧が閉じてしまうのを防ぐためです。

- [ ] **Step 6: `FilterBar` を書く**

`web/src/components/FilterBar.tsx`:

```tsx
import { useState } from "react";
import { historyNav } from "@gim/shared/historyNav";
import { matchHistory } from "@gim/shared/historyMatch";
import { useQueryStore } from "../store/useQueryStore";
import { HistoryList } from "./HistoryList";

interface Props {
  onOpenFilter: () => void;
  onOpenDirectories: () => void;
}

/** historyNav が持ち回る状態。候補の算出も historyNav 側の責務。 */
interface NavState {
  open: boolean;
  index: number;
  items: string[];
  draft: string;
}

const CLOSED: NavState = { open: false, index: -1, items: [], draft: "" };

export function FilterBar({ onOpenFilter, onOpenDirectories }: Props) {
  const { query, setQuery, commitQuery, history, total, sort, dir, setSort } = useQueryStore();
  const [nav, setNav] = useState<NavState>(CLOSED);

  const candidates = (q: string) => (q.trim() === "" ? history : matchHistory(q, history));

  const pick = (q: string) => {
    setQuery(q);
    setNav(CLOSED);
    void commitQuery();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setNav(CLOSED);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const res = historyNav({
        key: e.key,
        open: nav.open,
        index: nav.index,
        items: nav.items,
        query,
        draft: nav.draft,
        history,
      });
      setNav({ open: res.open, index: res.index, items: res.items, draft: res.draft });
      setQuery(res.query);
      return;
    }
    if (e.key === "Enter") {
      setNav(CLOSED);
      void commitQuery();
    }
  };

  return (
    <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", alignItems: "center" }}>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={query}
          placeholder="検索"
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setNav({ open: true, index: -1, items: candidates(v), draft: v });
          }}
          onFocus={() => setNav({ open: true, index: -1, items: candidates(query), draft: query })}
          onBlur={() => setNav(CLOSED)}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            minHeight: "var(--tap)",
            padding: "0 12px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            font: "inherit",
          }}
        />
        <button type="button" onClick={onOpenFilter} style={barButton}>
          絞り込み
        </button>
        <button type="button" onClick={onOpenDirectories} style={barButton}>
          場所
        </button>
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "0 12px 8px",
          alignItems: "center",
          fontSize: 13,
          color: "var(--text-dim)",
        }}
      >
        <span>{total} 枚</span>
        <select
          value={`${sort}:${dir}`}
          onChange={(e) => {
            const [s, d] = e.target.value.split(":");
            void setSort(s as never, d as never);
          }}
          style={{
            minHeight: "var(--tap)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            font: "inherit",
          }}
        >
          <option value="created:desc">新しい順</option>
          <option value="created:asc">古い順</option>
          <option value="filename:asc">名前 昇順</option>
          <option value="filename:desc">名前 降順</option>
          <option value="modified:desc">更新が新しい順</option>
        </select>
      </div>
      {nav.open && <HistoryList items={nav.items} selected={nav.index} onPick={pick} />}
    </div>
  );
}

const barButton: React.CSSProperties = {
  minHeight: "var(--tap)",
  minWidth: "var(--tap)",
  padding: "0 12px",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};
```

`historyNav` は `NavInput { key, open, index, items, query, draft, history }` を取り `NavResult { open, index, items, query, draft }` を返します（`packages/shared/src/historyNav.ts` で確認済み）。候補の算出・開閉・`draft` の保持と復元はすべて `historyNav` の責務なので、コンポーネント側で再実装しないこと。

- [ ] **Step 7: コンポーネントのテストを書く**

`web/src/components/FilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ query: "", history: ["rating:5", "forest"], total: 42 });
});

afterEach(() => vi.restoreAllMocks());

describe("FilterBar", () => {
  it("件数を表示する", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    expect(screen.getByText("42 枚")).toBeTruthy();
  });

  it("フォーカスで履歴が開き、入力で絞り込まれる", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");

    fireEvent.focus(input);
    expect(screen.getByText("rating:5")).toBeTruthy();
    expect(screen.getByText("forest")).toBeTruthy();

    fireEvent.change(input, { target: { value: "for" } });
    expect(screen.queryByText("rating:5")).toBeNull();
    expect(screen.getByText("forest")).toBeTruthy();
  });

  it("履歴をタップすると検索が走る", async () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText("検索"));
    fireEvent.click(screen.getByText("forest"));

    expect(useQueryStore.getState().query).toBe("forest");
    await vi.waitFor(() => expect(imagesApi.listImages).toHaveBeenCalled());
  });

  it("入力しただけでは検索しない", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("検索"), { target: { value: "x" } });
    expect(imagesApi.listImages).not.toHaveBeenCalled();
  });

  it("絞り込みボタンでコールバックが呼ばれる", () => {
    const onOpenFilter = vi.fn();
    render(<FilterBar onOpenFilter={onOpenFilter} onOpenDirectories={() => {}} />);
    fireEvent.click(screen.getByText("絞り込み"));
    expect(onOpenFilter).toHaveBeenCalled();
  });
});
```

`web/package.json` の `devDependencies` に `@testing-library/react` と `@testing-library/jest-dom` を足す必要があるか確認してください（ルートに既にあるので、pnpm の hoisting によっては不要かもしれません。必要なら足す）。

- [ ] **Step 8: `App.tsx` に組み込む**

シートは Task 8・9 で作るので、この時点ではコールバックを空のままにせず、`useState` で開閉フラグだけ持たせて「まだありません」と出す簡易な内容にしてよい。Task 8・9 で差し替えます。

- [ ] **Step 9: テストと型チェックを実行する**

Run: `npm test && pnpm -C web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 10: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): クエリ入力欄と履歴ドロップダウンを追加

入力のたびには検索せず、Enter か履歴の選択で確定する。
履歴は前方一致で絞り込み、PCでは上下キーでも選べる。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: フィルタシート

**Files:**
- Create: `web/src/components/Sheet.tsx`, `web/src/components/FilterSheet.tsx`, `web/src/components/FilterSheet.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 7
- Produces:
  - `<Sheet open onClose title>{children}</Sheet>`（ボトムシートの器）
  - `<FilterSheet open onClose />`

### 決定事項

**シートは独自の状態を持たない。** 現在のクエリ文字列を `@gim/shared` の関数で読み取ってフォームの初期値にし、変更のたびにクエリ文字列へ書き戻します。クエリ文字列が唯一の正です。

これにより、シートで作った条件を手で直せますし、履歴にもデスクトップ版と同じ表現で残ります。

扱う項目（`upsertField` / `extractField` で1フィールドずつ操作する）:

| 項目 | フィールド | 使う共有関数 |
|---|---|---|
| プロンプト | `prompt` | `promptFieldToInput` / `applyPromptField` |
| レーティング | `rating` | `parseRatingToken` / `buildRatingToken` / `RATING_VALUES` |
| 幅 | `width` | `extractField` / `upsertField` |
| 高さ | `height` | 同上 |
| モデル | `model` | 同上 |
| 生成ツール | `tool` | 同上 |
| 作成日（以降） | `created` | 同上 |

フィールド名は `crates/core/src/query/parse.rs` で確認済みです（`prompt` / `negative` / `model` / `filename` / `sampler` / `tool` / `rating` / `width` / `height` / `pixels` / `steps` / `seed` / `created` / `modified`）。

プロンプトだけ扱いが違います。`applyPromptField(query, "prompt", input)` は入力を正の語と除外語（`-` 始まり）に分けて適切なトークンへ展開し、`promptFieldToInput(query, "prompt")` が逆変換します。`upsertField` で素朴に入れないこと。

- [ ] **Step 1: `Sheet` を書く**

`web/src/components/Sheet.tsx`:

```tsx
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, onClose, children }: Props) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 10,
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--surface)",
          borderRadius: "12px 12px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "var(--surface)",
          }}
        >
          <strong>{title}</strong>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: "var(--tap)",
              minWidth: "var(--tap)",
              background: "none",
              border: "none",
              color: "var(--text)",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: フィルタシートの失敗するテストを書く**

`web/src/components/FilterSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterSheet } from "./FilterSheet";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ query: "" });
});

afterEach(() => vi.restoreAllMocks());

describe("FilterSheet", () => {
  it("レーティングを選ぶとクエリ文字列に反映される", () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("レーティング 5"));
    expect(useQueryStore.getState().query).toContain("rating:5");
  });

  it("既存のクエリからフォームの初期値を復元する", () => {
    useQueryStore.setState({ query: "rating:3,5 width:>=1024" });
    render(<FilterSheet open onClose={() => {}} />);

    expect((screen.getByLabelText("レーティング 3") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("レーティング 5") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("レーティング 1") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe(">=1024");
  });

  it("フリーワード部分を壊さない", () => {
    useQueryStore.setState({ query: "forest cabin" });
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: ">=512" } });

    const q = useQueryStore.getState().query;
    expect(q).toContain("forest");
    expect(q).toContain("cabin");
    expect(q).toContain("width:>=512");
  });

  it("値を空にするとフィールドが消える", () => {
    useQueryStore.setState({ query: "width:>=1024" });
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: "" } });
    expect(useQueryStore.getState().query).not.toContain("width:");
  });

  it("適用で検索が走る", async () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByText("適用"));
    await vi.waitFor(() => expect(imagesApi.listImages).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/FilterSheet.test.tsx`
Expected: FAIL。`./FilterSheet` が存在しない

- [ ] **Step 4: フィルタシートを実装する**

`web/src/components/FilterSheet.tsx`:

```tsx
import { extractField, upsertField } from "@gim/shared/queryTokens";
import { applyPromptField, promptFieldToInput } from "@gim/shared/promptQuery";
import {
  RATING_VALUES,
  buildRatingToken,
  parseRatingToken,
  type RatingValue,
} from "@gim/shared/ratingFilter";
import { useQueryStore } from "../store/useQueryStore";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 構造化フィールドだけを消す。フリーワードは残す。 */
const STRUCTURED = ["rating", "width", "height", "model", "tool", "created"] as const;

export function FilterSheet({ open, onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const commitQuery = useQueryStore((s) => s.commitQuery);

  // シートは状態を持たない。クエリ文字列が唯一の正で、毎回そこから読む。
  const ratings = parseRatingToken(extractField(query, "rating"));

  const setField = (field: string, value: string) =>
    setQuery(upsertField(query, field, value.trim() === "" ? null : value.trim()));

  const toggleRating = (v: RatingValue) => {
    const next = new Set(ratings);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setQuery(upsertField(query, "rating", buildRatingToken(next)));
  };

  const clearStructured = () =>
    setQuery(STRUCTURED.reduce((q, f) => upsertField(q, f, null), query));

  const apply = () => {
    onClose();
    void commitQuery();
  };

  return (
    <Sheet open={open} title="絞り込み" onClose={onClose}>
      <Field label="プロンプト">
        <input
          aria-label="プロンプト"
          type="text"
          value={promptFieldToInput(query, "prompt")}
          placeholder="forest -blurry"
          onChange={(e) => setQuery(applyPromptField(query, "prompt", e.target.value))}
          style={inputStyle}
        />
      </Field>

      <Field label="レーティング">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {RATING_VALUES.map((v) => {
            const label = v === "none" ? "レーティング なし" : `レーティング ${v}`;
            return (
              <label key={String(v)} style={chipStyle(ratings.has(v))}>
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={ratings.has(v)}
                  onChange={() => toggleRating(v)}
                  style={{ marginRight: 6 }}
                />
                {v === "none" ? "なし" : v}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="幅">
        <input
          aria-label="幅"
          type="text"
          inputMode="text"
          value={extractField(query, "width") ?? ""}
          placeholder=">=1024"
          onChange={(e) => setField("width", e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="高さ">
        <input
          aria-label="高さ"
          type="text"
          value={extractField(query, "height") ?? ""}
          placeholder=">=1024"
          onChange={(e) => setField("height", e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="モデル">
        <input
          aria-label="モデル"
          type="text"
          value={extractField(query, "model") ?? ""}
          onChange={(e) => setField("model", e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="生成ツール">
        <input
          aria-label="生成ツール"
          type="text"
          value={extractField(query, "tool") ?? ""}
          placeholder="a1111"
          onChange={(e) => setField("tool", e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="作成日（以降）">
        <input
          aria-label="作成日"
          type="date"
          value={(extractField(query, "created") ?? "").replace(/^>=/, "")}
          onChange={(e) =>
            setField("created", e.target.value === "" ? "" : `>=${e.target.value}`)
          }
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button type="button" onClick={clearStructured} style={{ ...buttonStyle, flex: 1 }}>
          クリア
        </button>
        <button
          type="button"
          onClick={apply}
          style={{ ...buttonStyle, flex: 2, background: "var(--accent)" }}
        >
          適用
        </button>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "var(--tap)",
  padding: "0 12px",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  minHeight: "var(--tap)",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--tap)",
    padding: "0 12px",
    background: active ? "var(--accent)" : "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
  };
}
```

**`created` の扱いに注意。** 検索DSL は `created:>=2026-01-01` のような比較演算子付きを受け付けます。`<input type="date">` の値は `YYYY-MM-DD` なので、書き込むときは `>=` を付け、読むときは剥がします。`extractField` が返す値に `>=` 以外の演算子が入っていた場合、`type="date"` の入力欄は空になります（不正な値を表示できないため）。手で書いた複雑な条件をシートが壊さないよう、**この入力欄の変更時以外は `created` に触れないこと**。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/FilterSheet.test.tsx`
Expected: PASS（5件）

- [ ] **Step 6: `App.tsx` に組み込む**

`FilterBar` の `onOpenFilter` で開くようにする。

- [ ] **Step 7: テストと型チェックを実行する**

Run: `npm test && pnpm -C web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 8: 実ライブラリで動作を確認する**

サーバと dev server を立て、ブラウザでシートを開き、レーティングと幅を指定して「適用」する。

Expected: クエリ入力欄に `rating:5 width:>=1024` のような文字列が入り、件数が減る。手で文字列を編集してもシートを開き直すとフォームに反映される

- [ ] **Step 9: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): GUIフォームの絞り込みシートを追加

シートは独自の状態を持たず、クエリ文字列を唯一の正として読み書きする。
手で編集した文字列とフォームが常に一致する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: ディレクトリシート

**Files:**
- Create: `web/src/components/DirectorySheet.tsx`, `web/src/components/DirectorySheet.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 8 の `Sheet`、Task 4 の `listDirectories`
- Produces: `<DirectorySheet open onClose />`

### 決定事項

- 初期状態は `dirs = null`（未指定）。このとき**サーバの `visible = 1` に従う**ので、シートを開いた時点では `visible` が true のディレクトリにチェックが入っているように見せる
- ユーザが1つでも操作したら `dirs` は配列になる（`null` へは戻さない）。「すべて選択」で全 ID の配列、「すべて解除」で空配列
- **空配列は 0 件**という意味であり、「未指定」とは違う。空配列のときは一覧が空になるのが正しい挙動
- `image_count` を各行に出す。`is_online` が false のディレクトリは薄く表示し、注記を付ける（デスクトップ版が最後にスキャンした時点の状態であり、サーバは到達性を判定していない）

- [ ] **Step 1: 失敗するテストを書く**

`web/src/components/DirectorySheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DirectorySheet } from "./DirectorySheet";
import { useQueryStore } from "../store/useQueryStore";
import * as dirsApi from "../api/directories";
import * as imagesApi from "../api/images";

const DIRS = [
  { id: 1, label: "A1111", is_online: true, visible: true, image_count: 100 },
  { id: 2, label: "ComfyUI", is_online: true, visible: false, image_count: 208 },
  { id: 3, label: "外付け", is_online: false, visible: true, image_count: 5 },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(dirsApi, "listDirectories").mockResolvedValue(DIRS);
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ dirs: null });
});

afterEach(() => vi.restoreAllMocks());

describe("DirectorySheet", () => {
  it("ラベルと枚数を出す", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(await screen.findByText("A1111")).toBeTruthy();
    expect(screen.getByText("208 枚")).toBeTruthy();
  });

  it("未指定のときは visible のものにチェックが入る", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(((await screen.findByLabelText("A1111")) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("ComfyUI") as HTMLInputElement).checked).toBe(false);
  });

  it("チェックを変えると dirs が配列になる", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText("ComfyUI"));
    expect(useQueryStore.getState().dirs).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("すべて解除すると空配列になる（未指定には戻らない）", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByText("すべて解除"));
    expect(useQueryStore.getState().dirs).toEqual([]);
  });

  it("オフラインのディレクトリに注記を出す", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(await screen.findByText(/オフライン/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/DirectorySheet.test.tsx`
Expected: FAIL。`./DirectorySheet` が存在しない

- [ ] **Step 3: 実装する**

`web/src/components/DirectorySheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listDirectories, type DirectoryDto } from "../api/directories";
import { useQueryStore } from "../store/useQueryStore";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DirectorySheet({ open, onClose }: Props) {
  const dirs = useQueryStore((s) => s.dirs);
  const setDirs = useQueryStore((s) => s.setDirs);
  const [all, setAll] = useState<DirectoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listDirectories()
      .then(setAll)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);

  // dirs が null（未指定）のときはサーバの visible に従うので、その見え方を再現する。
  const selectedIds = dirs ?? all.filter((d) => d.visible).map((d) => d.id);
  const isChecked = (id: number) => selectedIds.includes(id);

  const toggle = (id: number) => {
    const next = isChecked(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    void setDirs(next);
  };

  return (
    <Sheet open={open} title="表示する場所" onClose={onClose}>
      {error && <p style={{ color: "var(--text-dim)" }}>読み込みに失敗しました: {error}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => void setDirs(all.map((d) => d.id))}
          style={{ ...buttonStyle, flex: 1 }}
        >
          すべて選択
        </button>
        <button type="button" onClick={() => void setDirs([])} style={{ ...buttonStyle, flex: 1 }}>
          すべて解除
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {all.map((d) => (
          <li key={d.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: "var(--tap)",
                cursor: "pointer",
                opacity: d.is_online ? 1 : 0.5,
              }}
            >
              <input
                aria-label={d.label}
                type="checkbox"
                checked={isChecked(d.id)}
                onChange={() => toggle(d.id)}
              />
              <span style={{ flex: 1 }}>
                {d.label}
                {!d.is_online && (
                  <span style={{ color: "var(--text-dim)", fontSize: 12, marginLeft: 8 }}>
                    オフライン（最後のスキャン時点）
                  </span>
                )}
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{d.image_count} 枚</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const buttonStyle: React.CSSProperties = {
  minHeight: "var(--tap)",
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  cursor: "pointer",
};
```

`is_online` はデスクトップ版が最後にスキャンした時点の DB 上の値です。サーバは到達性を判定していないので、注記でそのことを示します。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/DirectorySheet.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: `App.tsx` に組み込む**

`FilterBar` の `onOpenDirectories` で開くようにする。

- [ ] **Step 6: 全テストと型チェックを実行する**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit && cargo test --workspace`
Expected: すべて PASS

- [ ] **Step 7: 実ライブラリで動作を確認する**

Expected: ディレクトリ一覧が出て、チェックを外すと件数が減る。すべて解除すると 0 枚になる（未指定に戻らない）

- [ ] **Step 8: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): ディレクトリ選択シートを追加

未指定のときはサーバの表示設定に従い、操作すると明示的な集合になる。
すべて解除は0件を意味し、未指定には戻らない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- `cargo test --workspace` が緑（src-tauri 64 + gim-core 135 + gim-server 43前後）
- `npm test` が緑（既存270件 + web/shared の新規テスト）
- `npx tsc --noEmit` と `pnpm -C web exec tsc --noEmit` が緑
- `cargo clippy -p gim-server --all-targets` が警告ゼロ
- `/api/images` と `/api/directories` の応答に `/Users/` を含む文字列が現れない
- サーバのエラー応答がすべて `{"error": ...}` の JSON
- サーバのログに1リクエスト1行が出る
- **スマホの実機で** `http://<LAN IP>:5181/` を開き、一覧が見え、スクロールで次ページが読み込まれ、クエリと GUI フォームで絞り込め、ディレクトリを選べる
- デスクトップ版（`npm run tauri dev`）が従来通り動く

## 計画4への申し送り

- ビューア（全画面・スワイプ送り・ピンチズーム・タップで UI 切替）とスライドショー
- `rust-embed` による `web/dist` の埋め込みと `build.rs` での存在確認
- `docs/*.html` のユーザ向けドキュメント（`docs/CLAUDE.md` のトーン規約に従う）と `docs/index.html` のカード追加、README / CLAUDE.md の更新。**計画2でドキュメント更新が漏れたので、計画4では独立したタスクとして置くこと**
- ビューアが使う `w` は `min(長辺の表示サイズ × devicePixelRatio, 2560)` から選ぶ。**サーバの `w` は幅ではなく長辺の上限**である点に注意
- スライドショーの再生順序は `/api/images/ids` で ID 配列だけ取る。順序生成は `@gim/shared/playlist` の `buildOrder` / `step` を使う
- 先読みは `new Image()` で次の2枚。同一画像への同時リクエストはサーバ側で single-flight されていないので、重複を避ける制御はクライアント側に置く
- `tsconfig` の project references 化（`web/` が増えて単一 tsconfig では管理しきれなくなったら）
