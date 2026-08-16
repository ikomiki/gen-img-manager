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
    // v3: filter_history, settings
    "CREATE TABLE filter_history (
        id INTEGER PRIMARY KEY,
        query_text TEXT NOT NULL UNIQUE,
        used_at INTEGER NOT NULL
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    // v4: directories.visible（目玉トグルの表示/非表示状態。既存は全て可視=1）
    "ALTER TABLE directories ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;",
    // v5: tags / image_tags / 分析用テーブル + 分析View
    "CREATE TABLE tags (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE image_tags (
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
        kind     TEXT NOT NULL,
        PRIMARY KEY (image_id, tag_id, kind)
    );
    CREATE INDEX idx_image_tags_tag   ON image_tags(tag_id, kind);
    CREATE TABLE analysis_params (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        apply_exclusion INTEGER NOT NULL DEFAULT 1,
        min_rated_count INTEGER NOT NULL DEFAULT 10,
        prior_weight    REAL    NOT NULL DEFAULT 10
    );
    INSERT INTO analysis_params(id) VALUES (1);
    CREATE TABLE analysis_excluded_tags ( name TEXT PRIMARY KEY );
    INSERT INTO analysis_excluded_tags(name) VALUES
        ('masterpiece'),('best quality'),('worst quality'),('low quality'),
        ('normal quality'),('high quality'),('lowres'),('highres'),('absurdres'),
        ('ultra detailed'),('very detailed'),('8k'),('4k'),
        ('score 9'),('score 8 up'),('score 7 up'),('score 6 up'),('score 5 up'),('score 4 up');
    CREATE TABLE analysis_scope ( image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE );
    CREATE VIEW analysis_images AS
        SELECT i.id, i.rating FROM images i
        WHERE i.missing = 0
          AND i.directory_id IN (SELECT id FROM directories WHERE visible = 1)
          AND (NOT EXISTS(SELECT 1 FROM analysis_scope)
               OR i.id IN (SELECT image_id FROM analysis_scope));
    CREATE VIEW analysis_tag_occurrence AS
        SELECT it.image_id, it.tag_id, t.name, ai.rating
        FROM image_tags it
        JOIN tags t             ON t.id  = it.tag_id
        JOIN analysis_images ai ON ai.id = it.image_id
        WHERE it.kind IN ('prompt','unclassified')
          AND ((SELECT apply_exclusion FROM analysis_params) = 0
               OR t.name NOT IN (SELECT name FROM analysis_excluded_tags));
    CREATE VIEW tag_frequency AS
        SELECT tag_id, name, COUNT(DISTINCT image_id) AS image_count
        FROM analysis_tag_occurrence GROUP BY tag_id, name;
    CREATE VIEW analysis_rating_baseline AS
        SELECT AVG(rating) AS mean_rating FROM analysis_images WHERE rating IS NOT NULL;
    CREATE VIEW tag_rating_lift AS
        SELECT * FROM (
            SELECT tag_id, name,
                COUNT(DISTINCT CASE WHEN rating IS NOT NULL THEN image_id END) AS rated_count,
                AVG(rating) AS raw_avg,
                ( COUNT(DISTINCT CASE WHEN rating IS NOT NULL THEN image_id END) * AVG(rating)
                  + (SELECT prior_weight FROM analysis_params)
                    * (SELECT mean_rating FROM analysis_rating_baseline) )
                / ( COUNT(DISTINCT CASE WHEN rating IS NOT NULL THEN image_id END)
                    + (SELECT prior_weight FROM analysis_params) ) AS adjusted_avg,
                (SELECT mean_rating FROM analysis_rating_baseline) AS overall_avg
            FROM analysis_tag_occurrence GROUP BY tag_id, name
        )
        WHERE rated_count >= (SELECT min_rated_count FROM analysis_params);
    CREATE VIEW tag_rating_distribution AS
        SELECT tag_id, name, rating, COUNT(DISTINCT image_id) AS cnt
        FROM analysis_tag_occurrence GROUP BY tag_id, name, rating;
    CREATE VIEW scope_rating_distribution AS
        SELECT rating, COUNT(*) AS cnt FROM analysis_images GROUP BY rating;",
    // v6: tags にベース名（重み/強調を除いた素のタグ）を追加し、除外照合を重み非依存にする。
    // 既存行は素のタグ（旧ロジックは重みを剥がしていた）なので base_name = name で十分。
    // 新ロジックで作られる重み付きタグの base_name は get_or_create_tag が設定する。
    "ALTER TABLE tags ADD COLUMN base_name TEXT;
    UPDATE tags SET base_name = name;
    DROP VIEW analysis_tag_occurrence;
    CREATE VIEW analysis_tag_occurrence AS
        SELECT it.image_id, it.tag_id, t.name, ai.rating
        FROM image_tags it
        JOIN tags t             ON t.id  = it.tag_id
        JOIN analysis_images ai ON ai.id = it.image_id
        WHERE it.kind IN ('prompt','unclassified')
          AND ((SELECT apply_exclusion FROM analysis_params) = 0
               OR COALESCE(t.base_name, t.name) NOT IN (SELECT name FROM analysis_excluded_tags));",
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
        assert_eq!(v, 6);

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
        assert_eq!(v, 6);
    }

    #[test]
    fn v2_creates_images_and_fts() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6);
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

    #[test]
    fn fts_sync_on_delete_and_update() {
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
             VALUES (?1, '/d/a.png', 'a.png', 10, 20, 4, 4, 16, 'png', 'misty harbor sunrise')",
            rusqlite::params![dir_id],
        )
        .unwrap();
        let img_id = conn.last_insert_rowid();

        // UPDATE: 旧キーワードは消え、新キーワードでヒットする。
        conn.execute(
            "UPDATE images SET positive = 'snowy mountain village' WHERE id = ?1",
            rusqlite::params![img_id],
        )
        .unwrap();
        let old_hits: i64 = conn
            .query_row("SELECT count(*) FROM images_fts WHERE images_fts MATCH 'harbor'", [], |r| r.get(0))
            .unwrap();
        let new_hits: i64 = conn
            .query_row("SELECT count(*) FROM images_fts WHERE images_fts MATCH 'mountain'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old_hits, 0, "old keyword should be gone after update");
        assert_eq!(new_hits, 1, "new keyword should match after update");

        // DELETE: FTSエントリも消える。
        conn.execute("DELETE FROM images WHERE id = ?1", rusqlite::params![img_id]).unwrap();
        let after_delete: i64 = conn
            .query_row("SELECT count(*) FROM images_fts WHERE images_fts MATCH 'mountain'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after_delete, 0, "fts entry should be removed after delete");
    }

    #[test]
    fn v3_creates_history_and_settings_and_version_is_3() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6);
        for name in ["filter_history", "settings"] {
            let c: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [name], |r| r.get(0))
                .unwrap();
            assert_eq!(c, 1, "missing table: {name}");
        }
    }

    #[test]
    fn v4_adds_visible_column_default_1() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6);
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let visible: i64 = conn
            .query_row("SELECT visible FROM directories WHERE path = '/d'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(visible, 1, "new directories must default to visible");
    }

    #[test]
    fn v5_creates_tag_and_analysis_objects() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6);
        for name in [
            "tags", "image_tags", "analysis_params", "analysis_excluded_tags",
            "analysis_scope", "tag_frequency", "tag_rating_lift",
            "tag_rating_distribution", "scope_rating_distribution",
            "analysis_images", "analysis_tag_occurrence", "analysis_rating_baseline",
        ] {
            let c: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [name], |r| r.get(0))
                .unwrap();
            assert!(c >= 1, "missing object: {name}");
        }
        let p: i64 = conn.query_row("SELECT count(*) FROM analysis_params", [], |r| r.get(0)).unwrap();
        assert_eq!(p, 1);
        let masterpiece: i64 = conn
            .query_row("SELECT count(*) FROM analysis_excluded_tags WHERE name='masterpiece'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(masterpiece, 1);
    }

    #[test]
    fn v6_adds_base_name_and_keeps_occurrence_view() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        // base_name 列が存在し、既存行へ name と同値で埋められること。
        conn.execute("INSERT INTO tags (name) VALUES ('forest')", []).unwrap();
        let base: Option<String> = conn
            .query_row("SELECT base_name FROM tags WHERE name='forest'", [], |r| r.get(0))
            .unwrap();
        // 直接 INSERT（base_name 未指定）では NULL だが、列自体は存在する。
        assert!(base.is_none());
        // ビューが再作成され存続していること。
        let c: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='analysis_tag_occurrence'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(c, 1);
    }
}
