# web ビューア 計画2: axum サーバ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `library.db` を読み取り専用で参照し、画像の検索結果・サムネイル・リサイズ済み画像を LAN 内のブラウザへ返す HTTP サーバ `gim-server` を作る。

**Architecture:** `crates/server` に axum 0.8 のバイナリクレートを新設し、計画1で切り出した `gim-core` の検索DSLと SQL 生成をそのまま使う。DB 接続はプールせずリクエストごとに開いて閉じる。書き込み系エンドポイントは存在しない。画像は原寸配信とリサイズ配信の2経路を持ち、リサイズ結果は内容由来のキーでディスクにキャッシュする。

**Tech Stack:** Rust 2021 / axum 0.8 / tokio 1 / rusqlite 0.32 / image 0.25 / webp 0.3 / clap 4

**Spec:** `docs/superpowers/specs/2026-08-16-web-viewer-design.md`

## Global Constraints

- **`library.db` に一切書き込まない。** 接続は `OpenFlags::SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON` で開く。`immutable=1` は使わない（デスクトップ版が同時に書き込むため）
- **マイグレーションはサーバから実行しない。** 起動時に `PRAGMA user_version` を検証し、期待値と違えば明示的なメッセージを出して終了する
- SQL の列名は許可リストの `&'static str` のみを埋め込み、値は必ずバインドパラメータで渡す
- `crates/server` の `version` は `"0.0.0"` 固定。`npm run bump` の対象に含めない
- `db/migrations.rs` の `MIGRATIONS` 配列は追記のみ・並び替え禁止。この計画では一切変更しない
- **`gim_core::db::open()` の既存の振る舞いを変えない。** 読み取り専用オープンは別関数として追加する（既存 `open()` はマイグレーションを実行するのでデスクトップ版が依存している）
- **`cargo fmt` をリポジトリ全体に適用しない。** `src-tauri` と `crates/core` は rustfmt 未整形。`crates/server` は新規なので `cargo fmt -p gim-server` に限れば適用してよい
- コードコメントは非自明な WHY のみ。WHAT・変更履歴・タスク ID は書かない
- コミットメッセージは Conventional Commits のプリフィックスを英語、要約と本文を日本語で書く
- パッケージマネージャは pnpm。この計画では Node 側の変更は無い

## この計画のスコープ

含む: HTTP API（JSON）、サムネイル配信、原画像配信、リサイズとディスクキャッシュ、CLI 引数、起動時の LAN アドレス表示。

含まない: web フロント（計画3）、`rust-embed` による単一バイナリ化（計画3。`web/dist` が存在しないと成立しないため）。この計画の完了時点では、`curl` とブラウザの直接アクセスで API と画像配信を検証できる状態になる。

---

## ファイル構成

**新規作成**

| ファイル | 責務 |
|---|---|
| `crates/server/Cargo.toml` | 依存定義 |
| `crates/server/src/main.rs` | 起動。CLI 解析 → 事前検証 → ルータ組み立て → bind → LAN アドレス表示 |
| `crates/server/src/cli.rs` | clap の引数定義と、`--data-dir` の既定値解決 |
| `crates/server/src/state.rs` | `AppState`（各種パス、キャッシュ生成カウンタ）と DB 接続の取得 |
| `crates/server/src/error.rs` | `ApiError` と `IntoResponse` 実装。JSON エラー本文 |
| `crates/server/src/dirscope.rs` | `dirs` クエリ文字列 → `DirScope` の純粋変換 |
| `crates/server/src/routes/mod.rs` | `router()` の組み立てのみ |
| `crates/server/src/routes/health.rs` | `GET /api/health` |
| `crates/server/src/routes/directories.rs` | `GET /api/directories` |
| `crates/server/src/routes/images.rs` | `GET /api/images`・`/api/images/count`・`/api/images/ids` |
| `crates/server/src/routes/media.rs` | `GET /api/thumb/{id}`・`GET /api/image/{id}` |
| `crates/server/src/fileserve.rs` | ファイル読み出しのタイムアウト、ETag、条件付き GET、Content-Type |
| `crates/server/src/resize.rs` | 幅のスナップ、リサイズ、キャッシュキー、キャッシュ書き込みと容量管理 |

**変更（`crates/core`）**

| ファイル | 変更内容 |
|---|---|
| `crates/core/Cargo.toml` | `thiserror` を追加 |
| `crates/core/src/db/migrations.rs` | `pub fn latest_version() -> i64` を追加 |
| `crates/core/src/db/mod.rs` | `pub fn open_read_only(path) -> Result<Connection, OpenError>` と `OpenError` を追加 |
| `crates/core/src/db/image_query.rs` | `pub fn list_ids(...)` を追加 |
| `crates/core/src/db/images.rs` | `pub fn get_media_info(conn, id) -> Option<MediaInfo>` を追加 |

---

## Task 1: 読み取り専用の DB オープンとスキーマ検証

**Files:**
- Modify: `crates/core/Cargo.toml`, `crates/core/src/db/migrations.rs`, `crates/core/src/db/mod.rs`
- Test: 同ファイルのインラインテスト

**Interfaces:**
- Consumes: なし（この計画の最初のタスク）
- Produces:
  - `gim_core::db::migrations::latest_version() -> i64`
  - `gim_core::db::OpenError`（`Sqlite(rusqlite::Error)` / `SchemaMismatch { found: i64, expected: i64 }`）
  - `gim_core::db::open_read_only(path: &Path) -> Result<Connection, OpenError>`

**このタスクが計画全体で最もリスクが高い。** WAL モードのデータベースを読み取り専用で開けるかどうかは実測でしか分からず、開けない場合はサーバの設計（`library.db` を起動時にコピーする方式へ退避）が変わる。Step 4 で失敗したら、そこで止めて報告すること。

- [ ] **Step 1: 失敗するテストを書く**

`crates/core/src/db/migrations.rs` のテストモジュール末尾に追加する。

```rust
    #[test]
    fn latest_version_matches_applied_version() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let applied: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(latest_version(), applied);
        assert!(latest_version() >= 6, "既存マイグレーションは v6 まである");
    }
```

`crates/core/src/db/mod.rs` の末尾に新しいテストモジュールを追加する。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;

    /// WAL のデータベースを作り、接続を閉じてからパスを返す。
    fn wal_db(dir: &std::path::Path) -> std::path::PathBuf {
        let path = dir.join("library.db");
        let conn = open(&path).unwrap();
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal", "テストの前提が崩れている");
        drop(conn);
        path
    }

    #[test]
    fn open_read_only_can_read_a_wal_database() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());

        let conn = open_read_only(&path).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM directories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn open_read_only_rejects_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());

        let conn = open_read_only(&path).unwrap();
        let err = conn.execute("DELETE FROM directories", []).unwrap_err();
        assert!(
            format!("{err}").contains("read") || format!("{err}").contains("readonly"),
            "書き込みが拒否されるべき: {err}"
        );
    }

    #[test]
    fn open_read_only_rejects_mismatched_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());
        {
            let w = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
            w.pragma_update(None, "user_version", 999).unwrap();
        }

        match open_read_only(&path) {
            Err(OpenError::SchemaMismatch { found, expected }) => {
                assert_eq!(found, 999);
                assert_eq!(expected, migrations::latest_version());
            }
            other => panic!("SchemaMismatch を期待した: {other:?}"),
        }
    }

    #[test]
    fn open_read_only_does_not_create_a_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nope.db");
        assert!(open_read_only(&path).is_err());
        assert!(!path.exists(), "読み取り専用オープンがファイルを作ってはいけない");
    }
}
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-core open_read_only`
Expected: コンパイルエラー。`open_read_only` と `OpenError` が存在せず、`tempfile` も未依存

- [ ] **Step 3: 依存を追加する**

`crates/core/Cargo.toml` の `[dependencies]` に追加する。

```toml
thiserror = "1"
```

同ファイルに `[dev-dependencies]` セクションを追加する（`src-tauri` が `tempfile` を使っていない場合は新規依存になる。既に workspace の `Cargo.lock` にあれば解決は速い）。

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 4: `latest_version` を実装する**

`crates/core/src/db/migrations.rs` の `MIGRATIONS` 定義の直後に追加する。

```rust
/// 適用済みなら `PRAGMA user_version` がこの値になる。
pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}
```

- [ ] **Step 5: `open_read_only` を実装する**

`crates/core/src/db/mod.rs` の `open` の直後に追加する。

```rust
#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("スキーマのバージョンが違います (DB: {found}, 期待値: {expected})")]
    SchemaMismatch { found: i64, expected: i64 },
}

