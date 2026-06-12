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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagFreq {
    pub tag_id: i64,
    pub name: String,
    pub image_count: i64,
}

/// 頻度一覧。sort は "count"（既定・降順）か "name"（昇順）。
pub fn tag_frequency(
    conn: &Connection,
    name_filter: Option<&str>,
    sort: &str,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<TagFreq>> {
    let order = if sort == "name" { "name ASC" } else { "image_count DESC, name ASC" };
    let mut params: Vec<Value> = Vec::new();
    let filter_sql = match name_filter {
        Some(f) if !f.is_empty() => {
            params.push(Value::Text(format!("%{}%", escape_like(f))));
            "WHERE name LIKE ? ESCAPE '\\'".to_string()
        }
        _ => String::new(),
    };
    params.push(Value::Integer(limit));
    params.push(Value::Integer(offset));
    let sql = format!(
        "SELECT tag_id, name, image_count FROM tag_frequency {filter_sql} ORDER BY {order} LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params), |r| {
        Ok(TagFreq { tag_id: r.get(0)?, name: r.get(1)?, image_count: r.get(2)? })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiftRow {
    pub tag_id: i64,
    pub name: String,
    pub rated_count: i64,
    pub raw_avg: Option<f64>,
    pub adjusted_avg: Option<f64>,
    pub overall_avg: Option<f64>,
}

/// 高/低評価原因タグ。direction は "high"（adjusted_avg 降順）か "low"（昇順）。
pub fn rating_lift(conn: &Connection, direction: &str, limit: i64) -> rusqlite::Result<Vec<LiftRow>> {
    let order = if direction == "low" { "adjusted_avg ASC" } else { "adjusted_avg DESC" };
    let sql = format!(
        "SELECT tag_id, name, rated_count, raw_avg, adjusted_avg, overall_avg \
         FROM tag_rating_lift ORDER BY {order}, name ASC LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit], |r| {
        Ok(LiftRow {
            tag_id: r.get(0)?,
            name: r.get(1)?,
            rated_count: r.get(2)?,
            raw_avg: r.get(3)?,
            adjusted_avg: r.get(4)?,
            overall_avg: r.get(5)?,
        })
    })?;
    rows.collect()
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

    #[test]
    fn frequency_excludes_negative_and_excluded_list() {
        let c = conn();
        let a = add(&c, "/d/a.png", Some(5), &["forest"]);
        let b = add(&c, "/d/b.png", Some(4), &["forest"]);
        let _ = (a, b);
        let cid = add(&c, "/d/c.png", Some(2), &[]);
        tags::replace_image_tags(&c, cid, &[("blurry", "negative")]).unwrap();
        add(&c, "/d/d.png", Some(5), &["masterpiece"]);

        set_scope(&c, None).unwrap();
        set_params(&c, true, 10, 10.0).unwrap();
        let freq = tag_frequency(&c, None, "count", 100, 0).unwrap();
        let names: Vec<&str> = freq.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["forest"]);
        assert_eq!(freq[0].image_count, 2);
    }

    #[test]
    fn frequency_respects_apply_exclusion_off() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["masterpiece"]);
        set_scope(&c, None).unwrap();
        set_params(&c, false, 10, 10.0).unwrap();
        let freq = tag_frequency(&c, None, "count", 100, 0).unwrap();
        assert_eq!(freq.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["masterpiece"]);
    }

    #[test]
    fn rating_lift_uses_shrinkage_and_threshold() {
        let c = conn();
        for i in 0..4 {
            add(&c, &format!("/d/g{i}.png"), Some(5), &["good"]);
        }
        add(&c, "/d/bad.png", Some(1), &["bad"]);
        set_scope(&c, None).unwrap();
        set_params(&c, true, 3, 2.0).unwrap();
        let high = rating_lift(&c, "high", 10).unwrap();
        assert_eq!(high.len(), 1);
        assert_eq!(high[0].name, "good");
        assert_eq!(high[0].rated_count, 4);
        let adj = high[0].adjusted_avg.unwrap();
        assert!((adj - 4.7333333).abs() < 1e-4, "adjusted_avg = {adj}");
        assert!((high[0].overall_avg.unwrap() - 4.2).abs() < 1e-9);
    }
}
