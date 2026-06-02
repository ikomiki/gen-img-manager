pub mod directories;
pub mod history;
pub mod images;
pub mod migrations;
pub mod settings;

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Tauri管理状態として保持するDBハンドル。
pub struct Db(pub Arc<Mutex<Connection>>);

/// DBを開き、PRAGMAを設定し、マイグレーションを適用する。
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::run(&conn)?;
    Ok(conn)
}