/// DBを読み取り専用で開く。マイグレーションは実行せず、スキーマ版が一致しなければ拒否する。
///
/// WAL のデータベースを読み取り専用で開く場合、SQLite は共有メモリインデックス
/// (`-shm`) を必要とするため、DBと同じディレクトリへの書き込み権限は要る。
/// テーブルには書かないが `-wal` / `-shm` は触る、という意味の読み取り専用。
/// `immutable=1` は使わない（デスクトップ版が同時に書き込むと不整合を読むため）。
pub fn open_read_only(path: &Path) -> Result<Connection, OpenError> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )?;
    conn.pragma_update(None, "query_only", "ON")?;

    let found: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let expected = migrations::latest_version();
    if found != expected {
        return Err(OpenError::SchemaMismatch { found, expected });
    }
    Ok(conn)
}
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `cargo test -p gim-core`
Expected: PASS。既存 126 件 + 新規5件 = 131 件

**Step 4 の `open_read_only_can_read_a_wal_database` が失敗した場合は、そこで止めて BLOCKED で報告すること。** エラーメッセージ全文を報告に含める。設計の退避先（起動時に `library.db` をキャッシュディレクトリへコピーして読む）はコントローラが判断する。

- [ ] **Step 7: デスクトップ版が壊れていないことを確認する**

Run: `cargo test --workspace`
Expected: PASS（src-tauri 64 + gim-core 131 = 195）

- [ ] **Step 8: コミット**

```bash
git add crates/core/Cargo.toml crates/core/src/db/mod.rs crates/core/src/db/migrations.rs Cargo.lock
git commit -m "$(cat <<'EOF'
feat(core): 読み取り専用でDBを開く open_read_only を追加

web サーバが library.db に書き込まずに参照するための接続。
マイグレーションは実行せず、スキーマ版が一致しなければ拒否する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `gim-server` クレートの骨組みと `/api/health`

**Files:**
- Create: `crates/server/Cargo.toml`, `crates/server/src/main.rs`, `crates/server/src/cli.rs`, `crates/server/src/state.rs`, `crates/server/src/error.rs`, `crates/server/src/routes/mod.rs`, `crates/server/src/routes/health.rs`

**Interfaces:**
- Consumes: `gim_core::db::open_read_only`（Task 1）
- Produces:
  - `AppState { db_path: PathBuf, thumb_dir: PathBuf, cache_dir: PathBuf, generated: Arc<AtomicU64> }`（`Clone`）
  - `AppState::conn(&self) -> Result<rusqlite::Connection, ApiError>`
  - `ApiError`（`NotFound` / `Unavailable` / `BadRequest(String)` / `Internal(String)`）と `IntoResponse` 実装
  - `routes::router(state: AppState) -> axum::Router`
  - `cli::Args { host, port, data_dir }` と `Args::resolved_data_dir() -> PathBuf`

- [ ] **Step 1: `crates/server/Cargo.toml` を作る**

```toml
[package]
name = "gim-server"
version = "0.0.0"
edition = "2021"

[[bin]]
name = "gim-server"
path = "src/main.rs"

[dependencies]
gim-core = { path = "../core" }
axum = "0.8"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "net", "time", "signal"] }
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
image = "0.25"
webp = "0.3"
thiserror = "1"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
tempfile = "3"
```

- [ ] **Step 2: CLI を書く**

`crates/server/src/cli.rs`:

```rust
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "gim-server", about = "gen-img-manager の LAN 向け web サーバ")]
pub struct Args {
    /// 待受アドレス
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    /// 待受ポート
    #[arg(long, default_value_t = 5180)]
    pub port: u16,

    /// library.db と thumbnails/ を含むディレクトリ
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
}

/// macOS のアプリデータディレクトリ。Tauri の identifier と一致させる必要がある。
const BUNDLE_ID: &str = "com.technonet.genimgmanager";

impl Args {
    pub fn resolved_data_dir(&self) -> Option<PathBuf> {
        if let Some(d) = &self.data_dir {
            return Some(d.clone());
        }
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(BUNDLE_ID),
        )
    }
}
```

- [ ] **Step 3: エラー型を書く**

`crates/server/src/error.rs`:

```rust
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    NotFound,
    /// ファイルには届かないが、消えたとは限らない（オフラインの外部ドライブなど）。
    Unavailable,
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            ApiError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "ファイルに到達できません".to_string(),
            ),
            ApiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        ApiError::Internal(e.to_string())
    }
}
```

- [ ] **Step 4: 状態を書く**

`crates/server/src/state.rs`:

```rust
use crate::error::ApiError;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub thumb_dir: PathBuf,
    pub cache_dir: PathBuf,
    /// リサイズ生成の累計回数。キャッシュ容量の点検頻度を決めるのに使う。
    pub generated: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            db_path: data_dir.join("library.db"),
            thumb_dir: data_dir.join("thumbnails"),
            cache_dir: data_dir.join("web-cache"),
            generated: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 接続はプールせずリクエストごとに開く。デスクトップ版によるスキーマ変更に
    /// 次のリクエストから追随でき、長い読み取りトランザクションで WAL が肥大しない。
    pub fn conn(&self) -> Result<rusqlite::Connection, ApiError> {
        gim_core::db::open_read_only(&self.db_path)
            .map_err(|e| ApiError::Internal(format!("DBを開けません: {e}")))
    }
}
```

- [ ] **Step 5: `/api/health` の失敗するテストを書く**

`crates/server/src/routes/health.rs`:

```rust
use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct Health {
    pub schema_version: i64,
    pub image_count: i64,
}

pub async fn health(State(state): State<AppState>) -> Result<Json<Health>, ApiError> {
    let conn = state.conn()?;
    let schema_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let image_count: i64 =
        conn.query_row("SELECT count(*) FROM images WHERE missing = 0", [], |r| r.get(0))?;
    Ok(Json(Health { schema_version, image_count }))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_json, test_state};

    #[tokio::test]
    async fn health_reports_schema_version_and_image_count() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/health").await;
        assert_eq!(body["schema_version"], gim_core::db::migrations::latest_version());
        assert_eq!(body["image_count"], 3);
    }
}
```

- [ ] **Step 6: テスト補助を書く**

`crates/server/src/test_support.rs`（`main.rs` で `#[cfg(test)] mod test_support;` として宣言する）:

