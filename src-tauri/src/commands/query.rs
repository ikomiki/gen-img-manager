use crate::db::image_query::{self, DirScope, ImageDetail, ImageRow};
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
        &DirScope::Visible,
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
    image_query::count_query(&conn, &query, &DirScope::Visible).map_err(|e| e.to_string())
}

/// 1画像の全メタデータを取得する。
#[tauri::command]
pub fn get_image_detail(db: State<Db>, id: i64) -> Result<Option<ImageDetail>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::get_detail(&conn, id).map_err(|e| e.to_string())
}

/// 画像のレーティングを設定する（None でクリア）。
#[tauri::command]
pub fn set_rating(db: State<Db>, id: i64, rating: Option<i64>) -> Result<(), String> {
    if let Some(r) = rating {
        if !(1..=5).contains(&r) {
            return Err(format!("rating out of range: {r}"));
        }
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::images::set_rating(&conn, id, rating).map_err(|e| e.to_string())
}

/// 複数画像のレーティングを一括設定する（None でクリア）。範囲外はエラー。
#[tauri::command]
pub fn set_ratings(db: State<Db>, ids: Vec<i64>, rating: Option<i64>) -> Result<(), String> {
    if let Some(r) = rating {
        if !(1..=5).contains(&r) {
            return Err(format!("rating out of range: {r}"));
        }
    }
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::images::set_ratings(&mut conn, &ids, rating).map_err(|e| e.to_string())
}
