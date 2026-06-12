use rusqlite::{params, Connection};

/// タグ名から id を引く。無ければ作成する。
pub fn get_or_create_tag(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![name])?;
    conn.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))
}

/// 画像のタグ紐付けを置き換える（全削除→挿入）。tags は (name, kind) の並び。
pub fn replace_image_tags(
    conn: &Connection,
    image_id: i64,
    tags: &[(&str, &str)],
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM image_tags WHERE image_id = ?1", params![image_id])?;
    for (name, kind) in tags {
        let tag_id = get_or_create_tag(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO image_tags (image_id, tag_id, kind) VALUES (?1, ?2, ?3)",
            params![image_id, tag_id, kind],
        )?;
    }
    Ok(())
}

/// backfill 用: 全画像の (id, positive, negative, source_tool)。
pub fn image_tag_sources(
    conn: &Connection,
) -> rusqlite::Result<Vec<(i64, Option<String>, Option<String>, String)>> {
    let mut stmt = conn.prepare("SELECT id, positive, negative, source_tool FROM images")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, source_tool)
             VALUES (1, '/d/a.png', 'a.png', 1, 1, 4, 4, 16, 'png', 'a1111')",
            [],
        )
        .unwrap();
        c
    }

    #[test]
    fn get_or_create_is_idempotent() {
        let c = conn();
        let id1 = get_or_create_tag(&c, "forest").unwrap();
        let id2 = get_or_create_tag(&c, "forest").unwrap();
        assert_eq!(id1, id2);
        let n: i64 = c.query_row("SELECT count(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn replace_inserts_and_replaces() {
        let c = conn();
        replace_image_tags(&c, 1, &[("forest", "prompt"), ("blurry", "negative")]).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags WHERE image_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        replace_image_tags(&c, 1, &[("cat", "prompt")]).unwrap();
        let names: Vec<String> = {
            let mut stmt = c
                .prepare("SELECT t.name FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE it.image_id = 1")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(names, vec!["cat"]);
    }

    #[test]
    fn deleting_image_cascades_to_image_tags() {
        let c = conn();
        replace_image_tags(&c, 1, &[("forest", "prompt")]).unwrap();
        c.execute("DELETE FROM images WHERE id = 1", []).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn image_tag_sources_returns_rows() {
        let c = conn();
        c.execute("UPDATE images SET positive = 'a, b' WHERE id = 1", []).unwrap();
        let rows = image_tag_sources(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[0].1.as_deref(), Some("a, b"));
        assert_eq!(rows[0].3, "a1111");
    }
}
