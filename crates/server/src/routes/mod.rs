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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/directories", get(directories::list))
        .route("/api/images", get(images::list))
        .route("/api/images/count", get(images::count))
        .route("/api/images/ids", get(images::ids))
        .route("/api/thumb/{id}", get(media::thumb))
        .route("/api/image/{id}", get(media::image))
        .method_not_allowed_fallback(method_not_allowed)
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
