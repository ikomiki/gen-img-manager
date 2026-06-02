use rusqlite::Connection;

/// 配列の index+1 がスキーマバージョン。追記のみ・並び替え禁止。
/// 各要素は単一または複数のSQL文。末尾セミコロンは任意（runが正規化する）。
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
    // v2: images, indexes, FTS5, sync triggers
    "CREATE TABLE images (
        id INTEGER PRIMARY KEY,
        directory_id INTEGER NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        created_at INTEGER,
        modified_at INTEGER,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        pixels INTEGER NOT NULL,
        rating INTEGER,
        format TEXT NOT NULL,
        thumb_path TEXT,
        raw_parameters TEXT,
        positive TEXT,
        negative TEXT,
        model TEXT,
        sampler TEXT,
        steps INTEGER,
        seed INTEGER,
        cfg REAL,
        source_tool TEXT NOT NULL DEFAULT 'unknown',
        comfy_workflow TEXT,
        missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_images_directory ON images(directory_id);
    CREATE INDEX idx_images_created ON images(created_at);
    CREATE INDEX idx_images_modified ON images(modified_at);
    CREATE INDEX idx_images_width ON images(width);
    CREATE INDEX idx_images_height ON images(height);
    CREATE INDEX idx_images_pixels ON images(pixels);
    CREATE INDEX idx_images_rating ON images(rating);
    CREATE VIRTUAL TABLE images_fts USING fts5(
        raw_parameters, positive, negative, model, filename,
        content='images', content_rowid='id'
    );
    CREATE TRIGGER images_ai AFTER INSERT ON images BEGIN
        INSERT INTO images_fts(rowid, raw_parameters, positive, negative, model, filename)
        VALUES (new.id, new.raw_parameters, new.positive, new.negative, new.model, new.filename);
    END;
    CREATE TRIGGER images_ad AFTER DELETE ON images BEGIN
        INSERT INTO images_fts(images_fts, rowid, raw_parameters, positive, negative, model, filename)
        VALUES ('delete', old.id, old.raw_parameters, old.positive, old.negative, old.model, old.filename);
    END;
    CREATE TRIGGER images_au AFTER UPDATE ON images BEGIN
        INSERT INTO images_fts(images_fts, rowid, raw_parameters, positive, negative, model, filename)
        VALUES ('delete', old.id, old.raw_parameters, old.positive, old.negative, old.model, old.filename);
        INSERT INTO images_fts(rowid, raw_parameters, positive, negative, model, filename)
        VALUES (new.id, new.raw_parameters, new.positive, new.negative, new.model, new.filename);
    END;",
];

/// 未適用のマイグレーションを順に適用し PRAGMA user_version を更新する。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            // 各マイグレーションは末尾セミコロンの有無に関わらず安全に連結する。
            let stmt = sql.trim().trim_end_matches(';');
            conn.execute_batch(&format!(
                "BEGIN; {stmt}; PRAGMA user_version = {version}; COMMIT;"
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

        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 2);

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
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 2);
    }

    #[test]
    fn v2_creates_images_and_fts_and_version_is_2() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);
        for name in ["images", "images_fts"] {
            let c: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(c >= 1, "missing object: {name}");
        }
    }

    #[test]
    fn fts_is_kept_in_sync_by_triggers() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let dir_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, positive)
             VALUES (?1, '/d/a.png', 'a.png', 10, 20, 4, 4, 16, 'png', 'lonely lighthouse at dusk')",
            rusqlite::params![dir_id],
        )
        .unwrap();
        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM images_fts WHERE images_fts MATCH 'lighthouse'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }
}
