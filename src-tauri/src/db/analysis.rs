use crate::query::{compile, parse};
use rusqlite::{params, params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 分析スコープを設定する。None=全体（空テーブル）、Some(query)=フィルタ範囲。
pub fn set_scope(conn: &Connection, query: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM analysis_scope", [])?;
    if let Some(q) = query {
        let pq = parse::parse(q);
        let cf = compile::compile(&pq);
        // images テーブル（FTS + 構造化条件）にマッチする行を挿入。
        let sql = format!(
            "INSERT OR IGNORE INTO analysis_scope (image_id) \
             SELECT id FROM images WHERE ({}) \
             AND directory_id IN (SELECT id FROM directories WHERE visible = 1)",
            cf.where_sql
        );
        conn.execute(&sql, params_from_iter(cf.params))?;
        // FTS 検索語は image_tags にも格納されるため、タグ名での補完検索を行う。
        // FTS 式の形式: `"term1" AND "term2"` → 各 term でタグ名完全一致。
        if let Some(fts_expr) = &pq.fts_include {
            let terms: Vec<String> = fts_expr
                .split(" AND ")
                .flat_map(|s| s.split(" OR "))
                .map(|s| s.trim().trim_matches('"').replace("\"\"", "\""))
                .filter(|s| !s.is_empty())
                .collect();
            for term in terms {
                conn.execute(
                    "INSERT OR IGNORE INTO analysis_scope (image_id) \
                     SELECT it.image_id FROM image_tags it \
                     JOIN tags t ON t.id = it.tag_id \
                     JOIN images i ON i.id = it.image_id \
                     WHERE t.name = ?1 \
                     AND i.missing = 0 \
                     AND i.directory_id IN (SELECT id FROM directories WHERE visible = 1)",
                    params![term],
                )?;
            }
        }
    }
    Ok(())
}

/// 分析パラメータ（1行）を更新する。
pub fn set_params(
    conn: &Connection,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE analysis_params SET apply_exclusion = ?1, min_rated_count = ?2, prior_weight = ?3 WHERE id = 1",
        params![apply_exclusion as i64, min_rated_count, prior_weight],
    )?;
    Ok(())
}

/// LIKE のワイルドカードをエスケープする（name_filter 用）。
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{images::NewImage, migrations, tags};

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute("INSERT INTO directories (path, label, recursive) VALUES ('/d','d',1)", []).unwrap();
        c
    }

    /// 画像を1件入れてタグを紐付け、id を返す。
    fn add(c: &Connection, path: &str, rating: Option<i64>, prompt_tags: &[&str]) -> i64 {
        let id = crate::db::images::upsert(
            c,
            &NewImage {
                directory_id: 1,
                path: path.to_string(),
                filename: path.to_string(),
                size: 1,
                mtime: 1,
                width: 4,
                height: 4,
                rating,
                format: "png".into(),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let pairs: Vec<(&str, &str)> = prompt_tags.iter().map(|t| (*t, "prompt")).collect();
        tags::replace_image_tags(c, id, &pairs).unwrap();
        id
    }

    #[test]
    fn set_scope_none_clears_table() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["forest"]);
        set_scope(&c, Some("forest")).unwrap();
        let n1: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n1, 1);
        set_scope(&c, None).unwrap();
        let n2: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n2, 0);
    }

    #[test]
    fn set_scope_query_inserts_matching_ids() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["forest"]);
        add(&c, "/d/b.png", Some(3), &["mountain"]);
        set_scope(&c, Some("rating:>=4")).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn set_params_updates_row() {
        let c = conn();
        set_params(&c, false, 25, 7.5).unwrap();
        let (ex, mn, pw): (i64, i64, f64) = c
            .query_row("SELECT apply_exclusion, min_rated_count, prior_weight FROM analysis_params WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((ex, mn), (0, 25));
        assert!((pw - 7.5).abs() < 1e-9);
    }
}
