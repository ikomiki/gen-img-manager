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
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible,
                (SELECT count(*) FROM images i WHERE i.directory_id = directories.id AND i.missing = 0) AS image_count
         FROM directories WHERE id = ?1",
        params![id],
        row_to_dir,
    )
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Directory>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible,
                (SELECT count(*) FROM images i WHERE i.directory_id = directories.id AND i.missing = 0) AS image_count
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
        visible: r.get::<_, i64>(6)? != 0,
        image_count: r.get(7)?,
    })
}

pub fn set_online(conn: &Connection, id: i64, online: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET is_online = ?2 WHERE id = ?1",
        params![id, online as i64],
    )?;
    Ok(())
}

pub fn set_last_scanned(conn: &Connection, id: i64, ts: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET last_scanned_at = ?2 WHERE id = ?1",
        params![id, ts],
    )?;
    Ok(())
}

pub fn set_visible(conn: &Connection, id: i64, visible: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET visible = ?2 WHERE id = ?1",
        params![id, visible as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::images::NewImage;
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

    #[test]
    fn set_online_and_last_scanned_persist() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        set_online(&c, d.id, false).unwrap();
        set_last_scanned(&c, d.id, 1717000000).unwrap();
        let got = get(&c, d.id).unwrap();
        assert!(!got.is_online);
        assert_eq!(got.last_scanned_at, Some(1717000000));
    }

    #[test]
    fn new_directory_is_visible_by_default() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        assert!(d.visible, "new directory should be visible");
    }

    #[test]
    fn set_visible_persists() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        set_visible(&c, d.id, false).unwrap();
        assert!(!get(&c, d.id).unwrap().visible);
        set_visible(&c, d.id, true).unwrap();
        assert!(get(&c, d.id).unwrap().visible);
    }

    #[test]
    fn list_includes_image_count_excluding_missing() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        // 画像なしは 0。
        assert_eq!(list(&c).unwrap()[0].image_count, 0);

        crate::db::images::upsert(
            &c,
            &NewImage {
                directory_id: d.id,
                path: "/a/x.png".into(),
                filename: "x.png".into(),
                size: 1,
                mtime: 1,
                format: "png".into(),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list(&c).unwrap()[0].image_count, 1);
        assert_eq!(get(&c, d.id).unwrap().image_count, 1);

        // missing は除外。
        c.execute("UPDATE images SET missing = 1", []).unwrap();
        assert_eq!(list(&c).unwrap()[0].image_count, 0);
    }
}
