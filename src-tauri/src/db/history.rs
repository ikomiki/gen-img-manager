use rusqlite::{params, Connection};

const MAX_HISTORY: i64 = 20;

/// クエリ文字列をヒストリへ記録する。空文字は無視。
/// 既存の同一文字列は used_at を更新して先頭へ昇格。直近 MAX_HISTORY 件のみ保持。
pub fn record(conn: &Connection, query_text: &str, now: i64) -> rusqlite::Result<()> {
    let trimmed = query_text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO filter_history (query_text, used_at) VALUES (?1, ?2)
         ON CONFLICT(query_text) DO UPDATE SET used_at = excluded.used_at",
        params![trimmed, now],
    )?;
    conn.execute(
        "DELETE FROM filter_history
         WHERE id NOT IN (SELECT id FROM filter_history ORDER BY used_at DESC, id DESC LIMIT ?1)",
        params![MAX_HISTORY],
    )?;
    Ok(())
}

/// 直近のクエリ文字列を新しい順で返す。
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT query_text FROM filter_history ORDER BY used_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![MAX_HISTORY], |r| r.get::<_, String>(0))?;
    rows.collect()
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
    fn records_and_lists_newest_first() {
        let c = conn();
        record(&c, "a", 100).unwrap();
        record(&c, "b", 200).unwrap();
        assert_eq!(list(&c).unwrap(), vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn duplicate_promotes_to_top() {
        let c = conn();
        record(&c, "a", 100).unwrap();
        record(&c, "b", 200).unwrap();
        record(&c, "a", 300).unwrap();
        assert_eq!(list(&c).unwrap(), vec!["a".to_string(), "b".to_string()]);
        let count: i64 = c.query_row("SELECT count(*) FROM filter_history", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn empty_query_is_ignored() {
        let c = conn();
        record(&c, "   ", 100).unwrap();
        assert!(list(&c).unwrap().is_empty());
    }

    #[test]
    fn keeps_only_last_20() {
        let c = conn();
        for i in 0..25 {
            record(&c, &format!("q{i}"), i).unwrap();
        }
        let all = list(&c).unwrap();
        assert_eq!(all.len(), 20);
        assert_eq!(all[0], "q24");
        assert!(!all.contains(&"q4".to_string()));
    }
}
