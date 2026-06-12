use crate::query::{compile, parse};
use rusqlite::{params, params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 分析スコープを設定する。None=全体（空テーブル）、Some(query)=フィルタ範囲。
pub fn set_scope(conn: &Connection, query: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM analysis_scope", [])?;
    if let Some(q) = query {
        let cf = compile::compile(&parse::parse(q));
        let sql = format!(
            "INSERT INTO analysis_scope (image_id) \
             SELECT id FROM images WHERE ({}) \
             AND directory_id IN (SELECT id FROM directories WHERE visible = 1)",
            cf.where_sql
        );
        conn.execute(&sql, params_from_iter(cf.params))?;
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RatingBucket {
    pub rating: Option<i64>,
    pub cnt: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagRatingAnalysis {
    pub has: Vec<RatingBucket>,
    pub without: Vec<RatingBucket>,
    pub has_avg: Option<f64>,
    pub without_avg: Option<f64>,
}

/// 特定タグの「ある/ない」レーティング別件数と平均（評価済みのみ平均）。
pub fn tag_rating_analysis(conn: &Connection, tag_id: i64) -> rusqlite::Result<TagRatingAnalysis> {
    use std::collections::HashMap;
    let mut has_map: HashMap<Option<i64>, i64> = HashMap::new();
    {
        let mut stmt =
            conn.prepare("SELECT rating, cnt FROM tag_rating_distribution WHERE tag_id = ?1")?;
        let rows = stmt.query_map([tag_id], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (rt, cnt) = row?;
            has_map.insert(rt, cnt);
        }
    }
    let mut scope_map: HashMap<Option<i64>, i64> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT rating, cnt FROM scope_rating_distribution")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (rt, cnt) = row?;
            scope_map.insert(rt, cnt);
        }
    }
    let mut keys: Vec<Option<i64>> = scope_map.keys().chain(has_map.keys()).cloned().collect();
    keys.sort();
    keys.dedup();

    let mut has = Vec::new();
    let mut without = Vec::new();
    for k in keys {
        let h = *has_map.get(&k).unwrap_or(&0);
        let s = *scope_map.get(&k).unwrap_or(&0);
        let w = (s - h).max(0);
        has.push(RatingBucket { rating: k, cnt: h });
        without.push(RatingBucket { rating: k, cnt: w });
    }
    let avg = |buckets: &[RatingBucket]| -> Option<f64> {
        let mut sum = 0i64;
        let mut n = 0i64;
        for b in buckets {
            if let Some(r) = b.rating {
                sum += r * b.cnt;
                n += b.cnt;
            }
        }
        if n > 0 { Some(sum as f64 / n as f64) } else { None }
    };
    let has_avg = avg(&has);
    let without_avg = avg(&without);
    Ok(TagRatingAnalysis { has, without, has_avg, without_avg })
}

/// 除外タグ一覧（名前昇順）。
pub fn list_excluded(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM analysis_excluded_tags ORDER BY name")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// 除外タグを追加する（既存なら無視）。
pub fn add_excluded(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT OR IGNORE INTO analysis_excluded_tags(name) VALUES (?1)", params![name])?;
    Ok(())
}

/// 除外タグを削除する。
pub fn remove_excluded(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM analysis_excluded_tags WHERE name = ?1", params![name])?;
    Ok(())
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
                positive: if prompt_tags.is_empty() { None } else { Some(prompt_tags.join(", ")) },
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
    fn set_scope_query_uses_fts_not_tag_names() {
        let c = conn();
        // 画像 a: positive に "forest" を含む（FTSで一致する）。
        add(&c, "/d/a.png", Some(5), &["forest"]);
        // 画像 b: positive は別語だが image_tags には "forest" タグだけ付与。
        let bid = crate::db::images::upsert(
            &c,
            &NewImage {
                directory_id: 1,
                path: "/d/b.png".into(),
                filename: "b.png".into(),
                size: 1,
                mtime: 1,
                width: 4,
                height: 4,
                rating: Some(4),
                format: "png".into(),
                positive: Some("mountain".into()),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();
        tags::replace_image_tags(&c, bid, &[("forest", "prompt")]).unwrap();
        set_scope(&c, Some("forest")).unwrap();
        // FTSのみで一致する a だけがスコープに入る（タグ名一致の b は入らない）。
        let n: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let in_scope: i64 = c
            .query_row("SELECT count(*) FROM analysis_scope WHERE image_id = ?1", [bid], |r| r.get(0))
            .unwrap();
        assert_eq!(in_scope, 0, "タグ名のみ一致の画像はFTSスコープに入らない");
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

    #[test]
    fn tag_rating_analysis_has_and_without() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["forest"]);
        add(&c, "/d/b.png", Some(3), &["forest"]);
        add(&c, "/d/c.png", Some(4), &["mountain"]);
        add(&c, "/d/d.png", None, &["mountain"]);
        set_scope(&c, None).unwrap();
        set_params(&c, true, 1, 10.0).unwrap();
        let forest_id: i64 = c.query_row("SELECT id FROM tags WHERE name='forest'", [], |r| r.get(0)).unwrap();
        let a = tag_rating_analysis(&c, forest_id).unwrap();
        assert!((a.has_avg.unwrap() - 4.0).abs() < 1e-9);
        assert!((a.without_avg.unwrap() - 4.0).abs() < 1e-9);
        let has_total: i64 = a.has.iter().map(|b| b.cnt).sum();
        let without_total: i64 = a.without.iter().map(|b| b.cnt).sum();
        assert_eq!(has_total, 2);
        assert_eq!(without_total, 2);
    }

    #[test]
    fn excluded_list_crud() {
        let c = conn();
        add_excluded(&c, "score 9").unwrap();
        add_excluded(&c, "score 9").unwrap();
        assert!(list_excluded(&c).unwrap().contains(&"score 9".to_string()));
        remove_excluded(&c, "masterpiece").unwrap();
        assert!(!list_excluded(&c).unwrap().contains(&"masterpiece".to_string()));
    }
}
