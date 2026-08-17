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
        conn.query_row("SELECT count(*) FROM images WHERE missing = 0", [], |r| {
            r.get(0)
        })?;
    Ok(Json(Health {
        schema_version,
        image_count,
    }))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_json, test_state};

    #[tokio::test]
    async fn health_reports_schema_version_and_image_count() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/health").await;
        assert_eq!(
            body["schema_version"],
            gim_core::db::migrations::latest_version()
        );
        assert_eq!(body["image_count"], 3);
    }
}
