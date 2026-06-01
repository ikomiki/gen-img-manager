use rusqlite::Connection;

/// 配列の index+1 がスキーマバージョン。追記のみ・並び替え禁止。
const MIGRATIONS: &[&str] = &[
    // v1: directories
    "CREATE TABLE directories (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        is_online INTEGER NOT NULL DEFAULT 1,
        last_scanned_at INTEGER,
        recursive INTEGER NOT NULL DEFAULT 1
    );",
];

/// 未適用のマイグレーションを順に適用し PRAGMA user_version を更新する。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            conn.execute_batch(&format!(
                "BEGIN; {sql} PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_directories_table_and_sets_version() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();

        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='directories'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn run_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
    }
}
