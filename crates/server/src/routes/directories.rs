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
