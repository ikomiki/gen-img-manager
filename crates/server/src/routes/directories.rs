use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;

pub async fn list(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::dto::DirectoryDto>>, ApiError> {
    let conn = state.conn()?;
    let dirs = gim_core::db::directories::list(&conn)?;
    Ok(Json(dirs.into_iter().map(Into::into).collect()))
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
}
