use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    NotFound,
    MethodNotAllowed,
    Forbidden(String),
    /// ファイルには届かないが、消えたとは限らない（オフラインの外部ドライブなど）。
    Unavailable,
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "見つかりません".to_string()),
            ApiError::MethodNotAllowed => (
                StatusCode::METHOD_NOT_ALLOWED,
                "このメソッドは使えません".to_string(),
            ),
            ApiError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
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
        // rusqlite のエラー文字列は DB ファイルのパスや SQL 断片を含みうる。
        // 認証なしで LAN に公開するため、詳細は標準エラーへ、応答には定型文だけを出す。
        eprintln!("DBエラー: {e}");
        ApiError::Internal("内部エラーが発生しました".to_string())
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn rusqlite_error_detail_does_not_reach_response_body() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let sqlite_err = conn.execute("not valid sql", []).unwrap_err();
        let detail = sqlite_err.to_string();

        let res: Response = ApiError::from(sqlite_err).into_response();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(
            !body.contains(&detail),
            "rusqlite のエラー詳細が応答に漏れている: {body}"
        );
    }
}
