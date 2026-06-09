use crate::db::Db;
use tauri::State;

/// 指定パスをOSのファイルマネージャで開き、ファイルを選択状態にする。
/// macOS: open -R <path>  / Windows: explorer /select,<path>
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Err("このOSはサポートされていません".to_string());
    }
    Ok(())
}

/// 画像ファイルをOSのゴミ箱へ移動し、DB行を missing=1 にする。
/// 画像本体のみを対象とし、.xmp 等のサイドカーは残す。確認は呼び出し側の責務。
#[tauri::command]
pub fn delete_image(db: State<Db>, id: i64, path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::images::mark_missing(&conn, id, true).map_err(|e| e.to_string())?;
    Ok(())
}

/// 画像パスに対応する .xmp サイドカーへ Rating を書き出す（None でクリア）。
#[tauri::command]
pub fn write_xmp_rating(path: String, rating: Option<i64>) -> Result<(), String> {
    crate::parser::xmp::write_rating_sidecar(std::path::Path::new(&path), rating)
        .map_err(|e| e.to_string())
}
