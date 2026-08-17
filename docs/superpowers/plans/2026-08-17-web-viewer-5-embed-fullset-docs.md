# web ビューア 計画5（単一バイナリ化・全件再生・ドキュメント）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gim-server` を web フロント同梱の単一バイナリにし、スライドショーを検索結果全体へ広げ、利用者向けの操作説明を用意して web ビューアを完成させる。

**Architecture:** サーバ側は API を `Router::nest("/api", …)` へ束ね、その外側に `rust-embed` で埋め込んだ `web/dist` を SPA として配信するフォールバックを置く。フロント側はスライドショーの再生順序を `/api/images/ids` が返す全件 ID 列の上に作り、表示に必要な行（ファイル名・寸法）は 40 件単位の窓で必要になった時だけ取得する。

**Tech Stack:** Rust 2021 / axum 0.8 / rust-embed 8 / React 19 / TypeScript 5.8 / zustand 5 / vitest 4

**Spec:** `docs/superpowers/specs/2026-08-16-web-viewer-design.md`（実装フェーズ8＋計画4からの申し送り）

## Global Constraints

- `library.db` へは一切書き込まない。サーバは `gim_core::db::open_read_only` でのみ開く。
- `src/` と `src-tauri/` は変更しない。この計画はデスクトップ版に手を入れない。
- `cargo fmt` の全体適用は禁止。リポジトリは rustfmt 未整形なので、周囲のスタイルに手で合わせる。
- パッケージマネージャは **pnpm**。`npm install` は `workspace:*` を解決できないので使わない。`package-lock.json` は触らない。
- アプリ版数は `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `Cargo.lock` の4ファイルに分散し、`npm run bump` 以外で変更しない。`crates/*` は `version = "0.0.0"` 固定で bump の対象外。
- サーバに認証は無い。LAN 内利用が前提で、応答に内部情報（絶対パス・SQL 断片・システムエラー文）を載せない。
- コードコメントには非自明な WHY だけを書く。WHAT・変更履歴・タスクID参照は書かない。
- コミットメッセージは Conventional Commits のプリフィックス（`feat:` / `fix(server):` など）を英語、続く要約を日本語で書く。
- テスト対象のロジックは UI/IO から純粋関数へ切り出す。Rust は各モジュールの `#[cfg(test)]` インラインテスト（別 `tests/` は作らない）。

## 仕様からの逸脱（この計画で確定させる）

**仕様 104 行目**は `crates/server/build.rs` が `web/dist` の不在時に「失敗する」としているが、この計画では **`web/dist/index.html` に案内文のプレースホルダを作って `cargo::warning` を出し、ビルドは通す**。`dist/` は `.gitignore` 済みでクローン直後には存在せず、失敗させると `cargo test --workspace` / `cargo clippy --workspace`（CLAUDE.md が案内する開発コマンド）が JS のビルド無しには一切動かなくなる。開発者への通知は「ビルド時の警告」＋「ブラウザに出る案内文」で足り、無関係な Rust 作業を止める必要はない。Task 9 で仕様書の当該行を実装に合わせて直す。

**tsconfig の project references は採用しない。** `packages/shared` は仕様 155 行目でビルド段を持たない決定になっており、`composite: true` は宣言ファイルの出力を要求するのでこの決定と両立しない。Task 9 では代わりに `npm run check` で両 tsconfig の型検査を並べる。

---

## ファイル構成

**新規:**

| ファイル | 責務 |
|---|---|
| `crates/server/build.rs` | `web/dist/index.html` の存在確認とプレースホルダ生成、再ビルド条件の宣言 |
| `crates/server/src/extract.rs` | `ApiQuery<T>` / `ApiPath<T>`（拒否を `ApiError` に変換する抽出器） |
| `crates/server/src/webui.rs` | 埋め込んだ `web/dist` の配信と SPA フォールバック |
| `web/src/util/rowWindow.ts` | sort 順インデックス→行の窓取得キャッシュ |
| `web/src/util/rowWindow.test.ts` | 同テスト |
| `web/src/hooks/useSlideshowTimer.ts` | 自動送りの計時 |
| `web/src/hooks/useViewerKeys.ts` | ビューアのキーボード操作 |
| `web/src/components/Viewer.slideshow.test.tsx` | 自動送りの回帰テスト |
| `docs/web-viewer-usage.html` | 利用者向け操作説明 |

**変更:**

| ファイル | 変更内容 |
|---|---|
| `crates/server/src/error.rs` | `Internal` からペイロードを外し、`ApiError::internal(ctx, detail)` を追加 |
| `crates/server/src/state.rs` `crates/server/src/fileserve.rs` `crates/server/src/resize.rs` | `Internal(format!(…))` の呼び出し置換 |
| `crates/server/src/hostcheck.rs` | 閉じていない角括弧を拒否する |
| `crates/server/src/routes/mod.rs` | API を `nest("/api", …)` へ、外側に SPA フォールバック |
| `crates/server/src/routes/images.rs` `crates/server/src/routes/media.rs` | `ApiQuery` / `ApiPath` へ差し替え |
| `crates/server/src/test_support.rs` | 埋め込み資産に依存しないルータ組み立ての補助を追加 |
| `crates/server/Cargo.toml` | `rust-embed` 依存と `build.rs` の宣言 |
| `web/src/store/useViewerStore.ts` | `ids` / `idsSeq` / `setIds` を追加 |
| `web/src/components/Viewer.tsx` | ids と行キャッシュを使い、フックへ分割 |
| `web/src/storage.ts` | `sanitizePrefs` の `sort` / `dir` に型ガード |
| `web/src/components/FilterSheet.tsx` | 日付範囲の注記 |
| `package.json` | `check` スクリプト |
| `docs/CLAUDE.md` | 存在しないファイルへの参照を実在のものへ |
| `docs/superpowers/specs/2026-08-16-web-viewer-design.md` | localStorage の記述と build.rs の記述を実装に合わせる |

---

## Task 1: サーバの応答から内部情報を消し、Host 判定を締める

**Files:**
- Modify: `crates/server/src/error.rs:5-55`
- Modify: `crates/server/src/state.rs:40-43`
- Modify: `crates/server/src/fileserve.rs:25-31`, `crates/server/src/fileserve.rs:46-52`
- Modify: `crates/server/src/resize.rs:49-59`, `crates/server/src/resize.rs:71-78`, `crates/server/src/resize.rs:106-109`
- Modify: `crates/server/src/hostcheck.rs:37-60`
- Test: 各ファイルのインライン `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: なし
- Produces: `ApiError::Internal`（ペイロード無しのユニットバリアント）、`ApiError::internal(context: &str, detail: impl std::fmt::Display) -> ApiError`

`ApiError::Internal(String)` は7箇所で `format!` の結果を受けており、`DBを開けません: unable to open database file` のように絶対パスやシステムエラー文がそのままブラウザへ出る。認証なしで LAN に公開するサーバなので、詳細は標準エラーへ出して応答は定型文だけにする。バリアントからペイロードを外すことで、後から `format!` を渡す実装が書けなくなる。

- [ ] **Step 1: 応答本文に詳細が出ないことを確かめる失敗するテストを書く**

`crates/server/src/state.rs` の `mod tests` を新規に追加する。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn db_open_failure_does_not_leak_the_path() {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::new(tmp.path().join("no-such-dir"));
        let err = state.conn().unwrap_err();

        let res = err.into_response();
        assert_eq!(res.status(), 500);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(
            !body.contains("no-such-dir"),
            "DBのパスが応答に漏れている: {body}"
        );
    }
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test -p gim-server db_open_failure_does_not_leak_the_path`
Expected: FAIL（応答本文に `no-such-dir` が含まれる）

- [ ] **Step 3: `ApiError::Internal` からペイロードを外す**

`crates/server/src/error.rs`：

```rust
#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    NotFound,
    MethodNotAllowed,
    Forbidden(String),
    /// ファイルには届かないが、消えたとは限らない（オフラインの外部ドライブなど）。
    Unavailable,
    /// 詳細は標準エラーへ出し、応答は定型文だけにする。認証なしで LAN へ公開するため、
    /// 絶対パス・SQL断片・システムエラー文をブラウザへ渡さない。
    Internal,
}

impl ApiError {
    /// 内部エラーを記録して `Internal` を返す。`context` は原因を追える程度の短い日本語。
    pub fn internal(context: &str, detail: impl std::fmt::Display) -> Self {
        eprintln!("{context}: {detail}");
        ApiError::Internal
    }
}
```

`into_response` の該当腕を差し替える。

```rust
            ApiError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "内部エラーが発生しました".to_string(),
            ),
```

`From<rusqlite::Error>` は `ApiError::internal` に寄せる。

```rust
impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        ApiError::internal("DBエラー", e)
    }
}
```

- [ ] **Step 4: 7箇所の呼び出しを置き換える**

`crates/server/src/state.rs:41-42`：

```rust
        gim_core::db::open_read_only(&self.db_path)
            .map_err(|e| ApiError::internal("DBを開けません", e))
```

`crates/server/src/fileserve.rs`（2箇所とも同じ形）：

```rust
        Ok(Err(e)) => Err(ApiError::internal("読み出しに失敗しました", e)),
```

`crates/server/src/resize.rs:53`：

```rust
        .map_err(|e| ApiError::internal("リサイズの実行枠を取れません", e))?;
```

`crates/server/src/resize.rs:59`：

```rust
        .map_err(|e| ApiError::internal("リサイズに失敗しました", e))??;
```

`crates/server/src/resize.rs:76`：

```rust
        other => ApiError::internal("画像を読めません", other),
```

`crates/server/src/resize.rs:108`：

```rust
        return Err(ApiError::internal("キャッシュを書けません", e));
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cargo test -p gim-server`
Expected: PASS（既存テストも含めて全緑。`error.rs` の `rusqlite_error_detail_does_not_reach_response_body` もそのまま通る）

Run: `cargo clippy -p gim-server --all-targets`
Expected: 新しい警告が出ないこと

- [ ] **Step 6: コミット**

```bash
git add crates/server/src/error.rs crates/server/src/state.rs crates/server/src/fileserve.rs crates/server/src/resize.rs
git commit -m "fix(server): 500応答から絶対パスやシステムエラー文が漏れないようにする"
```

- [ ] **Step 7: 閉じていない角括弧が許可されてしまう失敗するテストを書く**

`crates/server/src/hostcheck.rs` の `mod tests` に追加する。`extract_hostname` は `[::1` を受けると `]` が無いまま `::1` を返し、IPアドレスリテラルとして許可される。コメントは「壊れた入力として丸ごと返す（どの許可条件にも一致せず拒否される）」と書いてあるので、コメントと実装が食い違っている。

```rust
    #[test]
    fn unclosed_bracket_is_rejected() {
        // 角括弧が閉じていない Host は壊れた入力。中身が IPv6 に見えても許可しない。
        assert!(!host_allowed(Some("[::1"), &[]));
        assert!(!host_allowed(Some("[192.168.0.1"), &[]));
    }

    #[test]
    fn bracketed_ipv6_still_works() {
        assert!(host_allowed(Some("[fe80::1]:5180"), &[]));
        assert!(host_allowed(Some("[::1]"), &[]));
    }
```

- [ ] **Step 8: テストが失敗することを確認**

Run: `cargo test -p gim-server unclosed_bracket_is_rejected`
Expected: FAIL（`[::1` が許可されている）

- [ ] **Step 9: 閉じ括弧が無い場合は丸ごと返す**

`crates/server/src/hostcheck.rs:40-44` を差し替える。

```rust
    if let Some(rest) = h.strip_prefix('[') {
        // 閉じ括弧が無いのは壊れた入力。中身を取り出すと IPv6 リテラルとして
        // 許可されてしまうので、丸ごと返してどの許可条件にも一致させない。
        return match rest.split_once(']') {
            Some((inner, _port)) => inner,
            None => h,
        };
    }
```

- [ ] **Step 10: テストが通ることを確認**

Run: `cargo test -p gim-server hostcheck`
Expected: PASS（既存の IPv6・localhost・`.local`・許可リストのテストも全緑）

- [ ] **Step 11: コミット**

```bash
git add crates/server/src/hostcheck.rs
git commit -m "fix(server): Host ヘッダの閉じていない角括弧を拒否する"
```

---

## Task 2: `ApiQuery<T>` / `ApiPath<T>` でハンドラの定型句を消す

**Files:**
- Create: `crates/server/src/extract.rs`
- Modify: `crates/server/src/main.rs:1-12`（`mod extract;` の追加）
- Modify: `crates/server/src/routes/images.rs:52-96`
- Modify: `crates/server/src/routes/media.rs:16-76`
- Test: `crates/server/src/extract.rs` のインラインテスト＋既存の `malformed_query_returns_json_400` / `invalid_width_is_400`

**Interfaces:**
- Consumes: `ApiError::BadRequest(String)`、`ApiError::internal`（Task 1）
- Produces: `crate::extract::ApiQuery<T>`（`ApiQuery(pub T)`）、`crate::extract::ApiPath<T>`（`ApiPath(pub T)`）。どちらも `FromRequestParts<AppState>` を実装し、抽出失敗時に `ApiError::BadRequest` を返す。

4つのハンドラが `params: Result<Query<T>, QueryRejection>` を受けて `let Query(params) = params?;` と書き開いている。抽出器に寄せると、シグネチャから拒否型が消え、`?` を忘れて `unwrap` する経路も無くなる。

- [ ] **Step 1: 失敗する抽出器のテストを書く**

`crates/server/src/extract.rs` を新規作成し、まずテストだけ書く。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::extract::FromRequestParts;
    use axum::http::Request;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct P {
        n: i64,
    }

    #[tokio::test]
    async fn query_rejection_becomes_bad_request() {
        let (state, _tmp) = test_state();
        let (mut parts, _) = Request::get("/x?n=abc").body(()).unwrap().into_parts();
        let err = ApiQuery::<P>::from_request_parts(&mut parts, &state)
            .await
            .unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));
    }

    #[tokio::test]
    async fn valid_query_is_extracted() {
        let (state, _tmp) = test_state();
        let (mut parts, _) = Request::get("/x?n=7").body(()).unwrap().into_parts();
        let ApiQuery(p) = ApiQuery::<P>::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(p.n, 7);
    }

}
```

あわせて `crates/server/src/routes/media.rs` の `mod tests` に、パス抽出の失敗が 400 になることを確かめるルータ経由のテストを足す。

```rust
    #[tokio::test]
    async fn non_numeric_id_is_400() {
        let (state, _tmp) = test_state_with_files();
        assert_eq!(get_raw(state, "/api/image/abc").await.status(), 400);
    }
```

`use crate::test_support::{get_raw, test_state_with_files, test_state_with_wide_image};` はすでにあるので import の追加は不要。

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test -p gim-server extract`
Expected: FAIL（`ApiQuery` / `ApiPath` が未定義でコンパイルエラー）

- [ ] **Step 3: 抽出器を実装**

`crates/server/src/extract.rs` の先頭に加える。

```rust
//! クエリ・パスの抽出失敗を `ApiError` へ寄せる薄い抽出器。
//! ハンドラのシグネチャに `Result<Query<T>, QueryRejection>` を並べると、
//! `?` を忘れた実装が書けてしまう。

use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::{FromRequestParts, Path, Query};
use axum::http::request::Parts;

pub struct ApiQuery<T>(pub T);

impl<T> FromRequestParts<AppState> for ApiQuery<T>
where
    T: serde::de::DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match Query::<T>::from_request_parts(parts, state).await {
            Ok(Query(v)) => Ok(ApiQuery(v)),
            Err(r) => Err(ApiError::from(r)),
        }
    }
}

pub struct ApiPath<T>(pub T);

impl<T> FromRequestParts<AppState> for ApiPath<T>
where
    T: serde::de::DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match Path::<T>::from_request_parts(parts, state).await {
            Ok(Path(v)) => Ok(ApiPath(v)),
            Err(r) => Err(ApiError::from(r)),
        }
    }
}
```

`crates/server/src/main.rs` のモジュール宣言に `mod extract;` を追加する（アルファベット順で `mod error;` の次）。

- [ ] **Step 4: テストが通ることを確認**

Run: `cargo test -p gim-server extract`
Expected: PASS

- [ ] **Step 5: ハンドラを差し替える**

`crates/server/src/routes/images.rs` の3ハンドラ。`list` を例に示す。`count` / `ids` も同じ形にする。

```rust
pub async fn list(
    State(state): State<AppState>,
    ApiQuery(params): ApiQuery<ListParams>,
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

`use axum::extract::{Query, State};` を `use crate::extract::ApiQuery;` と `use axum::extract::State;` に置き換える。

`crates/server/src/routes/media.rs` の2ハンドラ。

```rust
pub async fn thumb(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<i64>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let info = media_info(&state, id)?;
    // 以降は変更なし
```

```rust
pub async fn image(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<i64>,
    ApiQuery(params): ApiQuery<ImageParams>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let info = media_info(&state, id)?;
    let src = PathBuf::from(&info.path);
    // 以降は変更なし
```

`use axum::extract::{Path, Query, State};` を `use crate::extract::{ApiPath, ApiQuery};` と `use axum::extract::State;` に置き換え、`let Path(id) = id?;` / `let Query(params) = params?;` の行を削除する。

- [ ] **Step 6: HTTP 経路の 400 が変わっていないことを確認**

Run: `cargo test -p gim-server`
Expected: PASS。特に `routes::tests::malformed_query_returns_json_400` と `routes::media::tests::invalid_width_is_400` が通ること（抽出器を通しても 400 の JSON 応答が保たれている証拠）

Run: `cargo clippy -p gim-server --all-targets`
Expected: 新しい警告なし

- [ ] **Step 7: コミット**

```bash
git add crates/server/src/extract.rs crates/server/src/main.rs crates/server/src/routes/images.rs crates/server/src/routes/media.rs
git commit -m "refactor(server): クエリ・パス抽出を ApiQuery/ApiPath へ寄せる"
```

---

## Task 3: API を `Router::nest("/api", …)` 配下へ移す

**Files:**
- Modify: `crates/server/src/routes/mod.rs:21-38`
- Test: `crates/server/src/routes/mod.rs` のインラインテスト

**Interfaces:**
- Consumes: `AppState`
- Produces: `routes::api_router(state: AppState) -> Router<AppState>`（`/api` プレフィックス無しのルートと JSON フォールバックを持つ）、`routes::router(state: AppState) -> Router`（従来通り完成したルータ）

Task 4 で `router` の外側へ SPA フォールバックを付ける。いま `.fallback(not_found)` が全パスを掴んでいるので、まず API を `/api` の下へ隔離して、その中だけを JSON 404 にする。axum 0.8 では **nest したルータが自身の fallback を持つ場合、それが外側の fallback より優先される**（`Router::nest` のドキュメント「Fallback Inheritance with Nesting」）ので、この分離で API と SPA のフォールバックを共存させられる。

- [ ] **Step 1: `/api` 配下と配下以外を区別する失敗するテストを書く**

`crates/server/src/routes/mod.rs` の `mod tests` に追加する。

```rust
    #[tokio::test]
    async fn api_router_is_mounted_under_api_prefix() {
        let (state, _tmp) = test_state();
        // nest 後もエンドポイントの外向き URL は変わらない。
        assert_eq!(get_raw(state.clone(), "/api/health").await.status(), 200);
        assert_eq!(get_raw(state.clone(), "/api/images").await.status(), 200);
        assert_eq!(get_raw(state.clone(), "/api/images/count").await.status(), 200);
        assert_eq!(get_raw(state, "/api/images/ids").await.status(), 200);
    }
```

`/api` 配下の未知パスが JSON の 404 のままであることは既存の `unknown_path_returns_json_404` が守る。外側の fallback と共存することは Task 4 で確かめる（このタスクの時点では外側も `not_found` なので区別できない）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test -p gim-server api_router`
Expected: FAIL（`api_router` が未定義でコンパイルエラー）

- [ ] **Step 3: `api_router` を切り出す**

`crates/server/src/routes/mod.rs:21-38` を差し替える。

```rust
/// `/api` の下に載せるルータ。プレフィックスは含まない。
/// 自前の fallback を持たせているのは、外側に SPA のフォールバックを置いても
/// `/api/*` の未知パスは JSON の 404 のままにするため（nest したルータの
/// fallback は外側の fallback より優先される）。
pub fn api_router(_state: AppState) -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        .route("/directories", get(directories::list))
        .route("/images", get(images::list))
        .route("/images/count", get(images::count))
        .route("/images/ids", get(images::ids))
        .route("/thumb/{id}", get(media::thumb))
        .route("/image/{id}", get(media::image))
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", api_router(state.clone()))
        .fallback(not_found)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::hostcheck::host_guard,
        ))
        .layer(axum::middleware::from_fn(crate::logging::access_log))
        .with_state(state)
}
```

`_state` 引数を残しているのは、Task 4 でこの関数を呼ぶ側のシグネチャを揺らさないため。使わないなら引数を落として `api_router() -> Router<AppState>` にしてよい（その場合はテストと Task 4 の呼び出しも合わせる）。**判断は実装者に委ねる。落とす方を選んだら、テストの `api_router(state)` を `api_router()` に直すこと。**

- [ ] **Step 4: テストが通ることを確認**

Run: `cargo test -p gim-server`
Expected: PASS。特に既存の `unknown_path_returns_json_404`（`/api/nope`）・`wrong_method_returns_json_405`（`POST /api/images`）・`disallowed_host_header_returns_json_403` が通ること

- [ ] **Step 5: コミット**

```bash
git add crates/server/src/routes/mod.rs
git commit -m "refactor(server): API を /api の nest 配下へまとめる"
```

---

## Task 4: `rust-embed` で web フロントを同梱し SPA として配信する

**Files:**
- Create: `crates/server/build.rs`
- Create: `crates/server/src/webui.rs`
- Modify: `crates/server/Cargo.toml`
- Modify: `crates/server/src/main.rs`（`mod webui;`）
- Modify: `crates/server/src/routes/mod.rs`（外側の fallback を SPA へ）
- Test: `crates/server/src/webui.rs` のインラインテスト＋`crates/server/src/routes/mod.rs` のインラインテスト

**Interfaces:**
- Consumes: `routes::api_router`（Task 3）、`ApiError`（Task 1）
- Produces: `webui::spa_handler(uri: axum::http::Uri) -> axum::response::Response`、`webui::content_type_for_path(path: &str) -> &'static str`

`gim-server` 1つで配れるようにする。`rust-embed` は debug ビルドでは実行時にディスクから読み、release ビルドではバイナリへ埋め込む（`debug-embed` フィーチャを有効にしない場合の既定挙動）ので、開発中は `pnpm -C web build` の結果が再ビルド無しで反映される。

- [ ] **Step 1: 依存と build.rs を追加**

`crates/server/Cargo.toml` の `[package]` に `build = "build.rs"` を加え、`[dependencies]` に `rust-embed` を足す。

```toml
[package]
name = "gim-server"
version = "0.0.0"
edition = "2021"
build = "build.rs"
```

```toml
rust-embed = "8"
```

`crates/server/build.rs` を新規作成する。

```rust
use std::path::PathBuf;

/// `rust_embed` の derive は対象フォルダが無いとコンパイル時に失敗する。
/// `web/dist` は .gitignore 対象でクローン直後には存在しないため、
/// 案内文だけの index.html を置いてビルドを通す。ここで失敗させると
/// `cargo test --workspace` が JS のビルド無しに一切動かなくなる。
fn main() {
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    let index = dist.join("index.html");

    println!("cargo::rerun-if-changed=../../web/dist");

    if index.exists() {
        return;
    }

    println!(
        "cargo::warning=web/dist が見つかりません。`pnpm -C web build` を実行すると web ビューアが同梱されます。"
    );
    if let Err(e) = std::fs::create_dir_all(&dist) {
        panic!("{} を作れません: {e}", dist.display());
    }
    let placeholder = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">\
<title>gen-img-manager</title></head><body>\
<p>web フロントがビルドされていません。<code>pnpm -C web build</code> を実行してから \
<code>cargo build --release -p gim-server</code> をやり直してください。</p>\
</body></html>\n";
    if let Err(e) = std::fs::write(&index, placeholder) {
        panic!("{} を書けません: {e}", index.display());
    }
}
```

- [ ] **Step 2: 配信の失敗するテストを書く**

`crates/server/src/webui.rs` を新規作成し、まずテストだけ書く。埋め込まれる内容は `web/dist` の実物なので、テストは「必ず存在する `index.html`」と「拡張子から決まる Content-Type」「未知パスが index.html に落ちる」だけを見る。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header, StatusCode};
    use http_body_util::BodyExt;

    async fn body_of(res: axum::response::Response) -> String {
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8_lossy(&bytes).to_string()
    }

    #[test]
    fn content_type_comes_from_extension() {
        assert_eq!(content_type_for_path("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type_for_path("assets/a.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type_for_path("assets/a.css"), "text/css; charset=utf-8");
        assert_eq!(content_type_for_path("favicon.svg"), "image/svg+xml");
        assert_eq!(content_type_for_path("x.bin"), "application/octet-stream");
    }

    #[tokio::test]
    async fn root_serves_index_html() {
        let res = spa_handler("/".parse().unwrap()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        assert!(body_of(res).await.contains("<!doctype html"));
    }

    #[tokio::test]
    async fn unknown_path_falls_back_to_index_html() {
        // SPA なので、ブックマークされた任意のパスでも index.html を返して
        // クライアント側のルーティングに任せる。
        let res = spa_handler("/viewer/123".parse().unwrap()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
    }

    #[tokio::test]
    async fn index_html_is_not_cached_forever() {
        // 資産のファイル名はハッシュ付きだが index.html は固定名。
        // immutable にすると新しいフロントが永久に降りてこない。
        let res = spa_handler("/".parse().unwrap()).await;
        let cc = res.headers()[header::CACHE_CONTROL].to_str().unwrap();
        assert!(cc.contains("no-cache"), "index.html の Cache-Control: {cc}");
    }

    #[tokio::test]
    async fn responses_carry_an_etag() {
        let res = spa_handler("/".parse().unwrap()).await;
        assert!(res.headers().contains_key(header::ETAG));
    }
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cargo test -p gim-server webui`
Expected: FAIL（`spa_handler` / `content_type_for_path` が未定義でコンパイルエラー）

- [ ] **Step 4: 配信を実装**

`crates/server/src/webui.rs` の先頭に加える。

```rust
//! `web/dist` をバイナリへ同梱して配信する。
//! debug ビルドでは rust-embed が実行時にディスクから読むので、
//! `pnpm -C web build` の結果が再ビルド無しで反映される。

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../../web/dist/"]
struct WebAssets;

/// Vite が出す資産の拡張子だけを見る。`mime_guess` を足すほどの種類は無い。
pub fn content_type_for_path(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ico") => "image/vnd.microsoft.icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// 資産はファイル名にハッシュが入るので永続キャッシュしてよい。
/// index.html は固定名なので、毎回サーバに確認させる。
fn cache_control_for(path: &str) -> &'static str {
    if path == "index.html" {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    }
}

const INDEX: &str = "index.html";

pub async fn spa_handler(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    // 実体があればそれを返し、無ければ index.html。クライアント側のルーティングに任せる。
    let (path, file) = match WebAssets::get(requested) {
        Some(f) => (requested, f),
        None => match WebAssets::get(INDEX) {
            Some(f) => (INDEX, f),
            // build.rs が index.html を必ず用意するので、ここへは来ない。
            None => return (StatusCode::NOT_FOUND, "web フロントが同梱されていません").into_response(),
        },
    };

    let etag = format!("\"{}\"", hex_of(&file.metadata.sha256_hash()));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type_for_path(path).to_string()),
            (header::CACHE_CONTROL, cache_control_for(path).to_string()),
            (header::ETAG, etag),
        ],
        file.data.into_owned(),
    )
        .into_response()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
```

`crates/server/src/main.rs` のモジュール宣言に `mod webui;` を追加する（`mod test_support;` の前）。

`If-None-Match` を見た 304 応答はこのタスクの範囲外。`ETag` を付けるところまでで、ブラウザ側の再検証は次の機会に足す。

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm -C web build`（`web/dist` を実物にしてから測る）
Run: `cargo test -p gim-server webui`
Expected: PASS

- [ ] **Step 6: ルータの外側フォールバックを SPA にする**

`crates/server/src/routes/mod.rs` の `router` を差し替える。

```rust
pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", api_router(state.clone()))
        // /api 以外はすべて web フロント。SPA なので未知パスも index.html へ落とす。
        .fallback(crate::webui::spa_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::hostcheck::host_guard,
        ))
        .layer(axum::middleware::from_fn(crate::logging::access_log))
        .with_state(state)
}
```

- [ ] **Step 7: 両方のフォールバックが共存する失敗するテストを書く**

`crates/server/src/routes/mod.rs` の `mod tests` に追加する。

```rust
    #[tokio::test]
    async fn api_unknown_path_stays_json_while_others_serve_the_spa() {
        let (state, _tmp) = test_state();
        // /api 配下は JSON の 404（クライアントが res.json() を無条件に呼べる状態を保つ）
        assert_json_error(get_raw(state.clone(), "/api/nope").await, 404).await;

        // それ以外は index.html
        let res = get_raw(state, "/some/deep/link").await;
        assert_eq!(res.status(), 200);
        assert_eq!(
            res.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
    }
```

- [ ] **Step 8: テストが通ることを確認**

Run: `cargo test -p gim-server`
Expected: PASS。既存の `unknown_path_returns_json_404` も通り続けること

Run: `cargo clippy -p gim-server --all-targets`
Expected: 新しい警告なし

- [ ] **Step 9: 実バイナリで確認**

```bash
pnpm -C web build
cargo build --release -p gim-server
# 埋め込みが効いていることを見るため、dist を退避してから起動する。
mv web/dist /tmp/gim-dist-check
./target/release/gim-server --port 5182 &
sleep 1
curl -s -o /dev/null -w '/            %{http_code} %{content_type}\n' http://127.0.0.1:5182/
curl -s -o /dev/null -w '/api/health  %{http_code} %{content_type}\n' http://127.0.0.1:5182/api/health
curl -s -o /dev/null -w '/api/nope    %{http_code} %{content_type}\n' http://127.0.0.1:5182/api/nope
curl -s -o /dev/null -w '/deep/link   %{http_code} %{content_type}\n' http://127.0.0.1:5182/deep/link
kill %1
mv /tmp/gim-dist-check web/dist
```

Expected:
- `/` → `200 text/html; charset=utf-8`（`web/dist` が無い状態でも出る＝埋め込みが効いている）
- `/api/health` → `200 application/json`
- `/api/nope` → `404 application/json`
- `/deep/link` → `200 text/html; charset=utf-8`

`web/dist` を必ず元へ戻すこと（戻さないと次の `cargo build` が build.rs のプレースホルダで上書きする）。プロセスを落とし、`lsof -ti :5182` が空であることを確認する。**結果はそのまま貼ってレポートへ書く。**

- [ ] **Step 10: コミット**

```bash
git add crates/server/Cargo.toml crates/server/build.rs crates/server/src/webui.rs crates/server/src/main.rs crates/server/src/routes/mod.rs Cargo.lock
git commit -m "feat(server): web フロントを同梱して単一バイナリで配信する"
```

---

## Task 5: 行の窓取得（`rowWindow.ts`）

**Files:**
- Create: `web/src/util/rowWindow.ts`
- Test: `web/src/util/rowWindow.test.ts`

**Interfaces:**
- Consumes: `ImageDto`（`web/src/api/images.ts`）
- Produces:
  - `WINDOW_SIZE: number`（= 40）
  - `windowOffsetFor(index: number, size?: number): number`
  - `interface RowWindow { get(index: number): ImageDto | undefined; ensure(index: number): void; clear(): void; }`
  - `createRowWindow(fetchPage: (offset: number, limit: number) => Promise<ImageDto[]>, onChange: () => void, size?: number): RowWindow`

Task 7 でスライドショーの再生順序を全件 ID の上に置くと、`useQueryStore.results`（先頭200件）に無い位置へ跳ぶ。sort 順は安定していて **results のインデックス＝sort 順のインデックス** なので、位置 `k` の行は `/api/images?…&limit=40&offset=<kを含む窓の先頭>` で取れる。窓を整列させるのは、隣の位置へ動くたびに別の窓を取り直さないため。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/util/rowWindow.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { createRowWindow, windowOffsetFor, WINDOW_SIZE } from "./rowWindow";
import type { ImageDto } from "../api/images";

function row(id: number): ImageDto {
  return {
    id,
    filename: `${id}.png`,
    width: 100,
    height: 100,
    rating: null,
    created_at: null,
    modified_at: null,
    source_tool: "a1111",
    model: null,
  };
}

/** offset から limit 件を返す偽の取得。呼ばれた offset を記録する。 */
function fakeFetch() {
  const calls: number[] = [];
  const fn = (offset: number, limit: number) => {
    calls.push(offset);
    return Promise.resolve(Array.from({ length: limit }, (_, i) => row(offset + i)));
  };
  return { fn, calls };
}

