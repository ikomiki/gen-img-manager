pub mod directories;
pub mod health;
pub mod images;
pub mod media;

use crate::error::ApiError;
use crate::state::AppState;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

/// 未知のパスは JSON の 404 を返す。クライアントが res.json() を無条件に呼べる状態を保つ。
async fn not_found() -> impl IntoResponse {
    ApiError::NotFound
}

async fn method_not_allowed() -> impl IntoResponse {
    ApiError::MethodNotAllowed
}

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
    async fn api_router_is_mounted_under_api_prefix() {
        let (state, _tmp) = test_state();
        // nest 後もエンドポイントの外向き URL は変わらない。
        assert_eq!(get_raw(state.clone(), "/api/health").await.status(), 200);
        assert_eq!(get_raw(state.clone(), "/api/images").await.status(), 200);
        assert_eq!(get_raw(state.clone(), "/api/images/count").await.status(), 200);
        assert_eq!(get_raw(state, "/api/images/ids").await.status(), 200);
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

    #[tokio::test]
    async fn disallowed_host_header_returns_json_403() {
        let (state, _tmp) = test_state();
        let res = crate::test_support::get_raw_with_headers(
            state,
            "/api/health",
            &[("Host", "evil.example.com:5180")],
        )
        .await;
        assert_json_error(res, 403).await;
    }
}
