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
/// scan_directory 内部でフェーズごとにロックを取得/解放するため、
/// 長い並列フェーズ（NASのファイルI/O）中はDBロックを保持しない。
/// これにより、スキャン中も他のDB操作（set_directory_visible等）がブロックされない。
fn run_scan_ids(
    app: &AppHandle,
    conn_arc: Arc<Mutex<rusqlite::Connection>>,
    thumb_dir: &std::path::Path,
    ids: &[i64],
    failed_pre: &std::collections::HashSet<i64>,
) {
    let now = now_secs();
    // 並列度（settings.scan_concurrency。未設定/不正なら既定値）。スキャン全体で1回読む。
    let concurrency = {
        let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::settings::get(&conn, "scan_concurrency")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|n| *n >= 1)
            .unwrap_or(scanner::DEFAULT_CONCURRENCY)
    };
    for &id in ids {
        // ディレクトリ情報だけ短時間ロックで取得する。
        let dir = {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            directories::get(&conn, id).ok()
        };
        let scan_ok = match dir {
            Some(dir) => {
                let app_cb = app.clone();
                // scan_directory 内部でフェーズごとにロックを取得/解放するため、
                // 長い並列フェーズ中はDBロックを保持しない（スキャン中も他操作が可能）。
                scanner::scan_directory(&conn_arc, &dir, thumb_dir, now, concurrency, move |p| {
                    let _ = app_cb.emit("scan-progress", &p);
                })
                .is_ok()
            }
            None => false,
        };
        let success = scan_ok && !failed_pre.contains(&id);
        let _ = app.emit("scan-done", ScanDone { directory_id: id, success });
    }
}