```rust
//! テスト専用。一時ディレクトリに書き込み可能な library.db を作り、
//! ルータを oneshot で叩くための足回りを提供する。

use crate::routes;
use crate::state::AppState;
use axum::body::Body;
use axum::http::Request;
use http_body_util::BodyExt;
use tower::ServiceExt;

/// 画像3件（a.png rating 5 / b.png rating 3 / c.png rating 4）を持つ DB と
/// 空の thumbnails/・web-cache/ を用意する。TempDir は返り値で生かし続けること。
pub fn test_state() -> (AppState, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().to_path_buf();
    std::fs::create_dir_all(data_dir.join("thumbnails")).unwrap();
    std::fs::create_dir_all(data_dir.join("web-cache")).unwrap();

    let conn = gim_core::db::open(&data_dir.join("library.db")).unwrap();
    conn.execute(
        "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
        [],
    )
    .unwrap();
    for (name, positive, rating, width) in [
        ("a.png", "forest cabin", 5i64, 1024i64),
        ("b.png", "forest blurry", 3, 512),
        ("c.png", "mountain peak", 4, 2048),
    ] {
        let img = gim_core::db::images::NewImage {
            directory_id: 1,
            path: format!("/d/{name}"),
            filename: name.to_string(),
            size: 1,
            mtime: 1,
            created_at: Some(1000),
            modified_at: Some(1000),
            width,
            height: 100,
            rating: Some(rating),
            format: "png".to_string(),
            positive: Some(positive.to_string()),
            raw_parameters: Some(positive.to_string()),
            source_tool: "a1111".to_string(),
            ..Default::default()
        };
        gim_core::db::images::upsert(&conn, &img).unwrap();
    }
    drop(conn);

    (AppState::new(data_dir), tmp)
}

/// ルータへ GET し、200 を確認して JSON を返す。
pub async fn get_json(state: AppState, uri: &str) -> serde_json::Value {
    let res = routes::router(state)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "GET {uri} が 200 を返さなかった");
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// ルータへ GET し、ステータスとレスポンスをそのまま返す。
pub async fn get_raw(state: AppState, uri: &str) -> axum::response::Response {
    routes::router(state)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap()
}
```

- [ ] **Step 7: ルータと `main` を書く**

`crates/server/src/routes/mod.rs`:

```rust
pub mod health;

use crate::state::AppState;
use axum::routing::get;
use axum::Router;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .with_state(state)
}
```

`crates/server/src/main.rs`:

```rust
mod cli;
mod error;
mod routes;
mod state;
#[cfg(test)]
mod test_support;

use clap::Parser;
use state::AppState;
use std::net::{IpAddr, UdpSocket};

/// 表示用の LAN アドレス。UDP の connect はパケットを送らないので、
/// 経路表からこのホストの送信元アドレスを引くだけの用途に使える。
fn lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

#[tokio::main]
async fn main() {
    let args = cli::Args::parse();

    let Some(data_dir) = args.resolved_data_dir() else {
        eprintln!("データディレクトリを決められません。--data-dir を指定してください。");
        std::process::exit(1);
    };
    let state = AppState::new(data_dir.clone());

    if let Err(e) = gim_core::db::open_read_only(&state.db_path) {
        eprintln!("{} を開けません: {e}", state.db_path.display());
        eprintln!("デスクトップ版を一度起動してから、もう一度実行してください。");
        std::process::exit(1);
    }
    if let Err(e) = std::fs::create_dir_all(&state.cache_dir) {
        eprintln!("{} を作れません: {e}", state.cache_dir.display());
        std::process::exit(1);
    }

    let addr = format!("{}:{}", args.host, args.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{addr} で待受できません: {e}");
            std::process::exit(1);
        }
    };

    match lan_ip() {
        Some(ip) => println!("http://{ip}:{} で待受中", args.port),
        None => println!("ポート {} で待受中", args.port),
    }
    println!("データディレクトリ: {}", data_dir.display());

    axum::serve(listener, routes::router(state)).await;
}
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server`
Expected: PASS。`health_reports_schema_version_and_image_count` が1件通る

- [ ] **Step 9: 実際に起動して疎通を確認する**

`--data-dir` にテスト用の一時ディレクトリではなく実際のライブラリを指定する。

```bash
cargo run -p gim-server -- --port 5180 &
sleep 2
curl -s http://127.0.0.1:5180/api/health
kill %1
```

Expected: `{"schema_version":6,"image_count":<件数>}` のような JSON が返る。起動時に `http://192.168.x.x:5180 で待受中` が表示される

- [ ] **Step 10: コミット**

