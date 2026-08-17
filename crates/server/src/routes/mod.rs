pub mod directories;
pub mod health;
pub mod images;
pub mod media;

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
        .route("/api/thumb/{id}", get(media::thumb))
        .route("/api/image/{id}", get(media::image))
        .with_state(state)
}
