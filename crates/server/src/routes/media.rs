use crate::error::ApiError;
use crate::fileserve;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use gim_core::db::images::MediaInfo;
use serde::Deserialize;
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

#[cfg(test)]
mod tests {
    use crate::test_support::{get_raw, test_state_with_files, test_state_with_wide_image};
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
        assert_eq!(
            get_raw(state.clone(), "/api/image/9999").await.status(),
            404
        );
        assert_eq!(get_raw(state, "/api/thumb/9999").await.status(), 404);
    }

    #[tokio::test]
    async fn missing_file_on_disk_is_404() {
        let (state, _tmp) = test_state_with_files();
        // id 2 の実ファイルは作っていない。
        assert_eq!(get_raw(state, "/api/image/2").await.status(), 404);
    }

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
        assert_eq!(
            get_raw(state.clone(), "/api/image/1?w=0").await.status(),
            400
        );
        assert_eq!(get_raw(state, "/api/image/1?w=abc").await.status(), 400);
    }
}