```bash
git add crates/server Cargo.lock
git commit -m "$(cat <<'EOF'
feat(server): gim-server クレートと /api/health を追加

library.db を読み取り専用で開き、スキーマ版と画像件数を返す最小のサーバ。
起動時に LAN 側の待受アドレスを表示する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 検索系エンドポイント

**Files:**
- Create: `crates/server/src/dirscope.rs`, `crates/server/src/routes/directories.rs`, `crates/server/src/routes/images.rs`
- Modify: `crates/server/src/main.rs`（`mod dirscope;`）、`crates/server/src/routes/mod.rs`、`crates/core/src/db/image_query.rs`

**Interfaces:**
- Consumes: `AppState`・`ApiError`・`routes::router`（Task 2）、`gim_core::db::image_query::{query_images, count_query, DirScope}`
- Produces:
  - `gim_core::db::image_query::list_ids(conn, query_text, scope, sort, dir) -> rusqlite::Result<Vec<i64>>`
  - `dirscope::parse_dirs(raw: Option<&str>) -> Result<DirScope, String>`
  - `GET /api/directories`・`GET /api/images`・`GET /api/images/count`・`GET /api/images/ids`

### 決定事項

**`dirs` パラメータの解釈** — 3つの状態を区別する:

| リクエスト | 意味 | `DirScope` |
|---|---|---|
| `dirs` キーなし | 指定なし。デスクトップ版の表示設定に従う | `Visible` |
| `?dirs=`（空文字列） | 空集合を明示。0件 | `Ids(vec![])` |
| `?dirs=1,2` | 指定 ID のみ | `Ids(vec![1, 2])` |

空文字列を `Visible` に倒すと、クライアントが「全ディレクトリのチェックを外した」状態を送ったときに全件が返り、意図と正反対になる。

**上限とバリデーション:**

- `dirs` の ID は最大 **500 件**。超えたら 400。SQLite のホスト変数上限（32766）に達する前に、明らかに異常な入力を弾く
- ID が数値として読めなければ 400
- `limit` は省略時 **200**、範囲は 1〜1000。範囲外は 400
- `offset` は省略時 0、負値は 400
- `sort` / `dir` は `SortKey::parse` / `SortDir::parse` が未知の値を既定値へ落とすので、バリデーションしない（既存のデスクトップ版と同じ挙動）

- [ ] **Step 1: `list_ids` の失敗するテストを書く**

`crates/core/src/db/image_query.rs` のテストモジュール末尾に追加する。

```rust
    #[test]
    fn list_ids_returns_ids_in_sort_order() {
        let c = conn();
        seed(&c);
        let ids = list_ids(&c, "", &DirScope::Visible, SortKey::Filename, SortDir::Asc).unwrap();
        let rows = query_images(&c, "", &DirScope::Visible, SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(ids, rows.iter().map(|r| r.id).collect::<Vec<_>>());
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn list_ids_applies_query_and_scope() {
        let c = conn();
        seed(&c);
        let ids = list_ids(&c, "forest", &DirScope::Visible, SortKey::Filename, SortDir::Asc).unwrap();
        assert_eq!(ids.len(), 2);
        let none = list_ids(&c, "forest", &DirScope::Ids(vec![]), SortKey::Filename, SortDir::Asc).unwrap();
        assert!(none.is_empty());
    }
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-core list_ids`
Expected: コンパイルエラー。`list_ids` が存在しない

- [ ] **Step 3: `list_ids` を実装する**

`crates/core/src/db/image_query.rs` の `count_query` の直後に追加する。

```rust
/// クエリに一致する画像 ID を、一覧と同じ並び順で返す。
/// スライドショーの再生順序に使う。行全体を送るより転送量が桁で小さい。
pub fn list_ids(
    conn: &Connection,
    query_text: &str,
    scope: &DirScope,
    sort: SortKey,
    dir: SortDir,
) -> rusqlite::Result<Vec<i64>> {
    let cf = compile::compile(&parse::parse(query_text));
    let (dir_sql, dir_params) = scope.sql_and_params();
    let sql = format!(
        "SELECT id FROM images WHERE ({where_sql}) AND {dir_sql} \
         ORDER BY {sortcol} {sortdir}, id {sortdir}",
        where_sql = cf.where_sql,
        dir_sql = dir_sql,
        sortcol = sort.column(),
        sortdir = dir.sql(),
    );
    let mut p = cf.params;
    p.extend(dir_params);

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(p), |r| r.get(0))?;
    rows.collect()
}
```

- [ ] **Step 4: core のテストを実行して通ることを確認する**

Run: `cargo test -p gim-core`
Expected: PASS（131 + 2 = 133 件）

- [ ] **Step 5: `parse_dirs` の失敗するテストを書く**

`crates/server/src/dirscope.rs`:

```rust
use gim_core::db::image_query::DirScope;

/// `dirs` に載せられる ID の上限。SQLite のホスト変数上限に達する前に
/// 明らかに異常な入力を弾く。
const MAX_DIR_IDS: usize = 500;

/// `dirs` クエリパラメータを `DirScope` へ変換する。
/// キーなし → Visible、空文字列 → 空集合（0件）、`1,2` → 指定ID。
pub fn parse_dirs(raw: Option<&str>) -> Result<DirScope, String> {
    let Some(raw) = raw else {
        return Ok(DirScope::Visible);
    };
    if raw.is_empty() {
        return Ok(DirScope::Ids(Vec::new()));
    }
    let parts: Vec<&str> = raw.split(',').collect();
    if parts.len() > MAX_DIR_IDS {
        return Err(format!("dirs が多すぎます (最大 {MAX_DIR_IDS} 件)"));
    }
    let mut ids = Vec::with_capacity(parts.len());
    for p in parts {
        let n: i64 = p
            .trim()
            .parse()
            .map_err(|_| format!("dirs に数値でない値があります: {p:?}"))?;
        ids.push(n);
    }
    Ok(DirScope::Ids(ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_key_means_visible() {
        assert_eq!(parse_dirs(None).unwrap(), DirScope::Visible);
    }

    #[test]
    fn empty_string_means_empty_set() {
        assert_eq!(parse_dirs(Some("")).unwrap(), DirScope::Ids(vec![]));
    }

    #[test]
    fn comma_separated_ids_are_parsed() {
        assert_eq!(parse_dirs(Some("1,2,3")).unwrap(), DirScope::Ids(vec![1, 2, 3]));
        assert_eq!(parse_dirs(Some(" 4 , 5 ")).unwrap(), DirScope::Ids(vec![4, 5]));
    }

    #[test]
    fn non_numeric_is_rejected() {
        assert!(parse_dirs(Some("1,x")).is_err());
    }

    #[test]
    fn too_many_ids_are_rejected() {
        let raw = (0..=MAX_DIR_IDS).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        assert!(parse_dirs(Some(&raw)).is_err());
    }
}
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `cargo test -p gim-server parse_dirs` あるいは `cargo test -p gim-server dirscope`
Expected: コンパイルエラー。`mod dirscope;` が `main.rs` に無く、`DirScope` が `PartialEq` を導出していない場合はその不足も出る（Task 1 の時点で `#[derive(Debug, Clone, PartialEq)]` 済みなので通るはず）

- [ ] **Step 7: `main.rs` にモジュールを追加する**

`crates/server/src/main.rs` の `mod cli;` の直後に追加する。

```rust
mod dirscope;
```

- [ ] **Step 8: 検索系ハンドラを書く**

`crates/server/src/routes/images.rs`:

```rust
use crate::dirscope::parse_dirs;
use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::Json;
use gim_core::db::image_query::{self, DirScope, ImageRow};
use gim_core::query::{SortDir, SortKey};
use serde::{Deserialize, Serialize};

const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 1000;

#[derive(Deserialize, Default)]
pub struct ListParams {
    #[serde(default)]
    pub q: String,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub dirs: Option<String>,
}

impl ListParams {
    fn sort_key(&self) -> SortKey {
        SortKey::parse(self.sort.as_deref().unwrap_or("filename"))
    }
    fn sort_dir(&self) -> SortDir {
        SortDir::parse(self.dir.as_deref().unwrap_or("asc"))
    }
    fn limit(&self) -> Result<i64, ApiError> {
        let v = self.limit.unwrap_or(DEFAULT_LIMIT);
        if !(1..=MAX_LIMIT).contains(&v) {
            return Err(ApiError::BadRequest(format!(
                "limit は 1〜{MAX_LIMIT} で指定してください: {v}"
            )));
        }
        Ok(v)
    }
    fn offset(&self) -> Result<i64, ApiError> {
        let v = self.offset.unwrap_or(0);
        if v < 0 {
            return Err(ApiError::BadRequest(format!("offset は 0 以上です: {v}")));
        }
        Ok(v)
    }
}

fn scope(params: &ListParams) -> Result<DirScope, ApiError> {
    parse_dirs(params.dirs.as_deref()).map_err(ApiError::BadRequest)
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<ImageRow>>, ApiError> {
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
    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct CountBody {
    pub total: i64,
}

pub async fn count(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<CountBody>, ApiError> {
    let conn = state.conn()?;
    let total = image_query::count_query(&conn, &params.q, &scope(&params)?)?;
    Ok(Json(CountBody { total }))
}

pub async fn ids(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<i64>>, ApiError> {
    let conn = state.conn()?;
    let ids = image_query::list_ids(
        &conn,
        &params.q,
        &scope(&params)?,
        params.sort_key(),
        params.sort_dir(),
    )?;
    Ok(Json(ids))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_json, get_raw, test_state};

    #[tokio::test]
    async fn list_returns_all_images_by_default() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn list_applies_query_and_sort() {
        let (state, _tmp) = test_state();
        let body = get_json(state.clone(), "/api/images?q=forest").await;
        assert_eq!(body.as_array().unwrap().len(), 2);

        let desc = get_json(state, "/api/images?sort=filename&dir=desc").await;
        assert_eq!(desc[0]["filename"], "c.png");
    }

    #[tokio::test]
    async fn list_paginates() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images?limit=2&offset=2").await;
        let arr = body.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["filename"], "c.png");
    }

    #[tokio::test]
    async fn count_matches_list() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images/count?q=forest").await;
        assert_eq!(body["total"], 2);
    }

    #[tokio::test]
    async fn ids_returns_ordered_ids() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images/ids?sort=filename&dir=asc").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn empty_dirs_returns_nothing() {
        let (state, _tmp) = test_state();
        let body = get_json(state.clone(), "/api/images?dirs=").await;
        assert!(body.as_array().unwrap().is_empty());
        let count = get_json(state, "/api/images/count?dirs=").await;
        assert_eq!(count["total"], 0);
    }

    #[tokio::test]
    async fn explicit_dirs_selects_that_directory() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images?dirs=1").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn invalid_params_return_400() {
        let (state, _tmp) = test_state();
        for uri in ["/api/images?limit=0", "/api/images?limit=1001", "/api/images?offset=-1", "/api/images?dirs=x"] {
            let res = get_raw(state.clone(), uri).await;
            assert_eq!(res.status(), 400, "{uri} は 400 を返すべき");
        }
    }
}
```

`crates/server/src/routes/directories.rs`:

```rust
use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use gim_core::models::Directory;

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<Directory>>, ApiError> {
    let conn = state.conn()?;
    Ok(Json(gim_core::db::directories::list(&conn)?))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_json, test_state};

    #[tokio::test]
    async fn directories_include_visible_and_image_count() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/directories").await;
        let arr = body.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["label"], "d");
        assert_eq!(arr[0]["visible"], true);
        assert_eq!(arr[0]["image_count"], 3);
    }
}
```

- [ ] **Step 9: ルータへ登録する**

`crates/server/src/routes/mod.rs` を以下にする。

```rust
pub mod directories;
pub mod health;
pub mod images;

use crate::state::AppState;
use axum::routing::get;
use axum::Router;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/directories", get(directories::list))
        .route("/api/images", get(images::list))
        .route("/api/images/count", get(images::count))
        .route("/api/images/ids", get(images::ids))
        .with_state(state)
}
```

- [ ] **Step 10: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server`
Expected: PASS。`dirscope` 5件 + `images` 8件 + `directories` 1件 + `health` 1件 = 15件

- [ ] **Step 11: 実ライブラリで疎通を確認する**

```bash
cargo run -p gim-server -- --port 5180 &
sleep 2
curl -s "http://127.0.0.1:5180/api/directories" | head -c 400; echo
curl -s "http://127.0.0.1:5180/api/images?limit=2" | head -c 400; echo
curl -s "http://127.0.0.1:5180/api/images/count"; echo
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:5180/api/images?limit=0"
kill %1
```

Expected: ディレクトリ一覧と画像2件の JSON、件数 JSON が返る。最後の行が `400`

- [ ] **Step 12: コミット**

```bash
git add crates/server crates/core/src/db/image_query.rs
git commit -m "$(cat <<'EOF'
feat(server): 検索・ディレクトリ一覧のエンドポイントを追加

/api/images・/api/images/count・/api/images/ids・/api/directories。
dirs パラメータは未指定=visible、空文字列=0件、カンマ区切り=指定IDで解釈する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: サムネイルと原画像の配信

**Files:**
- Create: `crates/server/src/fileserve.rs`, `crates/server/src/routes/media.rs`
- Modify: `crates/server/src/main.rs`（`mod fileserve;`）、`crates/server/src/routes/mod.rs`、`crates/core/src/db/images.rs`

**Interfaces:**
- Consumes: `AppState`・`ApiError`（Task 2）
- Produces:
  - `gim_core::db::images::MediaInfo { path: String, thumb_path: Option<String>, format: String }`
  - `gim_core::db::images::get_media_info(conn, id) -> rusqlite::Result<Option<MediaInfo>>`
  - `fileserve::read_with_timeout(path: PathBuf) -> Result<(Vec<u8>, u64), ApiError>`（返り値の `u64` はファイル mtime の epoch 秒）
  - `fileserve::etag_of(path: &str, mtime: u64, width: Option<u32>) -> String`
  - `fileserve::respond(bytes, content_type, etag, if_none_match) -> Response`
  - `GET /api/thumb/{id}`・`GET /api/image/{id}`

### 決定事項

**タイムアウト:** ファイルの読み出しは `tokio::task::spawn_blocking` の中で行い、`tokio::time::timeout` で3秒に制限する。超過したら 503（`Unavailable`）、ファイルが無ければ 404（`NotFound`）。オフラインのネットワークドライブで `metadata()` がハングしても UI を止めないための措置。**既知の制限として、タイムアウトしても `spawn_blocking` のスレッドは処理が終わるまで解放されない。** 到達不能なドライブへのリクエストが多発するとブロッキングプールを食い潰すが、この設計段階では許容する。

**ETag とキャッシュ:** ETag は `FNV-1a(パス + mtime + 幅)` の16進。内容が変われば mtime が変わるのでキーも変わる。`Cache-Control: public, max-age=31536000, immutable` を付ける。`If-None-Match` が一致したら 304 を返す。

**Content-Type:** サムネイルは `image/webp` 固定（`thumbnail.rs` が WebP のみ生成する）。原画像は `images.format` 列から決める（`png` / `jpeg` / `jpg` / `webp`、それ以外は `application/octet-stream`）。

- [ ] **Step 1: `get_media_info` の失敗するテストを書く**

`crates/core/src/db/images.rs` のテストモジュール末尾に追加する。既存のヘルパ `conn()`（ディレクトリ `/d` を1件作る）と `sample(path)`（`format = "png"` の `NewImage` を返す）、および id を返す `upsert` をそのまま使う。

```rust
    #[test]
    fn get_media_info_returns_paths_and_format() {
        let c = conn();
        let mut img = sample("/d/a.png");
        img.thumb_path = Some("/t/abc.webp".to_string());
        let id = upsert(&c, &img).unwrap();

        let info = get_media_info(&c, id).unwrap().unwrap();
        assert_eq!(info.path, "/d/a.png");
        assert_eq!(info.thumb_path.as_deref(), Some("/t/abc.webp"));
        assert_eq!(info.format, "png");
    }

    #[test]
    fn get_media_info_is_none_for_unknown_id() {
        let c = conn();
        assert!(get_media_info(&c, 12345).unwrap().is_none());
    }
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-core get_media_info`
Expected: コンパイルエラー。`get_media_info` と `MediaInfo` が存在しない

- [ ] **Step 3: `get_media_info` を実装する**

`crates/core/src/db/images.rs` に追加する。

```rust
/// 配信に必要な最小限の情報。詳細メタデータ（raw_parameters や comfy_workflow）は
/// 大きいので、画像配信の経路では読まない。
#[derive(Debug, Clone, PartialEq)]
pub struct MediaInfo {
    pub path: String,
    pub thumb_path: Option<String>,
    pub format: String,
}

pub fn get_media_info(conn: &Connection, id: i64) -> rusqlite::Result<Option<MediaInfo>> {
    let mut stmt =
        conn.prepare("SELECT path, thumb_path, format FROM images WHERE id = ?1 AND missing = 0")?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(r) => Ok(Some(MediaInfo {
            path: r.get(0)?,
            thumb_path: r.get(1)?,
            format: r.get(2)?,
        })),
        None => Ok(None),
    }
}
```

- [ ] **Step 4: core のテストを実行して通ることを確認する**

Run: `cargo test -p gim-core`
Expected: PASS（133 + 2 = 135 件）

- [ ] **Step 5: `fileserve` を書く**

`crates/server/src/fileserve.rs`:

```rust
use crate::error::ApiError;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

/// 到達できないネットワークドライブでの metadata()/read() のハングを、
/// UI を止めない範囲で打ち切る。
const READ_TIMEOUT: Duration = Duration::from_secs(3);

/// ファイル全体と mtime（epoch 秒）を読む。
/// 存在しなければ NotFound、時間内に読めなければ Unavailable。
pub async fn read_with_timeout(path: PathBuf) -> Result<(Vec<u8>, u64), ApiError> {
    let job = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        let mtime = meta
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let bytes = std::fs::read(&path)?;
        Ok::<_, std::io::Error>((bytes, mtime))
    });

    match tokio::time::timeout(READ_TIMEOUT, job).await {
        Err(_) => Err(ApiError::Unavailable),
        Ok(Err(e)) => Err(ApiError::Internal(format!("読み出しに失敗しました: {e}"))),
        Ok(Ok(Err(e))) if e.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
        Ok(Ok(Err(_))) => Err(ApiError::Unavailable),
        Ok(Ok(Ok(v))) => Ok(v),
    }
}

/// 内容で決まるキャッシュキー。mtime を含むので画像が差し替われば自然に無効化される。
pub fn fnv1a64(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.as_bytes() {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub fn etag_of(path: &str, mtime: u64, width: Option<u32>) -> String {
    let m = mtime.to_string();
    let w = width.map(|w| w.to_string()).unwrap_or_default();
    format!("\"{}\"", fnv1a64(&[path, &m, &w]))
}

pub fn content_type_for(format: &str) -> &'static str {
    match format.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// ETag が一致すれば 304、そうでなければ本体を返す。
/// キーが内容で決まるので immutable で永続キャッシュしてよい。
pub fn respond(bytes: Vec<u8>, content_type: &str, etag: &str, headers: &HeaderMap) -> Response {
    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag));

    let common = [
        (header::ETAG, etag.to_string()),
        (
            header::CACHE_CONTROL,
            "public, max-age=31536000, immutable".to_string(),
        ),
    ];

    if matches {
        return (StatusCode::NOT_MODIFIED, common).into_response();
    }
    (
        StatusCode::OK,
        common,
        [(header::CONTENT_TYPE, content_type.to_string())],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etag_changes_with_mtime_and_width() {
        let a = etag_of("/d/a.png", 100, None);
        assert_eq!(a, etag_of("/d/a.png", 100, None), "同じ入力なら安定する");
        assert_ne!(a, etag_of("/d/a.png", 101, None));
        assert_ne!(a, etag_of("/d/a.png", 100, Some(1280)));
        assert_ne!(a, etag_of("/d/b.png", 100, None));
    }

    #[test]
    fn fnv1a64_separates_fields() {
        // 区切りが無いと ("ab","c") と ("a","bc") が衝突する。
        assert_ne!(fnv1a64(&["ab", "c"]), fnv1a64(&["a", "bc"]));
    }

    #[test]
    fn content_type_maps_known_formats() {
        assert_eq!(content_type_for("PNG"), "image/png");
        assert_eq!(content_type_for("jpeg"), "image/jpeg");
        assert_eq!(content_type_for("webp"), "image/webp");
        assert_eq!(content_type_for("tiff"), "application/octet-stream");
    }

    #[tokio::test]
    async fn read_with_timeout_reports_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("nope.png");
        assert!(matches!(
            read_with_timeout(missing).await,
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn read_with_timeout_returns_bytes_and_mtime() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.bin");
        std::fs::write(&p, b"hello").unwrap();
        let (bytes, mtime) = read_with_timeout(p).await.unwrap();
        assert_eq!(bytes, b"hello");
        assert!(mtime > 0);
    }
}
```

- [ ] **Step 6: メディア配信ハンドラを書く**

`crates/server/src/routes/media.rs`:

```rust
use crate::error::ApiError;
use crate::fileserve;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use gim_core::db::images::MediaInfo;
use std::path::PathBuf;

fn media_info(state: &AppState, id: i64) -> Result<MediaInfo, ApiError> {
    let conn = state.conn()?;
    gim_core::db::images::get_media_info(&conn, id)?.ok_or(ApiError::NotFound)
}

pub async fn thumb(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let info = media_info(&state, id)?;
    let thumb = info.thumb_path.ok_or(ApiError::NotFound)?;
    let (bytes, mtime) = fileserve::read_with_timeout(PathBuf::from(&thumb)).await?;
    let etag = fileserve::etag_of(&thumb, mtime, None);
    Ok(fileserve::respond(bytes, "image/webp", &etag, &headers))
}

pub async fn image(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let info = media_info(&state, id)?;
    let (bytes, mtime) = fileserve::read_with_timeout(PathBuf::from(&info.path)).await?;
    let etag = fileserve::etag_of(&info.path, mtime, None);
    let ct = fileserve::content_type_for(&info.format);
    Ok(fileserve::respond(bytes, ct, &etag, &headers))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_raw, test_state_with_files};
    use axum::http::header;

    #[tokio::test]
    async fn thumb_serves_webp_with_etag() {
        let (state, _tmp) = test_state_with_files();
        let res = get_raw(state, "/api/thumb/1").await;
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/webp");
        assert!(res.headers().contains_key(header::ETAG));
        assert!(res.headers()[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("immutable"));
    }

    #[tokio::test]
    async fn image_serves_original_with_format_content_type() {
        let (state, _tmp) = test_state_with_files();
        let res = get_raw(state, "/api/image/1").await;
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    }

    #[tokio::test]
    async fn matching_if_none_match_returns_304() {
        let (state, _tmp) = test_state_with_files();
        let first = get_raw(state.clone(), "/api/image/1").await;
        let etag = first.headers()[header::ETAG].to_str().unwrap().to_string();

        let res = crate::test_support::get_raw_with_headers(
            state,
            "/api/image/1",
            &[(header::IF_NONE_MATCH.as_str(), etag.as_str())],
        )
        .await;
        assert_eq!(res.status(), 304);
    }

    #[tokio::test]
    async fn unknown_id_is_404() {
        let (state, _tmp) = test_state_with_files();
        assert_eq!(get_raw(state.clone(), "/api/image/9999").await.status(), 404);
        assert_eq!(get_raw(state, "/api/thumb/9999").await.status(), 404);
    }

    #[tokio::test]
    async fn missing_file_on_disk_is_404() {
        let (state, _tmp) = test_state_with_files();
        // id 2 の実ファイルは作っていない。
        assert_eq!(get_raw(state, "/api/image/2").await.status(), 404);
    }
}
```

- [ ] **Step 7: テスト補助を拡張する**

`crates/server/src/test_support.rs` に追加する。`test_state` は既存のまま残し、ファイル付きの版を別に作る。

```rust
/// `test_state` に加えて、id 1 の画像だけ実ファイル（PNG）とサムネイル（WebP）を
/// ディスクに作り、DB のパスをそこへ向ける。id 2・3 の実体は作らない。
pub fn test_state_with_files() -> (AppState, tempfile::TempDir) {
    let (state, tmp) = test_state();
    let data_dir = tmp.path().to_path_buf();

    let img_path = data_dir.join("a.png");
    let thumb_path = data_dir.join("thumbnails").join("a.webp");
    write_png(&img_path, 64, 48);
    // WebP としての妥当性はこのテストの関心事ではないので、バイト列は何でもよい。
    std::fs::write(&thumb_path, b"fake-webp").unwrap();

    let conn = rusqlite::Connection::open(data_dir.join("library.db")).unwrap();
    conn.execute(
        "UPDATE images SET path = ?1, thumb_path = ?2 WHERE filename = 'a.png'",
        rusqlite::params![
            img_path.to_string_lossy(),
            thumb_path.to_string_lossy()
        ],
    )
    .unwrap();
    drop(conn);

    (state, tmp)
}

/// テスト用の最小 PNG を書き出す。
pub fn write_png(path: &std::path::Path, w: u32, h: u32) {
    let buf = image::RgbImage::from_pixel(w, h, image::Rgb([120, 160, 200]));
    buf.save_with_format(path, image::ImageFormat::Png).unwrap();
}

/// ヘッダ付きで GET する。
pub async fn get_raw_with_headers(
    state: AppState,
    uri: &str,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let mut req = Request::get(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    routes::router(state)
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}
```

`main.rs` に `mod fileserve;` を追加する。

- [ ] **Step 8: ルータへ登録する**

`crates/server/src/routes/mod.rs` に追加する。

```rust
pub mod media;
```

`router()` の `.route("/api/images/ids", ...)` の直後に追加する。

```rust
        .route("/api/thumb/{id}", get(media::thumb))
        .route("/api/image/{id}", get(media::image))
```

axum 0.8 のパスパラメータは `{id}` 構文（`:id` ではない）。

- [ ] **Step 9: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server`
Expected: PASS。15件 + `fileserve` 5件 + `media` 5件 = 25件

- [ ] **Step 10: 実ライブラリで疎通を確認する**

```bash
cargo run -p gim-server -- --port 5180 &
sleep 2
ID=$(curl -s "http://127.0.0.1:5180/api/images?limit=1" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
echo "id=$ID"
curl -s -o /dev/null -w "thumb: %{http_code} %{content_type} %{size_download}\n" "http://127.0.0.1:5180/api/thumb/$ID"
curl -s -o /dev/null -w "image: %{http_code} %{content_type} %{size_download}\n" "http://127.0.0.1:5180/api/image/$ID"
kill %1
```

Expected: どちらも `200`。thumb は `image/webp`、image は `image/png` 等でサイズが 0 より大きい

- [ ] **Step 11: コミット**

```bash
git add crates/server crates/core/src/db/images.rs
git commit -m "$(cat <<'EOF'
feat(server): サムネイルと原画像の配信を追加

/api/thumb/{id} と /api/image/{id}。ETag は内容由来のキーで、
条件付きGETに 304 を返す。到達できないファイルは 503、消えたものは 404。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: リサイズとディスクキャッシュ

**Files:**
- Create: `crates/server/src/resize.rs`
- Modify: `crates/server/src/main.rs`（`mod resize;`）、`crates/server/src/routes/media.rs`

**Interfaces:**
- Consumes: `AppState`（`cache_dir`・`generated`）、`fileserve`（Task 4）
- Produces:
  - `resize::snap_width(requested: u32) -> u32`
  - `resize::cache_key(path: &str, mtime: u64, width: u32) -> String`
  - `resize::get_or_create(state, src_path, mtime, width) -> Result<Option<Vec<u8>>, ApiError>`（原画像の方が小さければ `None`）
  - `GET /api/image/{id}?w=1280`

### 決定事項

- 許可する幅は **640 / 1280 / 1920 / 2560**。要求値は「それ以上で最小の許可値」へスナップし、超える場合は最大値。任意の値を受け付けるとキャッシュが際限なく増える
- **縮小のみ。** 原画像の幅が選ばれた幅以下なら原画像をそのまま返す（拡大しない）
- 出力は **WebP 品質 82**
- キャッシュキーは `FNV-1a(元パス + mtime + 幅)` の16進 + `.webp`
- 書き込みは一時ファイル → `rename`。同一画像への同時リクエストが競合しても壊れない
- 容量上限は **2 GiB**。起動時と、生成 **50 回ごと** に点検し、超過していればアクセス時刻の古い順に削除する
- `w` が数値でない、または 1 未満なら 400

- [ ] **Step 1: 純粋関数の失敗するテストを書く**

`crates/server/src/resize.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_width_rounds_up_to_allowed_values() {
        assert_eq!(snap_width(1), 640);
        assert_eq!(snap_width(640), 640);
        assert_eq!(snap_width(641), 1280);
        assert_eq!(snap_width(1920), 1920);
        assert_eq!(snap_width(4000), 2560, "上限を超えたら最大値へ落とす");
    }

    #[test]
    fn cache_key_is_stable_and_content_derived() {
        let a = cache_key("/d/a.png", 100, 1280);
        assert_eq!(a, cache_key("/d/a.png", 100, 1280));
        assert_ne!(a, cache_key("/d/a.png", 101, 1280), "mtime で変わる");
        assert_ne!(a, cache_key("/d/a.png", 100, 1920), "幅で変わる");
        assert_ne!(a, cache_key("/d/b.png", 100, 1280), "パスで変わる");
        assert!(a.ends_with(".webp"));
    }
}
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cargo test -p gim-server resize`
Expected: コンパイルエラー。`snap_width` と `cache_key` が存在しない

- [ ] **Step 3: 純粋関数を実装する**

`crates/server/src/resize.rs` の先頭に追加する。

```rust
use crate::error::ApiError;
use crate::fileserve::fnv1a64;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

/// 許可する幅。任意の値を受け付けるとキャッシュが際限なく増える。
const ALLOWED_WIDTHS: [u32; 4] = [640, 1280, 1920, 2560];
const WEBP_QUALITY: f32 = 82.0;
/// キャッシュ容量の上限。
const CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 何回生成するごとに容量を点検するか。
const SWEEP_EVERY: u64 = 50;

pub fn snap_width(requested: u32) -> u32 {
    ALLOWED_WIDTHS
        .iter()
        .copied()
        .find(|w| *w >= requested)
        .unwrap_or(ALLOWED_WIDTHS[ALLOWED_WIDTHS.len() - 1])
}

pub fn cache_key(path: &str, mtime: u64, width: u32) -> String {
    let m = mtime.to_string();
    let w = width.to_string();
    format!("{}.webp", fnv1a64(&[path, &m, &w]))
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server resize`
Expected: PASS（2件）

- [ ] **Step 5: 生成とキャッシュの失敗するテストを書く**

`crates/server/src/resize.rs` のテストモジュールに追加する。

```rust
    use crate::test_support::{test_state, write_png};

    #[tokio::test]
    async fn get_or_create_writes_cache_and_reuses_it() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("big.png");
        write_png(&src, 3000, 2000);

        let first = get_or_create(&state, &src, 42, 1280).await.unwrap().unwrap();
        assert!(!first.is_empty());

        let key = cache_key(&src.to_string_lossy(), 42, 1280);
        let cached = state.cache_dir.join(&key);
        assert!(cached.exists(), "キャッシュファイルが作られていない");

        // 2回目はキャッシュから返る。中身が一致することで確認する。
        let second = get_or_create(&state, &src, 42, 1280).await.unwrap().unwrap();
        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn get_or_create_declines_to_upscale() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("small.png");
        write_png(&src, 400, 300);

        let out = get_or_create(&state, &src, 1, 1280).await.unwrap();
        assert!(out.is_none(), "原画像より大きい幅では None を返す");
    }

    #[tokio::test]
    async fn resized_output_is_narrower_than_source() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("wide.png");
        write_png(&src, 3000, 1000);

        let bytes = get_or_create(&state, &src, 7, 640).await.unwrap().unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 640);
        assert_eq!(decoded.height(), 213, "アスペクト比を保つ (1000 * 640 / 3000)");
    }
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `cargo test -p gim-server resize`
Expected: コンパイルエラー。`get_or_create` が存在しない

- [ ] **Step 7: 生成とキャッシュを実装する**

`crates/server/src/resize.rs` に追加する。

```rust
/// リサイズ済み WebP を返す。原画像の方が狭ければ `None`（呼び出し側が原画像を返す）。
pub async fn get_or_create(
    state: &AppState,
    src: &Path,
    mtime: u64,
    width: u32,
) -> Result<Option<Vec<u8>>, ApiError> {
    let key = cache_key(&src.to_string_lossy(), mtime, width);
    let cached = state.cache_dir.join(&key);

    if let Ok(bytes) = tokio::fs::read(&cached).await {
        return Ok(Some(bytes));
    }

    let src = src.to_path_buf();
    let cache_dir = state.cache_dir.clone();
    let out = tokio::task::spawn_blocking(move || encode_resized(&src, width, &cache_dir, &key))
        .await
        .map_err(|e| ApiError::Internal(format!("リサイズに失敗しました: {e}")))??;

    if out.is_some() {
        let n = state.generated.fetch_add(1, Ordering::Relaxed) + 1;
        if n % SWEEP_EVERY == 0 {
            let dir = state.cache_dir.clone();
            tokio::task::spawn_blocking(move || sweep(&dir, CACHE_LIMIT_BYTES));
        }
    }
    Ok(out)
}

fn encode_resized(
    src: &Path,
    width: u32,
    cache_dir: &Path,
    key: &str,
) -> Result<Option<Vec<u8>>, ApiError> {
    let img = image::open(src).map_err(|e| match e {
        image::ImageError::IoError(io) if io.kind() == std::io::ErrorKind::NotFound => {
            ApiError::NotFound
        }
        other => ApiError::Internal(format!("画像を読めません: {other}")),
    })?;

    if img.width() <= width {
        return Ok(None);
    }
    let height = ((img.height() as u64 * width as u64) / img.width() as u64).max(1) as u32;
    let resized = img.resize_exact(width, height, image::imageops::FilterType::Lanczos3);

    let rgb = resized.to_rgb8();
    let encoder = webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height());
    let bytes = encoder.encode(WEBP_QUALITY).to_vec();

    // 一時ファイル → rename。同じ画像への同時リクエストが競合しても壊れない。
    let tmp = cache_dir.join(format!("{key}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, &bytes)
        .map_err(|e| ApiError::Internal(format!("キャッシュを書けません: {e}")))?;
    let _ = std::fs::rename(&tmp, cache_dir.join(key));

    Ok(Some(bytes))
}

/// 上限を超えていればアクセス時刻の古い順に削除する。
fn sweep(cache_dir: &Path, limit: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let atime = meta.accessed().or_else(|_| meta.modified()).ok()?;
            Some((atime, meta.len(), e.path()))
        })
        .collect();

    let mut total: u64 = files.iter().map(|(_, len, _)| *len).sum();
    if total <= limit {
        return;
    }
    files.sort_by_key(|(atime, _, _)| *atime);
    for (_, len, path) in files {
        if total <= limit {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `cargo test -p gim-server resize`
Expected: PASS（5件）

- [ ] **Step 9: `w` パラメータをハンドラへ組み込む**

`crates/server/src/routes/media.rs` の `image` を差し替える。`use axum::extract::Query;` と `use serde::Deserialize;` を追加する。

```rust
#[derive(Deserialize)]
pub struct ImageParams {
    pub w: Option<u32>,
}

pub async fn image(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<ImageParams>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let info = media_info(&state, id)?;
    let src = PathBuf::from(&info.path);

    if let Some(requested) = params.w {
        if requested < 1 {
            return Err(ApiError::BadRequest("w は 1 以上です".to_string()));
        }
        let width = crate::resize::snap_width(requested);
        let mtime = fileserve::read_meta_with_timeout(src.clone()).await?;
        if let Some(bytes) = crate::resize::get_or_create(&state, &src, mtime, width).await? {
            let etag = fileserve::etag_of(&info.path, mtime, Some(width));
            return Ok(fileserve::respond(bytes, "image/webp", &etag, &headers));
        }
        // 原画像の方が狭い場合はそのまま返す。
    }

    let (bytes, mtime) = fileserve::read_with_timeout(src).await?;
    let etag = fileserve::etag_of(&info.path, mtime, None);
    let ct = fileserve::content_type_for(&info.format);
    Ok(fileserve::respond(bytes, ct, &etag, &headers))
}
```

`crates/server/src/fileserve.rs` に mtime だけを取る版を追加する。リサイズ経路では原画像の全バイトを読む必要がない。

```rust
/// mtime だけを読む。リサイズ経路ではキャッシュが当たれば原画像を読まずに済む。
pub async fn read_meta_with_timeout(path: PathBuf) -> Result<u64, ApiError> {
    let job = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        let mtime = meta
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok::<_, std::io::Error>(mtime)
    });

    match tokio::time::timeout(READ_TIMEOUT, job).await {
        Err(_) => Err(ApiError::Unavailable),
        Ok(Err(e)) => Err(ApiError::Internal(format!("読み出しに失敗しました: {e}"))),
        Ok(Ok(Err(e))) if e.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
        Ok(Ok(Err(_))) => Err(ApiError::Unavailable),
        Ok(Ok(Ok(mtime))) => Ok(mtime),
    }
}
```

`main.rs` に `mod resize;` を追加する。

- [ ] **Step 10: エンドポイントのテストを追加する**

`crates/server/src/routes/media.rs` のテストモジュールに追加する。

```rust
    #[tokio::test]
    async fn width_parameter_returns_webp() {
        let (state, _tmp) = test_state_with_wide_image();
        let res = get_raw(state, "/api/image/1?w=640").await;
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/webp");
    }

    #[tokio::test]
    async fn width_larger_than_source_returns_original() {
        let (state, _tmp) = test_state_with_files();
        // test_state_with_files の画像は 64px 幅なので、どの許可幅より狭い。
        let res = get_raw(state, "/api/image/1?w=1280").await;
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    }

    #[tokio::test]
    async fn invalid_width_is_400() {
        let (state, _tmp) = test_state_with_files();
        assert_eq!(get_raw(state.clone(), "/api/image/1?w=0").await.status(), 400);
        assert_eq!(get_raw(state, "/api/image/1?w=abc").await.status(), 400);
    }
```

`test_support.rs` に、リサイズが実際に走る幅の画像を持つ状態を追加する。

```rust
/// `test_state_with_files` と同じだが、id 1 の画像を 3000px 幅にする。
pub fn test_state_with_wide_image() -> (AppState, tempfile::TempDir) {
    let (state, tmp) = test_state_with_files();
    let conn = rusqlite::Connection::open(tmp.path().join("library.db")).unwrap();
    let path: String = conn
        .query_row("SELECT path FROM images WHERE filename = 'a.png'", [], |r| r.get(0))
        .unwrap();
    drop(conn);
    write_png(std::path::Path::new(&path), 3000, 1000);
    (state, tmp)
}
```

**注意:** `w=abc` は axum の `Query<ImageParams>` が `u32` にデシリアライズできず、既定で 400 を返す。`w=0` は自前のバリデーションで 400 になる。両方がテストで固定される。

- [ ] **Step 11: 全テストを実行する**

Run: `cargo test -p gim-server && cargo test --workspace`
Expected: PASS。server 33件（25 + resize 5 + media 3）、workspace 全体でも 0 failed

- [ ] **Step 12: 実ライブラリで転送量の差を確認する**

```bash
cargo run -p gim-server --release -- --port 5180 &
sleep 3
ID=$(curl -s "http://127.0.0.1:5180/api/images?limit=1" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
curl -s -o /dev/null -w "原寸  : %{size_download} bytes  %{time_total}s\n" "http://127.0.0.1:5180/api/image/$ID"
curl -s -o /dev/null -w "w=1280: %{size_download} bytes  %{time_total}s (初回)\n" "http://127.0.0.1:5180/api/image/$ID?w=1280"
curl -s -o /dev/null -w "w=1280: %{size_download} bytes  %{time_total}s (キャッシュ)\n" "http://127.0.0.1:5180/api/image/$ID?w=1280"
ls -la ~/Library/Application\ Support/com.technonet.genimgmanager/web-cache/ | head -3
kill %1
```

Expected: `w=1280` の転送量が原寸より小さい（AI生成画像なら1桁小さいことが多い）。2回目は初回より明確に速い。`web-cache/` に `.webp` ファイルが増えている

- [ ] **Step 13: コミット**

```bash
git add crates/server
git commit -m "$(cat <<'EOF'
feat(server): リサイズ配信とディスクキャッシュを追加

/api/image/{id}?w= で長辺基準の縮小版を返す。幅は許可リストへスナップし、
内容由来のキーでキャッシュする。拡大はせず、原画像が狭ければそのまま返す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- `cargo test --workspace` が緑（src-tauri 64 + gim-core 135 + gim-server 33）
- `npm test` が緑（270件。この計画では Node 側を変更しないので変化なし）
- `cargo run -p gim-server` が起動し、LAN アドレスを表示する
- `curl` で以下がすべて期待どおり返る
  - `/api/health` がスキーマ版と画像件数を返す
  - `/api/directories` がディレクトリ一覧を返す
  - `/api/images`・`/api/images/count`・`/api/images/ids` がクエリ・ソート・ページング・`dirs` を反映する
  - `/api/thumb/{id}`・`/api/image/{id}` が画像を返し、ETag と `Cache-Control: immutable` が付く
  - `/api/image/{id}?w=1280` が原寸より小さい WebP を返し、2回目はキャッシュから返る
  - 不正なパラメータが 400、存在しない ID が 404 を返す
- **スマホの実機から `http://<MacのLAN IP>:5180/api/health` にアクセスできる**（LAN 到達性の確認。ファイアウォールの許可ダイアログが出たら許可する）
- デスクトップ版が同時に起動していても、サーバ側の読み取りが失敗しない

## リスク

**WAL データベースへの読み取り専用接続が開けない場合**（Task 1 Step 6 で判明する）: `library.db` を起動時にキャッシュディレクトリへコピーして読む方式へ退避する。デスクトップ版の更新はサーバ再起動で反映されることになる。この分岐が計画全体で最も影響が大きいため Task 1 に置いている。

**`spawn_blocking` のスレッド滞留**: 到達できないネットワークドライブへのリクエストがタイムアウトしても、ブロッキングスレッドは処理完了まで解放されない。多発するとブロッキングプールを食い潰す。この段階では許容し、実運用で問題が出たら専用のスレッドプールか、`fs_guard.rs` と同じ「別スレッド + チャネル」方式へ移す。

## 計画3への申し送り

- `rust-embed` による `web/dist` の埋め込みと `build.rs` での存在確認は計画3で行う
- 開発時は Vite dev server の `/api` を `localhost:5180` へプロキシする
- クライアントは `min(viewport幅 × devicePixelRatio, 2560)` から `w` を選ぶ
- ディレクトリのチェックを全部外した状態は `?dirs=`（空文字列）として送る。`dirs` を省略するとデスクトップ版の表示設定に従うので、意味が変わる
- `[workspace.dependencies]` への依存集約は、`crates/server` が加わったこの時点でやるのが最適だったが、計画2のスコープを膨らませないため見送った。計画3で `rusqlite` / `serde` / `image` / `webp` / `thiserror` を集約するとよい
