use crate::db::{settings, tags};
use crate::parser::tags::extract_tags;
use rusqlite::Connection;

const FLAG: &str = "tags_backfilled";

/// 起動時に一度だけ、既存画像の positive/negative 列からタグを生成する。
/// すでに実行済み（settings フラグあり）なら何もしない。
pub fn run_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    if settings::get(conn, FLAG)?.is_some() {
        return Ok(());
    }
    let sources = tags::image_tag_sources(conn)?;
    for (id, positive, negative, source_tool) in &sources {
        let extracted = extract_tags(positive.as_deref(), negative.as_deref(), source_tool);
        let pairs: Vec<(&str, &str)> =
            extracted.iter().map(|(n, k)| (n.as_str(), k.as_str())).collect();
        tags::replace_image_tags(conn, *id, &pairs)?;
    }
    settings::set(conn, FLAG, "1")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute("INSERT INTO directories (path, label, recursive) VALUES ('/d','d',1)", []).unwrap();
        c
    }

    fn add_image(c: &Connection, path: &str, pos: &str, neg: Option<&str>, tool: &str) {
        c.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, source_tool, positive, negative)
             VALUES (1, ?1, ?1, 1, 1, 4, 4, 16, 'png', ?2, ?3, ?4)",
            rusqlite::params![path, tool, pos, neg],
        )
        .unwrap();
    }

    #[test]
    fn backfills_existing_images_and_sets_flag() {
        let c = conn();
        add_image(&c, "/d/a.png", "forest, 1girl", Some("blurry"), "a1111");
        add_image(&c, "/d/b.png", "neon city", None, "comfyui");

        run_if_needed(&c).unwrap();

        let prompt: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='prompt'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prompt, 2); // forest, 1girl
        let neg: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='negative'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(neg, 1); // blurry
        let unclassified: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='unclassified'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(unclassified, 1); // neon city
        assert_eq!(settings::get(&c, "tags_backfilled").unwrap(), Some("1".to_string()));
    }

    #[test]
    fn is_noop_when_already_done() {
        let c = conn();
        settings::set(&c, "tags_backfilled", "1").unwrap();
        add_image(&c, "/d/a.png", "forest", None, "a1111");
        run_if_needed(&c).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "backfill 済みなら触らない");
    }
}
