use crate::db::{history, settings, Db};
use tauri::State;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn add_filter_history(db: State<Db>, query: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history::record(&conn, &query, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_filter_history(db: State<Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    settings::get(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    settings::set(&conn, &key, &value).map_err(|e| e.to_string())
}
