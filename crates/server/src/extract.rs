//! クエリ・パスの抽出失敗を `ApiError` へ寄せる薄い抽出器。
//! ハンドラのシグネチャに `Result<Query<T>, QueryRejection>` を並べると、
//! `?` を忘れた実装が書けてしまう。

use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::{FromRequestParts, Path, Query};
use axum::http::request::Parts;

#[derive(Debug)]
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

#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::extract::FromRequestParts;
    use axum::http::Request;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
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
