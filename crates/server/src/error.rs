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
            ApiError::NotFound => (StatusCode::NOT_FOUND, "見つかりません".to_string()),
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
