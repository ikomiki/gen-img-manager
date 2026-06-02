use rusqlite::{params, Connection};

/// images へ挿入/更新する1件分のデータ。pixels は width*height で算出する。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewImage {
    pub directory_id: i64,
    pub path: String,
    pub filename: String,
    pub size: i64,
    pub mtime: i64,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub width: i64,
    pub height: i64,
    pub rating: Option<i64>,
    pub format: String,
    pub thumb_path: Option<String>,
    pub raw_parameters: Option<String>,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
    pub source_tool: String,
    pub comfy_workflow: Option<String>,
}

/// path 一意制約で UPSERT し、行 id を返す。再登録時は missing=0 に戻す。
pub fn upsert(conn: &Connection, img: &NewImage) -> rusqlite::Result<i64> {
    conn.query_row(
        "INSERT INTO images (
            directory_id, path, filename, size, mtime, created_at, modified_at,
            width, height, pixels, rating, format, thumb_path,
            raw_parameters, positive, negative, model, sampler, steps, seed, cfg,
            source_tool, comfy_workflow, missing
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, 0
        )
        ON CONFLICT(path) DO UPDATE SET
            directory_id=excluded.directory_id, filename=excluded.filename,
            size=excluded.size, mtime=excluded.mtime,
            created_at=excluded.created_at, modified_at=excluded.modified_at,
            width=excluded.width, height=excluded.height, pixels=excluded.pixels,
            rating=excluded.rating, format=excluded.format, thumb_path=excluded.thumb_path,
            raw_parameters=excluded.raw_parameters, positive=excluded.positive,
            negative=excluded.negative, model=excluded.model, sampler=excluded.sampler,
            steps=excluded.steps, seed=excluded.seed, cfg=excluded.cfg,
            source_tool=excluded.source_tool, comfy_workflow=excluded.comfy_workflow,
            missing=0
        RETURNING id",
        params![
            img.directory_id, img.path, img.filename, img.size, img.mtime,
            img.created_at, img.modified_at,
            img.width, img.height, img.width * img.height, img.rating, img.format, img.thumb_path,
            img.raw_parameters, img.positive, img.negative, img.model, img.sampler,
            img.steps, img.seed, img.cfg, img.source_tool, img.comfy_workflow,
        ],
        |r| r.get(0),
    )
}

/// 変更検出用。path から (id, size, mtime) を返す。無ければ None。
pub fn find_meta_by_path(
    conn: &Connection,
    path: &str,
) -> rusqlite::Result<Option<(i64, i64, i64)>> {
    let mut stmt =
        conn.prepare("SELECT id, size, mtime FROM images WHERE path = ?1")?;
    let mut rows = stmt.query(params![path])?;
    match rows.next()? {
        Some(r) => Ok(Some((r.get(0)?, r.get(1)?, r.get(2)?))),
        None => Ok(None),
    }
}

/// ディレクトリ配下の (id, path) 一覧。missing 検出に使う。
pub fn list_paths_in_directory(
    conn: &Connection,
    directory_id: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, path FROM images WHERE directory_id = ?1")?;
    let rows = stmt.query_map(params![directory_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// ディレクトリ配下の (path, id, size, mtime, missing) 一覧。
/// 変更検出（事前ロードマップ）と missing 検出の両方に使う。
pub fn list_meta_in_directory(
    conn: &Connection,
    directory_id: i64,
) -> rusqlite::Result<Vec<(String, i64, i64, i64, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT path, id, size, mtime, missing FROM images WHERE directory_id = ?1",
    )?;
    let rows = stmt.query_map(params![directory_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)? != 0,
        ))
    })?;
    rows.collect()
}

pub fn mark_missing(conn: &Connection, id: i64, missing: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE images SET missing = ?2 WHERE id = ?1",
        params![id, missing as i64],
    )?;
    Ok(())
}

pub fn count_in_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT count(*) FROM images WHERE directory_id = ?1 AND missing = 0",
        params![directory_id],
        |r| r.get(0),
    )
}

pub fn delete_by_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM images WHERE directory_id = ?1", params![directory_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

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

    fn sample(path: &str) -> NewImage {
        NewImage {
            directory_id: 1,
            path: path.to_string(),
            filename: "a.png".to_string(),
            size: 100,
            mtime: 200,
            width: 4,
            height: 2,
            format: "png".to_string(),
            source_tool: "unknown".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn upsert_inserts_and_computes_pixels() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        let pixels: i64 = c
            .query_row("SELECT pixels FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(pixels, 8);
    }

    #[test]
    fn upsert_on_same_path_updates_not_duplicates() {
        let c = conn();
        let id1 = upsert(&c, &sample("/d/a.png")).unwrap();
        let mut changed = sample("/d/a.png");
        changed.size = 999;
        let id2 = upsert(&c, &changed).unwrap();
        assert_eq!(id1, id2);
        let count: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let size: i64 = c
            .query_row("SELECT size FROM images WHERE id = ?1", params![id2], |r| r.get(0))
            .unwrap();
        assert_eq!(size, 999);
    }

    #[test]
    fn find_meta_by_path_roundtrip() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        assert_eq!(find_meta_by_path(&c, "/d/a.png").unwrap(), Some((id, 100, 200)));
        assert_eq!(find_meta_by_path(&c, "/d/none.png").unwrap(), None);
    }

    #[test]
    fn mark_missing_excludes_from_count() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        assert_eq!(count_in_directory(&c, 1).unwrap(), 1);
        mark_missing(&c, id, true).unwrap();
        assert_eq!(count_in_directory(&c, 1).unwrap(), 0);
    }

    #[test]
    fn delete_by_directory_removes_rows() {
        let c = conn();
        upsert(&c, &sample("/d/a.png")).unwrap();
        upsert(&c, &sample("/d/b.png")).unwrap();
        delete_by_directory(&c, 1).unwrap();
        let count: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn list_meta_in_directory_returns_all_fields() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        mark_missing(&c, id, true).unwrap();
        let metas = list_meta_in_directory(&c, 1).unwrap();
        assert_eq!(metas.len(), 1);
        let (path, got_id, size, mtime, missing) = &metas[0];
        assert_eq!(path, "/d/a.png");
        assert_eq!(*got_id, id);
        assert_eq!(*size, 100);
        assert_eq!(*mtime, 200);
        assert!(*missing);
    }
}