describe("windowOffsetFor", () => {
  it("窓の先頭へ整列する", () => {
    expect(windowOffsetFor(0, 40)).toBe(0);
    expect(windowOffsetFor(39, 40)).toBe(0);
    expect(windowOffsetFor(40, 40)).toBe(40);
    expect(windowOffsetFor(5231, 40)).toBe(5200);
  });

  it("既定の窓幅を使う", () => {
    expect(windowOffsetFor(WINDOW_SIZE)).toBe(WINDOW_SIZE);
  });
});

describe("createRowWindow", () => {
  it("取得前は undefined、取得後は行を返す", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const w = createRowWindow(fn, onChange, 40);

    expect(w.get(5231)).toBeUndefined();
    w.ensure(5231);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(w.get(5231)?.id).toBe(5231);
    // 窓の先頭も入っている
    expect(w.get(5200)?.id).toBe(5200);
  });

  it("窓の先頭へ整列した offset で取りにいく", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(5231);
    await vi.waitFor(() => expect(calls).toEqual([5200]));
  });

  it("同じ窓を二重に取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(5231);
    w.ensure(5232);
    w.ensure(5200);
    await vi.waitFor(() => expect(calls).toEqual([5200]));
  });

  it("取得済みの位置では取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(0);
    await vi.waitFor(() => expect(w.get(0)).toBeDefined());
    w.ensure(0);
    expect(calls).toEqual([0]);
  });

  it("負の位置は取りにいかない", () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(-1);
    expect(calls).toEqual([]);
  });

  it("取得に失敗しても投げず、次の ensure で取り直せる", async () => {
    const calls: number[] = [];
    let fail = true;
    const fn = (offset: number, limit: number) => {
      calls.push(offset);
      if (fail) return Promise.reject(new Error("network"));
      return Promise.resolve(Array.from({ length: limit }, (_, i) => row(offset + i)));
    };
    const w = createRowWindow(fn, () => {}, 40);

    w.ensure(0);
    await vi.waitFor(() => expect(calls).toEqual([0]));
    expect(w.get(0)).toBeUndefined();

    fail = false;
    w.ensure(0);
    await vi.waitFor(() => expect(w.get(0)?.id).toBe(0));
  });

  it("clear で取得済みの行を捨てる", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const w = createRowWindow(fn, onChange, 40);
    w.ensure(0);
    await vi.waitFor(() => expect(w.get(0)).toBeDefined());

    w.clear();

    expect(w.get(0)).toBeUndefined();
    expect(onChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run web/src/util/rowWindow.test.ts`
Expected: FAIL（`./rowWindow` が解決できない）

- [ ] **Step 3: 実装**

`web/src/util/rowWindow.ts`：

```ts
import type { ImageDto } from "../api/images";

/** 一度に取る行数。1件ずつ取ると、飛ばし見のたびに往復が増える。 */
export const WINDOW_SIZE = 40;

/**
 * index を含む窓の先頭 offset。窓を整列させないと、隣の位置へ動くたびに
 * ずれた窓を取り直して同じ行を何度も引くことになる。
 */
export function windowOffsetFor(index: number, size = WINDOW_SIZE): number {
  return Math.floor(index / size) * size;
}

export interface RowWindow {
  /** sort 順インデックスの行。まだ無ければ undefined。 */
  get(index: number): ImageDto | undefined;
  /** index を含む窓を取りにいく。取得済み・取得中なら何もしない。 */
  ensure(index: number): void;
  clear(): void;
}

/**
 * sort 順インデックスから行を引くキャッシュ。`results` に無い位置の行を、
 * 必要になった窓だけ取ってくる。
 *
 * `onChange` は行が増えた／捨てられたときに呼ぶ。React 側の再描画の契機で、
 * この モジュール自身は React に依存しない。
 */
export function createRowWindow(
  fetchPage: (offset: number, limit: number) => Promise<ImageDto[]>,
  onChange: () => void,
  size = WINDOW_SIZE,
): RowWindow {
  const rows = new Map<number, ImageDto>();
  const inflight = new Set<number>();

  return {
    get: (index) => rows.get(index),

    ensure: (index) => {
      if (index < 0 || rows.has(index)) return;
      const offset = windowOffsetFor(index, size);
      if (inflight.has(offset)) return;
      inflight.add(offset);
      void fetchPage(offset, size)
        .then((page) => {
          page.forEach((r, i) => rows.set(offset + i, r));
          onChange();
        })
        .catch(() => {
          // 行が取れなくても画像そのものは ID から表示できる。
          // onChange を呼ばないのは、失敗のたびに再描画→再取得で回り続けないため。
        })
        .finally(() => {
          inflight.delete(offset);
        });
    },

    clear: () => {
      rows.clear();
      inflight.clear();
      onChange();
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run web/src/util/rowWindow.test.ts`
Expected: PASS（9 tests）

Run: `pnpm -C web exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add web/src/util/rowWindow.ts web/src/util/rowWindow.test.ts
git commit -m "feat(web): sort順インデックスから行を窓取得するキャッシュを追加"
```

---

## Task 6: `useViewerStore` を全件 ID ベースにする

**Files:**
- Modify: `web/src/store/useViewerStore.ts`
- Test: `web/src/store/useViewerStore.test.ts`（既存に追記）

**Interfaces:**
- Consumes: `buildOrder` / `mulberry32` / `step`（`@gim/shared/playlist`）
- Produces: `useViewerStore` に以下を追加
  - `ids: number[]` — 検索結果全体の画像 ID 列（sort 順）。空なら未取得。
  - `idsSeq: number | null` — `ids` を取った時点の `useQueryStore.seq`。
  - `setIds(ids: number[], seq: number, seed?: number): void`

`order` の意味は変えない（**sort 順インデックスの並び**）。変わるのは長さの根拠だけで、`ids` を得たあとは `results.length` ではなく `ids.length` 全体を覆う。`setIds` で並びを作り直すのは、シャッフル時に「先頭200件の中のシャッフル → 残り全部」という偏った並びを避け、全件の一様シャッフルにするため。作り直しても **いま見ている画像はそのまま見せ続ける**。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/store/useViewerStore.test.ts:4-17` の `beforeEach` にある `useViewerStore.setState({ ... })` へ `ids: [], idsSeq: null,` を追加する（追加しないとテスト間で `ids` が漏れる）。そのうえで下記を追記する。

```ts
describe("setIds", () => {
  it("並びを全件へ広げ、いま見ている画像は変わらない", () => {
    useViewerStore.setState({ shuffle: false, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(3, 200);
    expect(useViewerStore.getState().order.length).toBe(200);

    const ids = Array.from({ length: 17000 }, (_, i) => 1000 + i);
    useViewerStore.getState().setIds(ids, 1);

    const s = useViewerStore.getState();
    expect(s.order.length).toBe(17000);
    expect(s.idsSeq).toBe(1);
    // シャッフルしていないので order は昇順。位置3のまま。
    expect(s.order[s.pos]).toBe(3);
    expect(s.ids[s.order[s.pos]]).toBe(1003);
  });

  it("シャッフル時も、いま見ている画像を見せ続ける", () => {
    useViewerStore.setState({ shuffle: true, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(7, 200, 1);
    const before = useViewerStore.getState();
    const shownSortedIndex = before.order[before.pos];

    const ids = Array.from({ length: 5000 }, (_, i) => i);
    useViewerStore.getState().setIds(ids, 2, 42);

    const after = useViewerStore.getState();
    expect(after.order.length).toBe(5000);
    expect(after.order[after.pos]).toBe(shownSortedIndex);
  });

  it("シャッフル時は全件をまたいだ並びになる", () => {
    useViewerStore.setState({ shuffle: true, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(0, 200, 1);

    const ids = Array.from({ length: 5000 }, (_, i) => i);
    useViewerStore.getState().setIds(ids, 2, 42);

    const order = useViewerStore.getState().order;
    // 先頭200件だけが前半に固まっていない＝増分追加ではなく作り直しになっている。
    const firstTwoHundredInFrontHalf = order
      .slice(0, 2500)
      .filter((i) => i < 200).length;
    expect(firstTwoHundredInFrontHalf).toBeLessThan(180);
    // 重複が無い
    expect(new Set(order).size).toBe(5000);
  });

  it("0件なら並びを触らず、記録だけして従来の経路へ落とす", () => {
    useViewerStore.setState({ shuffle: false, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(2, 10);

    useViewerStore.getState().setIds([], 3);

    const s = useViewerStore.getState();
    expect(s.ids).toEqual([]);
    expect(s.idsSeq).toBe(3);
    expect(s.open).toBe(true);
    expect(s.order.length).toBe(10);
    expect(s.pos).toBe(2);
  });
});

describe("invalidateIds", () => {
  it("ids だけを捨て、表示中の並びと位置は保つ", () => {
    useViewerStore.setState({ shuffle: false, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(3, 200);
    useViewerStore.getState().setIds(
      Array.from({ length: 500 }, (_, i) => i),
      1,
    );
    const posBefore = useViewerStore.getState().pos;
    const orderLenBefore = useViewerStore.getState().order.length;

    useViewerStore.getState().invalidateIds();

    const s = useViewerStore.getState();
    expect(s.ids).toEqual([]);
    expect(s.idsSeq).toBeNull();
    expect(s.open).toBe(true);
    expect(s.pos).toBe(posBefore);
    expect(s.order.length).toBe(orderLenBefore);
  });
});

describe("go", () => {
  it("ループ有効なら先頭から前へで末尾へ回る", () => {
    useViewerStore.setState({ shuffle: false, loop: true, ids: [], idsSeq: null });
    useViewerStore.getState().openAt(0, 5);
    expect(useViewerStore.getState().pos).toBe(0);

    useViewerStore.getState().go(-1);

    expect(useViewerStore.getState().pos).toBe(4);
    expect(useViewerStore.getState().playing).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run web/src/store/useViewerStore.test.ts`
Expected: FAIL（`setIds` が存在しない）

- [ ] **Step 3: 実装**

`web/src/store/useViewerStore.ts` の `interface ViewerState` に追加する。

```ts
  /** 検索結果全体の画像ID列（sort 順）。空なら未取得で、order は results の長さに留まる。 */
  ids: number[];
  /** ids を取った時点の useQueryStore.seq。クエリが変わったら取り直す目印。 */
  idsSeq: number | null;
```

```ts
  setIds: (ids: number[], seq: number, seed?: number) => void;
  /** クエリが変わって sort 順インデックスの意味が変わったときに ids を捨てる。 */
  invalidateIds: () => void;
```

初期値に `ids: [], idsSeq: null,` を加え、アクションを追加する（`syncLength` の直後に置く）。

```ts
  setIds: (ids, seq, seed = Date.now()) => {
    if (ids.length === 0) {
      // 0件は「本当に0件」か「取れなかった」。どちらでも並びは触らず、
      // results の範囲で送る従来の経路に落とす。0件での閉じ処理は syncLength が担う。
      set({ ids, idsSeq: seq });
      return;
    }
    const { order, pos, shuffle } = get();
    // 増分を末尾に足すのではなく作り直す。シャッフル時に増分追加だと
    // 「先頭200件のシャッフル → 残り全部」という偏った並びになる。
    // 作り直しても、いま見ている画像（sort順インデックス）はそのまま見せ続ける。
    const current = order[pos] ?? 0;
    const next = makeOrder(ids.length, shuffle, seed);
    set({ ids, idsSeq: seq, order: next, pos: Math.max(0, next.indexOf(current)) });
  },

  // order と pos は触らない。ここで並びを壊すと、取り直しが終わるまで
  // 表示が飛ぶ。ids を空にしておけば、その間は results の範囲で読まれる。
  invalidateIds: () => set({ ids: [], idsSeq: null }),
```

`close` は `ids` を消さない。クエリが変わっていなければ次に開くときそのまま使えるし、変わっていれば `invalidateIds` と `idsSeq` の不一致で取り直される。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run web/src/store/useViewerStore.test.ts`
Expected: PASS（既存テストも全緑）

Run: `pnpm -C web exec tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add web/src/store/useViewerStore.ts web/src/store/useViewerStore.test.ts
git commit -m "feat(web): ビューアの再生順序を検索結果全体のID列の上に作れるようにする"
```

---

## Task 7: `Viewer.tsx` をフックへ分割し、全件 ID と行キャッシュを配線する

**Files:**
- Create: `web/src/hooks/useSlideshowTimer.ts`
- Create: `web/src/hooks/useViewerKeys.ts`
- Modify: `web/src/components/Viewer.tsx`
- Test: `web/src/components/Viewer.keyboard.test.tsx`（既存。import 先の変更に追随）
- Test: `web/src/components/Viewer.test.tsx`（既存。ids 取得のモックを足す）

**Interfaces:**
- Consumes: `createRowWindow` / `WINDOW_SIZE`（Task 5）、`useViewerStore.setIds` / `ids` / `idsSeq`（Task 6）、`listImageIds` / `listImages`（`web/src/api/images.ts`）
- Produces:
  - `useSlideshowTimer(settled: boolean): void`
  - `useViewerKeys(opts: { enabled: boolean; rootRef: React.RefObject<HTMLElement | null> }): void`

`Viewer.tsx` は表示・キーボード・計時・先読み・ページング・シートを1ファイルで抱えている。キーボードと計時をフックへ出してから、残った表示部分を ids ベースに繋ぎ替える。

**行が届く前の表示について**: 行（ファイル名・寸法）が未取得の位置では、`w` をビューポートの長辺から決めて先に画像を出す。プレースホルダで待たせないのは、行の取得が失敗したときにスライドショーが永久に止まるのを避けるため。行が届くと `w` は `containedLongEdge` 基準に切り替わるが、ビューポートより大きい画像では同じ値に落ち着く（`pickWidth` が4段階へ丸めるため）ので、余分な往復が起きるのはビューポートより小さい画像に限られる。

- [ ] **Step 1: 停止中は自動送りしないことを確かめる失敗するテストを書く**

`web/src/components/Viewer.slideshow.test.tsx` を新規作成する。

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Viewer } from "./Viewer";
import { useViewerStore } from "../store/useViewerStore";
import { useQueryStore } from "../store/useQueryStore";
import type { ImageDto } from "../api/images";
import * as imagesApi from "../api/images";

function row(id: number): ImageDto {
  return {
    id,
    filename: `${id}.png`,
    width: 1024,
    height: 768,
    rating: null,
    created_at: null,
    modified_at: null,
    source_tool: "a1111",
    model: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(imagesApi, "listImageIds").mockResolvedValue([1, 2, 3]);
  // 3件すべて results にあるので窓取得は走らないはず。走ったら気づけるように監視する。
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  useQueryStore.setState({ results: [row(1), row(2), row(3)], total: 3, exhausted: true, seq: 1 });
  useViewerStore.setState({
    open: false,
    ids: [],
    idsSeq: null,
    order: [],
    pos: 0,
    shuffle: false,
    loop: true,
    intervalSec: 3,
    playing: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * 表示中の画像の onLoad を発火させて「読み込みが決着した」状態にする。
 * alt が空になり得るので role では引かない（空 alt の img は role="presentation"）。
 */
function settle() {
  const img = document.querySelector("img");
  if (!img) throw new Error("img が描画されていない");
  fireEvent.load(img);
}

describe("スライドショーの計時", () => {
  it("再生中は間隔ごとに送る", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());

    expect(useViewerStore.getState().pos).toBe(0);
    act(() => void vi.advanceTimersByTime(3000));
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("閉じたあとはタイマーが残らない", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());

    act(() => useViewerStore.getState().close());
    const posAtClose = useViewerStore.getState().pos;

    act(() => void vi.advanceTimersByTime(30000));

    expect(useViewerStore.getState().playing).toBe(false);
    expect(useViewerStore.getState().pos).toBe(posAtClose);
  });

  it("停止すると送らない", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());
    act(() => useViewerStore.getState().pause());

    act(() => void vi.advanceTimersByTime(30000));

    expect(useViewerStore.getState().pos).toBe(0);
  });
});

describe("全件ID の取得", () => {
  it("開いたときに一度だけ取り、results にある行は窓取得しない", async () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    await act(async () => {});

    expect(imagesApi.listImageIds).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().ids).toEqual([1, 2, 3]);
    expect(useViewerStore.getState().idsSeq).toBe(1);
    expect(imagesApi.listImages).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run web/src/components/Viewer.slideshow.test.tsx`
Expected: FAIL（`listImageIds` のモックが効かず ids 取得が走らない、または `pos` が進まない）

失敗の内容を記録しておく。ここで失敗するのは主に「まだ `Viewer` が `listImageIds` を呼んでいない」ことによる。

- [ ] **Step 3: 計時をフックへ切り出す**

`web/src/hooks/useSlideshowTimer.ts`：

```ts
import { useEffect } from "react";
import { useViewerStore } from "../store/useViewerStore";

/**
 * 自動送りの計時。`settled`（表示中の画像の読み込みが決着したか）が立ってから数え始める。
 * 読み込み前から数えると、遅い画像は表示時間を削られたり表示前に送られたりする。
 * 失敗も決着に数えるのは、消えた画像やオフラインドライブのタイムアウトで止まらないため。
 */
export function useSlideshowTimer(settled: boolean): void {
  const playing = useViewerStore((s) => s.playing);
  const intervalSec = useViewerStore((s) => s.intervalSec);
  const go = useViewerStore((s) => s.go);

  useEffect(() => {
    if (!playing || !settled) return;
    const id = setTimeout(() => go(1), intervalSec * 1000);
    return () => clearTimeout(id);
  }, [playing, settled, intervalSec, go]);
}
```

- [ ] **Step 4: キーボードをフックへ切り出す**

`web/src/hooks/useViewerKeys.ts`：

```ts
import { useEffect } from "react";
import type { RefObject } from "react";
import { useViewerStore } from "../store/useViewerStore";
import { isPlainKey, isTypingTarget } from "../util/keys";

interface Options {
  /** シートが開いている間などは切る。 */
  enabled: boolean;
  /** F キーでフルスクリーンにする要素。 */
  rootRef: RefObject<HTMLElement | null>;
}

export function useViewerKeys({ enabled, rootRef }: Options): void {
  const go = useViewerStore((s) => s.go);
  const pause = useViewerStore((s) => s.pause);
  const play = useViewerStore((s) => s.play);
  const close = useViewerStore((s) => s.close);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isPlainKey(e, "ArrowRight")) {
        e.preventDefault();
        go(1);
      } else if (isPlainKey(e, "ArrowLeft")) {
        e.preventDefault();
        go(-1);
      } else if (isPlainKey(e, " ")) {
        // Space はページスクロールの既定動作を持つ。
        e.preventDefault();
        if (useViewerStore.getState().playing) pause();
        else play();
      } else if (isPlainKey(e, "Escape")) {
        e.preventDefault();
        close();
      } else if (isPlainKey(e, "f")) {
        e.preventDefault();
        toggleFullscreen(rootRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, go, pause, play, close, rootRef]);
}

/** iOS Safari は要素のフルスクリーンを実装していない。使えない環境では何もしない。 */
function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  } catch {
    // フルスクリーンに入れなくても閲覧そのものは続けられる。
  }
}
```

- [ ] **Step 5: `Viewer.tsx` を書き換える**

`web/src/components/Viewer.tsx` の import と本体前半を差し替える。

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { imageUrl, listImageIds, listImages } from "../api/images";
import { containedLongEdge, pickWidth } from "../util/pickWidth";
import { createPreloader } from "../util/preloader";
import { createRowWindow, WINDOW_SIZE } from "../util/rowWindow";
import { useSlideshowTimer } from "../hooks/useSlideshowTimer";
import { useViewerKeys } from "../hooks/useViewerKeys";
import { buttonStyle } from "../ui";
import { ZoomableImage } from "./ZoomableImage";
import { SlideshowSheet } from "./SlideshowSheet";

/** 末尾からこの枚数以内に来たら次のページを取りにいく（全件ID が取れていないときの退避）。 */
const LOAD_MORE_MARGIN = 5;
/** 何枚先まで先読みするか。 */
const PRELOAD_AHEAD = 2;

export function Viewer() {
  const open = useViewerStore((s) => s.open);
  const order = useViewerStore((s) => s.order);
  const pos = useViewerStore((s) => s.pos);
  const ids = useViewerStore((s) => s.ids);
  const idsSeq = useViewerStore((s) => s.idsSeq);
  const setIds = useViewerStore((s) => s.setIds);
  const invalidateIds = useViewerStore((s) => s.invalidateIds);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);
  const close = useViewerStore((s) => s.close);
  const go = useViewerStore((s) => s.go);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const syncLength = useViewerStore((s) => s.syncLength);
  const playing = useViewerStore((s) => s.playing);
  const pause = useViewerStore((s) => s.pause);

  const results = useQueryStore((s) => s.results);
  const exhausted = useQueryStore((s) => s.exhausted);
  const loadMore = useQueryStore((s) => s.loadMore);
  const seq = useQueryStore((s) => s.seq);

  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [loadedPos, setLoadedPos] = useState<number | null>(null);
  // 行キャッシュが増えたことを描画へ伝えるためだけの世代。
  const [rowsVersion, setRowsVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerKeys({ enabled: open && !slideshowOpen, rootRef });
  useSlideshowTimer(loadedPos === pos);

  const preloader = useMemo(() => createPreloader(), []);

  const rowWindow = useMemo(
    () =>
      createRowWindow(
        (offset, limit) => {
          const { query, sort, dir, dirs } = useQueryStore.getState();
          return listImages({ q: query, sort, dir, dirs, limit, offset });
        },
        () => setRowsVersion((v) => v + 1),
        WINDOW_SIZE,
      ),
    [],
  );

  // クエリが変わると sort 順インデックスの意味が変わるので、行キャッシュも ids も無効。
  // ids を残したままにすると、取り直しが終わるまで古い ID で別の画像を出してしまう。
  // このフックを ids 取得より前に置くこと（同じ seq で二重に走らせないため）。
  useEffect(() => {
    rowWindow.clear();
    invalidateIds();
  }, [seq, rowWindow, invalidateIds]);

  // 開いたら検索結果全体のID列を取る。シャッフルを全件へ広げるのはこれが要る。
  useEffect(() => {
    if (!open || idsSeq === seq) return;
    let alive = true;
    const { query, sort, dir, dirs } = useQueryStore.getState();
    void listImageIds({ q: query, sort, dir, dirs })
      .then((list) => {
        if (alive) setIds(list, seq);
      })
      .catch(() => {
        // 取れなければ読み込み済みの範囲で送る（下の loadMore が退避経路）。
      });
    return () => {
      alive = false;
    };
  }, [open, idsSeq, seq, setIds]);

  // 全件ID があればそれが再生対象。無い間は読み込み済みの範囲。
  const playlistLength = ids.length > 0 ? ids.length : results.length;
  useEffect(() => {
    syncLength(playlistLength);
  }, [playlistLength, syncLength]);

  // 全件ID が取れなかったときだけ、末尾に近づいたら次のページを取る。
  useEffect(() => {
    if (!open || exhausted || ids.length > 0) return;
    if (pos >= order.length - LOAD_MORE_MARGIN) void loadMore();
  }, [open, exhausted, ids.length, pos, order.length, loadMore]);

  const sortedIndex = order[pos];
  const row =
    sortedIndex === undefined ? undefined : (results[sortedIndex] ?? rowWindow.get(sortedIndex));
  const id = sortedIndex === undefined ? undefined : (ids[sortedIndex] ?? results[sortedIndex]?.id);

  // 表示中と先読み分の行を取りにいく。results にある位置は取りにいかない
  // （行キャッシュは results とは別なので、確認しないと同じ行を二重に取る）。
  useEffect(() => {
    if (!open) return;
    const ensure = (si: number | undefined) => {
      if (si === undefined || results[si]) return;
      rowWindow.ensure(si);
    };
    ensure(sortedIndex);
    for (let i = 1; i <= PRELOAD_AHEAD; i++) ensure(order[pos + i]);
  }, [open, sortedIndex, order, pos, results, rowWindow]);

  // 画像の先読み。表示中と同じ幅を要求しないと別のキャッシュエントリになって無駄になる。
  useEffect(() => {
    if (!open) return;
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const si = order[pos + i];
      if (si === undefined) continue;
      const nid = ids[si] ?? results[si]?.id;
      if (nid === undefined) continue;
      const r = results[si] ?? rowWindow.get(si);
      preloader.preload(imageUrl(nid, widthFor(r)));
    }
  }, [open, order, pos, ids, results, preloader, rowWindow, rowsVersion]);

  if (!open || id === undefined) return null;

  const src = imageUrl(id, widthFor(row));
  const filename = row?.filename ?? "";
```

以降の JSX は次の3点だけ変える。

1. 件数表示の `order.length` はそのまま（全件になる）。
2. ファイル名の `{image.filename}` を `{filename}` にする。
3. `ZoomableImage` の `alt={image.filename}` を `alt={filename}` にする。

ファイル末尾の `widthFor` を差し替え、`toggleFullscreen` は削除する（`useViewerKeys` へ移した）。

```tsx
/**
 * 要求する w を決める。行がまだ届いていない位置では、画像の寸法が分からないので
 * ビューポートの長辺から決める。プレースホルダで待たせないのは、行の取得が失敗しても
 * スライドショーが止まらないようにするため。
 */
function widthFor(row: { width: number; height: number } | undefined): number {
  const dpr = window.devicePixelRatio || 1;
  const viewLongEdge = Math.max(window.innerWidth, window.innerHeight);
  if (!row) return pickWidth(viewLongEdge, dpr);
  return pickWidth(containedLongEdge(row.width, row.height, window.innerWidth, window.innerHeight), dpr);
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run web/src/components/Viewer.slideshow.test.tsx`
Expected: PASS（4 tests）

既存の2ファイルには先に同じ2点を足す（足さないと状態とモックが漏れる）。

- `web/src/components/Viewer.test.tsx:22-37` と `web/src/components/Viewer.keyboard.test.tsx` の `beforeEach`：
  - `vi.spyOn(imagesApi, "listImageIds").mockResolvedValue([])` を追加（`[]` を返すので `ids` は空のまま＝読み込み済み範囲での従来の挙動が保たれ、既存の期待値が変わらない）
  - `useViewerStore.setState({ ... })` へ `ids: [], idsSeq: null,` を追加
- `Viewer.keyboard.test.tsx` が `imagesApi` を import していなければ足す

Run: `npx vitest run web/src/components`
Expected: PASS。既存の期待値は書き換えないで通ること。**期待値そのものを直す必要が出たら、なぜ変わったかをレポートに書いてから直す。**

Run: `npm test`
Expected: 全緑

Run: `pnpm -C web exec tsc --noEmit` と `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: 実ブラウザで確認**

```bash
cargo run -p gim-server -- --port 5180 &
pnpm -C web dev &
```

`http://127.0.0.1:5181/` を開き、開発者ツールの Network を見ながら確認する。

| 確認 | 期待 |
|---|---|
| 画像をタップしてビューアを開く | `/api/images/ids` が1回だけ飛ぶ |
| 件数表示 | 読み込み済み件数ではなく総件数（`/api/images/count` の値と一致） |
| シャッフル ON にして再生 | 200件目より後ろの画像が早い段階で出る |
| 未読み込み位置での表示 | `/api/images?...&limit=40&offset=<40の倍数>` が飛び、直後にファイル名が出る |
| 同じ窓の中で前後に送る | 追加の `/api/images` が飛ばない |
| 前後送り・ピンチズーム・パン | 計画4で確認した挙動が保たれている |

終わったら両プロセスを落とし、`lsof -ti :5180 -ti :5181` が空であることを確認する。**結果は表にしてレポートへ書く。**

- [ ] **Step 8: コミット**

```bash
git add web/src/hooks/useSlideshowTimer.ts web/src/hooks/useViewerKeys.ts web/src/components/Viewer.tsx web/src/components/Viewer.slideshow.test.tsx
git commit -m "feat(web): スライドショーの再生対象を検索結果全体へ広げる"
```

---

## Task 8: 取りこぼしのまとめ（型ガードと注記）

**Files:**
- Modify: `web/src/storage.ts:62-81`
- Modify: `web/src/components/FilterSheet.tsx`（日付範囲のフォーム付近）
- Test: `web/src/storage.test.ts`（既存に追記）

**Interfaces:**
- Consumes: なし
- Produces: なし（挙動は変えない）

計画4のレビューから送られた小粒の指摘をまとめる。

- [ ] **Step 1: `sanitizePrefs` の型ガードの失敗するテストを書く**

`web/src/storage.test.ts` に追記する。

```ts
it("sort / dir に文字列以外が入っていても既定値へ落ちる", () => {
  const p = sanitizePrefs({ sort: 3, dir: { a: 1 }, query: 7 });
  expect(p.sort).toBe(DEFAULT_PREFS.sort);
  expect(p.dir).toBe(DEFAULT_PREFS.dir);
  expect(p.query).toBe(DEFAULT_PREFS.query);
});
```

- [ ] **Step 2: テストを実行する**

Run: `npx vitest run web/src/storage.test.ts`
Expected: 現状の `SORT_KEYS.includes(r.sort as string)` でも false になるので **PASS してしまう可能性がある**。PASS した場合は「回帰テストとして残す」ことが成果で、Step 3 は型の明確化のみになる。どちらだったかをレポートに書く。

- [ ] **Step 3: `as string` のキャストを型ガードへ置き換える**

`web/src/storage.ts` に加える。

```ts
function asOneOf<T extends string>(v: unknown, allowed: readonly string[], fallback: T): T {
  return typeof v === "string" && allowed.includes(v) ? (v as T) : fallback;
}
```

`sanitizePrefs` の該当2行を差し替える。

```ts
    sort: asOneOf<SortKey>(r.sort, SORT_KEYS, DEFAULT_PREFS.sort),
    dir: asOneOf<SortDir>(r.dir, SORT_DIRS, DEFAULT_PREFS.dir),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run web/src/storage.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add web/src/storage.ts web/src/storage.test.ts
git commit -m "refactor(web): 保存設定の sort/dir の検証を型ガードにする"
```

- [ ] **Step 6: フィルタシートの日付範囲に注記を足す**

`web/src/components/FilterSheet.tsx` の日付範囲の入力の直下に、境界の扱いが分かる短い説明を置く。`queryTokens` が組み立てる `created:` の実際の挙動（開始日と終了日をどちらも含むか）を **コードで確かめてから** 文言を決める。

```tsx
<p style={{ margin: "4px 0 0", color: "var(--text-dim)", fontSize: 12 }}>
  開始日と終了日のどちらも含みます。
</p>
```

Run: `npx vitest run packages/shared/src/queryTokens.test.ts`
Expected: PASS。境界の扱いを述べているテストを読み、注記の文言が実装と一致していることを確認する（一致しないなら注記を実装に合わせる）。

- [ ] **Step 7: コミット**

```bash
git add web/src/components/FilterSheet.tsx
git commit -m "docs(web): フィルタシートの日付範囲に境界の扱いを添える"
```

---

## Task 9: `npm run check` と参照ドキュメントの修正

**Files:**
- Modify: `package.json:6-15`
- Modify: `docs/CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-16-web-viewer-design.md:104`, `:186`
- Modify: `CLAUDE.md`（コマンド節に `npm run check` を追記）

**Interfaces:**
- Consumes: なし
- Produces: `npm run check`

型検査・テスト・lint がコマンド5本に散っていて、どれかを忘れた状態でコミットが通る。1本にまとめる。あわせて、実在しないファイルを指しているドキュメントを直す。

- [ ] **Step 1: `check` スクリプトを追加**

`package.json` の `scripts` に加える。`web/dist` を先に作るのは、`gim-server` の `build.rs` が参照するため。

```json
    "check": "tsc --noEmit && pnpm -C web exec tsc --noEmit && vitest run && pnpm -C web build && cargo test --workspace && cargo clippy --workspace --all-targets"
```

- [ ] **Step 2: 実行して緑になることを確認**

Run: `npm run check`
Expected: 全段成功。落ちた段があれば **そこで止めて原因を報告する**（このタスクで無関係な修正を混ぜない）

- [ ] **Step 3: `CLAUDE.md` のコマンド節に1行足す**

`## コマンド` のコードブロックへ追記する。

```bash
# 型検査・テスト・lint をまとめて実行
npm run check
```

- [ ] **Step 4: コミット**

```bash
git add package.json CLAUDE.md
git commit -m "chore: 型検査・テスト・lint をまとめる check スクリプトを追加"
```

- [ ] **Step 5: `docs/CLAUDE.md` の実在しない参照を直す**

`docs/CLAUDE.md` は3箇所で存在しないファイルを指している。実在するのは `docs/usage.html` と `docs/DESIGN.md` だけ。

1. 冒頭「`docs/master-import-usage.html` を共通トーンの基準とします」→ `docs/usage.html` に直す。同段落の「迷ったら `master-import-usage.html` を開いて倣うこと」も同様。
2. 「実コードと一致させる（CLI は `apps/cli/src/index.ts`）」→ このリポジトリに `apps/cli` は無い。「実コードと一致させる」だけを残し、括弧内を削除する。
3. 「## 構成（master-import-usage.html に倣う）」→ `usage.html` に直す。
4. 「## 公開後の手順」の「`docs/index.html` のカードリンクを手動で追加する」→ `docs/index.html` は存在しない。索引を持たない構成なので、「ドキュメントどうしは相対パスでリンクする」だけを残し、索引の記述を落とす。

`master-import-usage.html` に固有の言及（`.flow` の構成例など）は `usage.html` の実際の構成に合っているかを開いて確かめ、合っていなければ実物に合わせて直す。

- [ ] **Step 6: 仕様書を実装に合わせる**

`docs/superpowers/specs/2026-08-16-web-viewer-design.md`：

**104行目** を実装に合わせる。

```
web フロントは `rust-embed` でバイナリに埋め込む。`crates/server/build.rs` が `web/dist` の存在を確認し、無ければ案内文だけの `index.html` を置いて `cargo::warning` を出す（`web/dist` は .gitignore 対象でクローン直後には無く、ここで失敗させると `cargo test --workspace` が JS のビルド無しに動かなくなる）。同梱されていないときはブラウザに `pnpm -C web build` の案内が出る。
```

**186行目** を実装に合わせる。localStorage は個別キーではなく1つの JSON にまとめてある。

```
localStorage は `gim.web.prefs` の1キーに JSON でまとめて保存する（`history`（最大50件、新しい順・重複は先頭へ昇格）・`query`・`sort`・`dir`・`dirs`・`slideshow`）。キーを分けないのは、読み書きのたびに部分的に壊れた組み合わせが残らないようにするため。読み込み時はフィールド単位で型を検証して既定値へ落とす（`sanitizePrefs`）。読み書きはロジックから分離し、ロジック側を `packages/shared` の純粋関数としてテストする。
```

**175行目**の「次の2枚を `new Image()` でプリロードする」に、再生対象が全件であることを添える。

```
**スライドショー**: ビューアから起動。間隔・ループ・シャッフルを設定できる。再生対象は `/api/images/ids` が返す検索結果全体で、表示に必要な行（ファイル名・寸法）は 40 件単位の窓で必要になった時だけ取る。順序生成は `playlist.ts` の `buildOrder` / `step` を使い、次の2枚を `new Image()` でプリロードする。
```

- [ ] **Step 7: コミット**

```bash
git add docs/CLAUDE.md docs/superpowers/specs/2026-08-16-web-viewer-design.md
git commit -m "docs: 実在しない参照を直し、仕様書を実装に合わせる"
```

---

## Task 10: 利用者向け操作説明（`docs/web-viewer-usage.html`）

**Files:**
- Create: `docs/web-viewer-usage.html`
- Read first: `docs/usage.html`（トーンと体裁の基準）、`docs/DESIGN.md`、`docs/CLAUDE.md`（Task 9 で修正済み）

**Interfaces:**
- Consumes: `crates/server/src/cli.rs` の実際のオプション、`crates/server/src/routes/mod.rs` の実際のエンドポイント
- Produces: なし

`docs/CLAUDE.md` の執筆ガイドに従い、`docs/usage.html` と同じトーン・体裁の自己完結 HTML を書く。**先に `docs/usage.html` を開いて `<style>` とセクション構成を読み、それに倣うこと。** 新しいデザインを起こさない。

記載する内容は下記で確定している。**すべて実コードから確認して書く**（推測で書かない）。

**タイトル**: gen-img-manager web ビューア 使い方
**副題**: LAN 内のブラウザから画像ライブラリを閲覧する（`gim-server`）

**1. できること／できないこと**

できる: 一覧・検索・絞り込み（履歴付き）・並び替え・ディレクトリ選択・全画面ビューア・スライドショー
できない: 詳細メタデータ表示・レーティング設定・ディレクトリのスキャン登録・タグ分析（デスクトップ版で行う）

`.note` で「`library.db` は読み取り専用で開くので、web 側の操作でライブラリが変わることはない」ことを述べる。
`.warn` で「認証は無い。LAN 内での利用を前提としているので、インターネットへ直接公開しない」ことを述べる。

**2. 前提**

- デスクトップ版を一度起動して `library.db` を作っておくこと（サーバはマイグレーションを実行しない）
- 画像と DB がある Mac 上でサーバを起動し、同じ LAN のブラウザから接続する

**3. 起動**

```bash
pnpm -C web build          # web フロントをビルド（同梱される）
cargo build --release -p gim-server
./target/release/gim-server
```

標準出力の例を `<span class="c">` のコメント行で併記する（`crates/server/src/main.rs:56-60` の実際の文言に合わせる）。

**4. コマンドラインオプション**

`crates/server/src/cli.rs` の4つを `<table>` にする。既定値も実コードから取る。

| オプション | 既定値 | 意味 |
|---|---|---|
| `--host` | `0.0.0.0` | 待受アドレス |
| `--port` | `5180` | 待受ポート |
| `--data-dir` | `~/Library/Application Support/com.technonet.genimgmanager` | `library.db` と `thumbnails/` を含むディレクトリ |
| `--allow-host` | なし（複数回指定可） | DNSリバインディング対策で追加許可するホスト名 |

`--allow-host` は `.note` で補う: IPアドレス・`localhost`・`.local` で終わる名前は常に許可されるので、社内DNSの独自名でアクセスするときだけ指定する。

**5. 操作**

`<table>` を2つ。

タッチ操作（`web/src/components/ZoomableImage.tsx` の実装から）:

| 操作 | 動作 |
|---|---|
| 一覧の画像をタップ | ビューアを開く |
| 左へ払う / 右へ払う | 次へ / 前へ |
| 2本指で広げる・縮める | ズーム（最大6倍） |
| ズーム中に1本指で動かす | 表示位置を動かす（画像の四辺まで） |
| 画像を短くタップ | 上下のバーの表示を切り替え |

キーボード（`web/src/hooks/useViewerKeys.ts` と `web/src/components/FilterBar.tsx` の実装から）:

| キー | 動作 |
|---|---|
| `←` `→` | 前へ / 次へ |
| `Space` | 再生 / 停止 |
| `Esc` | ビューアを閉じる |
| `F` | フルスクリーン切替（対応ブラウザのみ） |
| `/` | クエリ入力へフォーカス（ビューアが閉じているとき） |

**6. 検索とフィルタ**

- クエリ文字列はデスクトップ版と同じ記法。フィルタシートで作った条件もクエリ文字列に反映されるので手で直せる
- 履歴はブラウザの localStorage に最大50件。クエリ入力をタップすると開き、入力中の文字列で前方一致絞り込みされる

`crates/core/src/query/parse.rs:7-32` が受けるトークンを `<table>` にする。これが全部で、他の名前は素の全文検索語として扱われる。

| トークン | 対象 | 種類 |
|---|---|---|
| `prompt:` | positive プロンプト | 全文検索 |
| `negative:` | negative プロンプト | 全文検索 |
| `model:` | モデル名 | 全文検索 |
| `filename:` | ファイル名 | 全文検索 |
| `tool:` | 生成ツール（`a1111` / `comfyui`） | 部分一致 |
| `sampler:` | サンプラー名 | 部分一致 |
| `rating:` | レーティング | 数値（範囲・集合可） |
| `width:` `height:` `pixels:` | 画像サイズ | 数値 |
| `steps:` `seed:` | 生成パラメータ | 数値 |
| `created:` `modified:` | 日付 | 日付範囲 |

数値・日付が範囲や集合をどう書くか（`rating:4..5` / `rating:>=4` のどちらか、複数値の区切り）は **`parse.rs` のテストを読んで実際の記法を書く**。推測で例を作らない。

**7. スライドショー**

- ビューア下部の ▶ から間隔（3 / 5 / 10 / 30 秒）・ループ・シャッフルを設定して再生
- 再生対象は検索結果全体
- 設定はブラウザごとに保存される

**8. うまくいかないとき**

`<table>` で症状と対処を並べる。

| 症状 | 対処 |
|---|---|
| 起動時に「デスクトップ版を一度起動してから…」と出る | `--data-dir` が違うか、`library.db` が無い。デスクトップ版を起動して作る |
| ブラウザに「web フロントがビルドされていません」と出る | `pnpm -C web build` のあと `cargo build --release -p gim-server` をやり直す |
| 「Host ヘッダ … は許可されていません」と出る | 独自のDNS名でアクセスしている。`--allow-host <名前>` を付けて起動する |
| 画像が出ず枠だけ残る | 元ファイルが消えている（404）か、外部ドライブが切れている（503）。次へ送れば止まらない |
| スマホで表示が遅い | 初回はリサイズ生成が走る。2回目以降は `web-cache/` から返る |

**footer**: 関連ドキュメントとして `docs/superpowers/specs/2026-08-16-web-viewer-design.md` と、この計画のパスを `<code>` で示す。デスクトップ版の説明として `./usage.html` へ相対リンクする。

- [ ] **Step 1: 基準となる既存ドキュメントを読む**

`docs/usage.html` を開き、`<style>` の内容・`.note` / `.warn` / `.flow` / `.c` の使い方・セクションの番号付けを確認する。`docs/DESIGN.md` も読む。

- [ ] **Step 2: 記載する事実を実コードから確認する**

以下を読んで、上の表に書いた値が実装と一致しているかを1つずつ確かめる。食い違いがあれば **実装を正として** 文言を直す。

- `crates/server/src/cli.rs`（オプションと既定値）
- `crates/server/src/main.rs:56-60`（標準出力の文言）
- `crates/core/src/query/parse.rs`（受け付けるトークン）
- `web/src/hooks/useViewerKeys.ts`・`web/src/components/FilterBar.tsx`（キー割り当て）
- `web/src/components/ZoomableImage.tsx`・`web/src/util/gesture.ts`（タッチ操作と最大倍率）
- `web/src/storage.ts`（間隔の選択肢・履歴の上限）

- [ ] **Step 3: `docs/web-viewer-usage.html` を書く**

上の構成そのままに、`docs/usage.html` の `<style>` と同じクラスを使って書く。`<html lang="ja">` / `<meta charset="utf-8">` / viewport を入れ、外部 CSS/JS に依存しない。

- [ ] **Step 4: 表示を確認する**

```bash
open docs/web-viewer-usage.html
```

`docs/usage.html` と並べて開き、見出し・表・コードブロック・`.note` / `.warn` の見た目が揃っていることを確認する。

- [ ] **Step 5: コミット**

```bash
git add docs/web-viewer-usage.html
git commit -m "docs: web ビューアの使い方を追加"
```

---

## 完了条件

- [ ] `npm run check` が全段緑
- [ ] `cargo build --release -p gim-server` で作ったバイナリ1つを起動し、`web/dist` を消しても web フロントが表示される（＝埋め込みが効いている）
- [ ] `/api/nope` が JSON の 404、`/some/deep/link` が index.html
- [ ] 17,000件規模のライブラリでシャッフル再生し、200件目より後ろの画像が早い段階で出る
- [ ] 未読み込み位置でもファイル名が表示される
- [ ] 500 応答の本文に絶対パス・SQL断片・システムエラー文が出ない
- [ ] `docs/web-viewer-usage.html` の記述が実コードと一致している
