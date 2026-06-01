use crate::models::Directory;
use rusqlite::{params, Connection};

pub fn add(
    conn: &Connection,
    path: &str,
    label: &str,
    recursive: bool,
) -> rusqlite::Result<Directory> {
    conn.execute(
        "INSERT INTO directories (path, label, is_online, last_scanned_at, recursive)
         VALUES (?1, ?2, 1, NULL, ?3)",
        params![path, label, recursive as i64],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Directory> {
    conn.query_row(
        "SELECT id, path, label, is_online, last_scanned_at, recursive
         FROM directories WHERE id = ?1",
        params![id],
        row_to_dir,
    )
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Directory>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, label, is_online, last_scanned_at, recursive
         FROM directories ORDER BY label COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_dir)?;
    rows.collect()
}

pub fn remove(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM directories WHERE id = ?1", params![id])?;
    Ok(())
}

fn row_to_dir(r: &rusqlite::Row) -> rusqlite::Result<Directory> {
    Ok(Directory {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        is_online: r.get::<_, i64>(3)? != 0,
        last_scanned_at: r.get(4)?,
        recursive: r.get::<_, i64>(5)? != 0,
    })
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
    fn add_then_list_returns_one() {
        let c = conn();
        let d = add(&c, "/Volumes/NAS/sd", "sd", true).unwrap();
        assert_eq!(d.path, "/Volumes/NAS/sd");
        assert_eq!(d.label, "sd");
        assert!(d.is_online);
        assert!(d.recursive);

        let all = list(&c).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, d.id);
    }

    #[test]
    fn remove_deletes_row() {
        let c = conn();
        let d = add(&c, "/a", "a", false).unwrap();
        remove(&c, d.id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_path_is_error() {
        let c = conn();
        add(&c, "/a", "a", true).unwrap();
        assert!(add(&c, "/a", "a", true).is_err());
    }
}
