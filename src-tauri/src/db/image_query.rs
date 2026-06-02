use crate::query::{compile, parse, SortDir, SortKey};
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 一覧表示用の画像行（必要列のみ）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageRow {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub thumb_path: Option<String>,
    pub width: i64,
    pub height: i64,
    pub pixels: i64,
    pub rating: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub source_tool: String,
    pub model: Option<String>,
}

const SELECT_COLS: &str = "id, path, filename, thumb_path, width, height, pixels, rating, \
                           created_at, modified_at, source_tool, model";

fn row_to_image(r: &rusqlite::Row) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow {
        id: r.get(0)?,
        path: r.get(1)?,
        filename: r.get(2)?,
        thumb_path: r.get(3)?,
        width: r.get(4)?,
        height: r.get(5)?,
        pixels: r.get(6)?,
        rating: r.get(7)?,
        created_at: r.get(8)?,
        modified_at: r.get(9)?,
        source_tool: r.get(10)?,
        model: r.get(11)?,
    })
}

/// クエリ文字列でフィルタし、ソート・ページングして画像行を返す。
pub fn query_images(
    conn: &Connection,
    query_text: &str,
    sort: SortKey,
    dir: SortDir,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<ImageRow>> {
    let cf = compile::compile(&parse::parse(query_text));
    let sql = format!(
        "SELECT {cols} FROM images WHERE {where_sql} ORDER BY {sortcol} {sortdir}, id {sortdir} LIMIT ? OFFSET ?",
        cols = SELECT_COLS,
        where_sql = cf.where_sql,
        sortcol = sort.column(),
        sortdir = dir.sql(),
    );
    let mut p = cf.params;
    p.push(Value::Integer(limit));
    p.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(p), row_to_image)?;
    rows.collect()
}

/// クエリ文字列に一致する画像件数を返す。
pub fn count_query(conn: &Connection, query_text: &str) -> rusqlite::Result<i64> {
    let cf = compile::compile(&parse::parse(query_text));
    let sql = format!("SELECT count(*) FROM images WHERE {}", cf.where_sql);
    conn.query_row(&sql, params_from_iter(cf.params), |r| r.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{images::NewImage, migrations};

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        c.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        c
    }

    fn img(path: &str, positive: &str, rating: Option<i64>, width: i64) -> NewImage {
        NewImage {
            directory_id: 1,
            path: path.to_string(),
            filename: path.rsplit('/').next().unwrap().to_string(),
            size: 1,
            mtime: 1,
            created_at: Some(1000),
            modified_at: Some(1000),
            width,
            height: 100,
            rating,
            format: "png".to_string(),
            positive: Some(positive.to_string()),
            raw_parameters: Some(positive.to_string()),
            source_tool: "a1111".to_string(),
            ..Default::default()
        }
    }

    fn seed(c: &Connection) {
        crate::db::images::upsert(c, &img("/d/a.png", "forest cabin", Some(5), 1024)).unwrap();
        crate::db::images::upsert(c, &img("/d/b.png", "forest blurry", Some(3), 512)).unwrap();
        crate::db::images::upsert(c, &img("/d/c.png", "mountain peak", Some(4), 2048)).unwrap();
    }

    #[test]
    fn empty_query_returns_all_non_missing() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(count_query(&c, "").unwrap(), 3);
    }

    #[test]
    fn fts_include_filters() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "forest", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(count_query(&c, "forest").unwrap(), 2);
    }

    #[test]
    fn fts_exclude_filters() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "forest -blurry", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].filename, "a.png");
    }

    #[test]
    fn rating_and_width_conds() {
        let c = conn();
        seed(&c);
        let n = count_query(&c, "rating:>=4 width:>=1024").unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn sort_asc_desc_by_filename() {
        let c = conn();
        seed(&c);
        let asc = query_images(&c, "", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        let desc = query_images(&c, "", SortKey::Filename, SortDir::Desc, 100, 0).unwrap();
        assert_eq!(asc.first().unwrap().filename, "a.png");
        assert_eq!(desc.first().unwrap().filename, "c.png");
    }

    #[test]
    fn limit_and_offset_paginate() {
        let c = conn();
        seed(&c);
        let page1 = query_images(&c, "", SortKey::Filename, SortDir::Asc, 2, 0).unwrap();
        let page2 = query_images(&c, "", SortKey::Filename, SortDir::Asc, 2, 2).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 1);
        assert_eq!(page2[0].filename, "c.png");
    }

    #[test]
    fn missing_rows_excluded() {
        let c = conn();
        seed(&c);
        c.execute("UPDATE images SET missing = 1 WHERE filename = 'a.png'", []).unwrap();
        assert_eq!(count_query(&c, "").unwrap(), 2);
    }
}
