use crate::db::analysis::{self, LiftRow, TagFreq, TagRatingAnalysis};
use crate::db::Db;
use tauri::State;

/// 頻度一覧。scope=None で全体、Some(query) でフィルタ範囲。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn analysis_tag_frequency(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    name_filter: Option<String>,
    sort: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<TagFreq>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::tag_frequency(&conn, name_filter.as_deref(), &sort, limit, offset)
        .map_err(|e| e.to_string())
}

/// 高/低評価原因タグ。
#[tauri::command]
pub fn analysis_rating_lift(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    direction: String,
    limit: i64,
) -> Result<Vec<LiftRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::rating_lift(&conn, &direction, limit).map_err(|e| e.to_string())
}

/// 特定タグの「ある/ない」レーティング分析。
#[tauri::command]
pub fn analysis_tag_rating(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    tag_id: i64,
) -> Result<TagRatingAnalysis, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::tag_rating_analysis(&conn, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_list_excluded(db: State<Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::list_excluded(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_add_excluded(db: State<Db>, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::add_excluded(&conn, name.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_remove_excluded(db: State<Db>, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::remove_excluded(&conn, &name).map_err(|e| e.to_string())
}
