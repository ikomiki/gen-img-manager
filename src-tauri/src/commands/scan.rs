use crate::db::{directories, images, Db};
use crate::scanner;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

fn thumb_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("thumbnails"))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 1ディレクトリをバックグラウンドでスキャンし、進捗を `scan-progress`、完了を `scan-done` で通知する。
#[tauri::command]
pub fn scan_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        run_scan_ids(&app, conn_arc, &td, &[id]);
    });
    Ok(())
}

/// 全ディレクトリをバックグラウンドでスキャンする。
#[tauri::command]
pub fn scan_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap();
            directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect()
        };
        run_scan_ids(&app, conn_arc, &td, &ids);
    });
    Ok(())
}

/// 指定ディレクトリの画像を削除してから再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        {
            let conn = conn_arc.lock().unwrap();
            let _ = images::delete_by_directory(&conn, id);
        }
        run_scan_ids(&app, conn_arc, &td, &[id]);
    });
    Ok(())
}

/// 全ディレクトリの画像を削除してから全再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap();
            let ids: Vec<i64> = directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect();
            for id in &ids {
                let _ = images::delete_by_directory(&conn, *id);
            }
            ids
        };
        run_scan_ids(&app, conn_arc, &td, &ids);
    });
    Ok(())
}

/// ディレクトリ内の（missing除く）画像件数を返す。
#[tauri::command]
pub fn count_images(db: State<Db>, id: i64) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    images::count_in_directory(&conn, id).map_err(|e| e.to_string())
}

/// 指定IDのディレクトリ群を順にスキャンし、進捗/完了イベントを発火する。
fn run_scan_ids(app: &AppHandle, conn_arc: Arc<Mutex<rusqlite::Connection>>, thumb_dir: &std::path::Path, ids: &[i64]) {
    let now = now_secs();
    for &id in ids {
        let conn = conn_arc.lock().unwrap();
        let dir = match directories::get(&conn, id) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let app_for_cb = app.clone();
        let _ = scanner::scan_directory(&conn, &dir, thumb_dir, now, |p| {
            let _ = app_for_cb.emit("scan-progress", &p);
        });
        drop(conn);
        let _ = app.emit("scan-done", id);
    }
}
