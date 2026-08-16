pub mod directories;
pub mod history;
pub mod image_query;
pub mod images;
pub mod migrations;
pub mod settings;
pub mod tags;
pub mod analysis;

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

#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("スキーマのバージョンが違います (DB: {found}, 期待値: {expected})")]
    SchemaMismatch { found: i64, expected: i64 },
}

/// DBを読み取り専用で開く。マイグレーションは実行せず、スキーマ版が一致しなければ拒否する。
///
/// WAL のデータベースを読み取り専用で開く場合、SQLite は共有メモリインデックス
/// (`-shm`) を必要とするため、DBと同じディレクトリへの書き込み権限は要る。
/// テーブルには書かないが `-wal` / `-shm` は触る、という意味の読み取り専用。
/// `immutable=1` は使わない（デスクトップ版が同時に書き込むと不整合を読むため）。
pub fn open_read_only(path: &Path) -> Result<Connection, OpenError> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.pragma_update(None, "query_only", "ON")?;

    let found: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let expected = migrations::latest_version();
    if found != expected {
        return Err(OpenError::SchemaMismatch { found, expected });
    }
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;

    /// WAL のデータベースを作り、接続を閉じてからパスを返す。
    fn wal_db(dir: &std::path::Path) -> std::path::PathBuf {
        let path = dir.join("library.db");
        let conn = open(&path).unwrap();
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal", "テストの前提が崩れている");
        drop(conn);
        path
    }

    #[test]
    fn open_read_only_can_read_a_wal_database() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());

        let conn = open_read_only(&path).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM directories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn open_read_only_rejects_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());

        let conn = open_read_only(&path).unwrap();
        let err = conn.execute("DELETE FROM directories", []).unwrap_err();
        match &err {
            rusqlite::Error::SqliteFailure(ffi_err, _) => {
                assert_eq!(
                    ffi_err.code,
                    rusqlite::ErrorCode::ReadOnly,
                    "書き込みが拒否されるべき: {err:?}"
                );
            }
            _ => panic!("SqliteFailure を期待した: {err:?}"),
        }
    }

    #[test]
    fn open_read_only_rejects_mismatched_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let path = wal_db(tmp.path());
        {
            let w = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
            w.pragma_update(None, "user_version", 999).unwrap();
        }

        match open_read_only(&path) {
            Err(OpenError::SchemaMismatch { found, expected }) => {
                assert_eq!(found, 999);
                assert_eq!(expected, migrations::latest_version());
            }
            other => panic!("SchemaMismatch を期待した: {other:?}"),
        }
    }

    #[test]
    fn open_read_only_does_not_create_a_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nope.db");
        assert!(open_read_only(&path).is_err());
        assert!(!path.exists(), "読み取り専用オープンがファイルを作ってはいけない");
    }
}
