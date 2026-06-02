use crate::db::image_query::{self, ImageRow};
use crate::db::Db;
use crate::query::{SortDir, SortKey};
use tauri::State;

/// クエリ文字列でフィルタした画像行を返す。
#[tauri::command]
pub fn query_images(
    db: State<Db>,
    query: String,
    sort: String,
    dir: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<ImageRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::query_images(
        &conn,
        &query,
        SortKey::parse(&sort),
        SortDir::parse(&dir),
        limit,
        offset,
    )
    .map_err(|e| e.to_string())
}

/// クエリ文字列に一致する件数を返す。
#[tauri::command]
pub fn count_query(db: State<Db>, query: String) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::count_query(&conn, &query).map_err(|e| e.to_string())
}
