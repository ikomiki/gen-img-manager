pub mod directories;
pub mod health;
pub mod images;

use crate::state::AppState;
use axum::routing::get;
use axum::Router;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/directories", get(directories::list))
        .route("/api/images", get(images::list))
        .route("/api/images/count", get(images::count))
        .route("/api/images/ids", get(images::ids))
        .with_state(state)
}
