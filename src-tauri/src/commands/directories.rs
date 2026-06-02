use crate::db::Db;
use crate::models::Directory;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn add_directory(
    app: AppHandle,
    db: State<Db>,
    path: String,
    recursive: bool,
) -> Result<Directory, String> {
    let label = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.clone());
    let dir = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::directories::add(&conn, &path, &label, recursive).map_err(|e| e.to_string())?
    };
    // 追加ディレクトリ配下の原画像を asset protocol で表示できるよう許可する。
    let _ = app.asset_protocol_scope().allow_directory(Path::new(&path), recursive);
    Ok(dir)
}

#[tauri::command]
pub fn list_directories(db: State<Db>) -> Result<Vec<Directory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_directory(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::remove(&conn, id).map_err(|e| e.to_string())
}
