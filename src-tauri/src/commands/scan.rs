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

/// scan-done イベントのペイロード。
#[derive(Clone, serde::Serialize)]
struct ScanDone {
    directory_id: i64,
    success: bool,
}

/// 1ディレクトリをバックグラウンドでスキャンし、進捗を `scan-progress`、完了を `scan-done` で通知する。
#[tauri::command]
pub fn scan_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        run_scan_ids(&app, conn_arc, &td, &[id], &std::collections::HashSet::new());
    });
    Ok(())
}

/// 全ディレクトリをバックグラウンドでスキャンする。
#[tauri::command]
pub fn scan_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect()
        };
        run_scan_ids(&app, conn_arc, &td, &ids, &std::collections::HashSet::new());
    });
    Ok(())
}

/// 指定ディレクトリの画像を削除してから再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let mut failed_pre = std::collections::HashSet::new();
        {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            if let Err(e) = images::delete_by_directory(&conn, id) {
                eprintln!("rebuild: delete_by_directory({id}) failed: {e}");
                failed_pre.insert(id);
            }
        }
        run_scan_ids(&app, conn_arc, &td, &[id], &failed_pre);
    });
    Ok(())
}

/// 全ディレクトリの画像を削除してから全再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let mut failed_pre = std::collections::HashSet::new();
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            let ids: Vec<i64> = directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect();
            for id in &ids {
                if let Err(e) = images::delete_by_directory(&conn, *id) {
                    eprintln!("rebuild_all: delete_by_directory({id}) failed: {e}");
                    failed_pre.insert(*id);
                }
            }
            ids
        };
        run_scan_ids(&app, conn_arc, &td, &ids, &failed_pre);
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
///
/// 注: 1ディレクトリのスキャン全体で単一接続のロックを保持する簡易方式
/// （計画3で読み取り専用接続の分離を検討）。スキャン中は他のDB操作がブロックされる。
/// また async_runtime（tokio）上で std::sync::Mutex を保持するが、scan_directory は
/// 同期処理（.awaitを跨がない）のためデッドロックの懸念はない。
fn run_scan_ids(
    app: &AppHandle,
    conn_arc: Arc<Mutex<rusqlite::Connection>>,
    thumb_dir: &std::path::Path,
    ids: &[i64],
    failed_pre: &std::collections::HashSet<i64>,
) {
    let now = now_secs();
    for &id in ids {
        let scan_ok = {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            match directories::get(&conn, id) {
                Ok(dir) => {
                    let app_cb = app.clone();
                    scanner::scan_directory(&conn, &dir, thumb_dir, now, |p| {
                        let _ = app_cb.emit("scan-progress", &p);
                    })
                    .is_ok()
                }
                Err(_) => false,
            }
        };
        let success = scan_ok && !failed_pre.contains(&id);
        let _ = app.emit("scan-done", ScanDone { directory_id: id, success });
    }
}
