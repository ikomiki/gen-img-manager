use super::{Cond, CondOp, ParsedQuery};
use rusqlite::types::Value;

/// コンパイル済みフィルタ。`where_sql` は "WHERE" を含まない条件式、`params` は束縛値。
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledFilter {
    pub where_sql: String,
    pub params: Vec<Value>,
}

/// ParsedQuery を SQL の WHERE 条件式へコンパイルする。
/// 常に missing=0 を基底とし、FTSとCondをANDで結合する。
pub fn compile(pq: &ParsedQuery) -> CompiledFilter {
    let mut clauses: Vec<String> = vec!["missing = 0".to_string()];
    let mut params: Vec<Value> = Vec::new();

    // images_fts は content='images', content_rowid='id' のため rowid = images.id。
    if let Some(inc) = &pq.fts_include {
        clauses.push("id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)".to_string());
        params.push(Value::Text(inc.clone()));
    }
    if let Some(exc) = &pq.fts_exclude {
        clauses.push("id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)".to_string());
        params.push(Value::Text(exc.clone()));
    }

    for cond in &pq.conds {
        let (frag, ps) = compile_cond(cond);
        clauses.push(frag);
        params.extend(ps);
    }

    CompiledFilter {
        where_sql: clauses.join(" AND "),
        params,
    }
}

fn compile_cond(cond: &Cond) -> (String, Vec<Value>) {
    let col = cond.column;
    let (frag, params) = match &cond.op {
        CondOp::Like(v) => {
            // LIKEのワイルドカード(%/_)と\をエスケープし、ESCAPE句で無害化する。
            let escaped = v.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            (
                format!("{col} LIKE ? ESCAPE '\\'"),
                vec![Value::Text(format!("%{escaped}%"))],
            )
        }
        CondOp::Ge(n) => (format!("{col} >= ?"), vec![Value::Integer(*n)]),
        CondOp::Le(n) => (format!("{col} <= ?"), vec![Value::Integer(*n)]),
        CondOp::Gt(n) => (format!("{col} > ?"), vec![Value::Integer(*n)]),
        CondOp::Lt(n) => (format!("{col} < ?"), vec![Value::Integer(*n)]),
        CondOp::Eq(n) => (format!("{col} = ?"), vec![Value::Integer(*n)]),
        CondOp::Range(a, b) => (
            format!("{col} BETWEEN ? AND ?"),
            vec![Value::Integer(*a), Value::Integer(*b)],
        ),
    };
    if cond.negate {
        (format!("NOT ({frag})"), params)
    } else {
        (frag, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::parse::parse;

    #[test]
    fn empty_query_is_missing_zero_only() {
        let cf = compile(&parse(""));
        assert_eq!(cf.where_sql, "missing = 0");
        assert!(cf.params.is_empty());
    }

    #[test]
    fn include_and_exclude_and_conds() {
        let cf = compile(&parse("forest -blurry rating:>=4"));
        assert_eq!(
            cf.where_sql,
            "missing = 0 AND id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?) \
             AND id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?) AND rating >= ?"
        );
        assert_eq!(cf.params.len(), 3);
        assert_eq!(cf.params[0], Value::Text("\"forest\"".to_string()));
        assert_eq!(cf.params[1], Value::Text("\"blurry\"".to_string()));
        assert_eq!(cf.params[2], Value::Integer(4));
    }

    #[test]
    fn like_wraps_with_percent() {
        let cf = compile(&parse("sampler:euler"));
        assert_eq!(cf.where_sql, "missing = 0 AND sampler LIKE ? ESCAPE '\\'");
        assert_eq!(cf.params[0], Value::Text("%euler%".to_string()));
    }

    #[test]
    fn negate_cond_wraps_with_not() {
        let cf = compile(&parse("-rating:>=4"));
        assert_eq!(cf.where_sql, "missing = 0 AND NOT (rating >= ?)");
        assert_eq!(cf.params[0], Value::Integer(4));
    }

    #[test]
    fn like_escapes_wildcards() {
        let cf = compile(&parse("tool:comfy_ui"));
        assert_eq!(cf.where_sql, "missing = 0 AND source_tool LIKE ? ESCAPE '\\'");
        // _ がエスケープされている
        assert_eq!(cf.params[0], Value::Text("%comfy\\_ui%".to_string()));
    }

    #[test]
    fn range_uses_between() {
        let cf = compile(&parse("steps:20..40"));
        assert_eq!(cf.where_sql, "missing = 0 AND steps BETWEEN ? AND ?");
        assert_eq!(cf.params, vec![Value::Integer(20), Value::Integer(40)]);
    }
}
