use rusqlite::{params, Connection};

/// 設定値を取得する。無ければ None。
pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

/// 設定値を保存する（UPSERT）。
pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        c
    }

    #[test]
    fn get_missing_is_none() {
        let c = conn();
        assert_eq!(get(&c, "nope").unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrip_and_overwrite() {
        let c = conn();
        set(&c, "sort", "created:desc").unwrap();
        assert_eq!(get(&c, "sort").unwrap(), Some("created:desc".to_string()));
        set(&c, "sort", "filename:asc").unwrap();
        assert_eq!(get(&c, "sort").unwrap(), Some("filename:asc".to_string()));
    }
}
