use chrono::{Local, NaiveDate, TimeZone};
use super::{Cond, CondOp, ParsedQuery};

/// クエリフィールド名 -> FTS列名（テキスト系フィールド）。
fn text_field_column(field: &str) -> Option<&'static str> {
    match field {
        "prompt" => Some("positive"),
        "negative" => Some("negative"),
        "model" => Some("model"),
        "filename" => Some("filename"),
        _ => None,
    }
}

enum FieldKind {
    Like,
    Num { is_date: bool },
}

/// 構造化フィールド -> (列名, 種別)。
fn struct_field(field: &str) -> Option<(&'static str, FieldKind)> {
    match field {
        "sampler" => Some(("sampler", FieldKind::Like)),
        "tool" => Some(("source_tool", FieldKind::Like)),
        "rating" => Some(("rating", FieldKind::Num { is_date: false })),
        "width" => Some(("width", FieldKind::Num { is_date: false })),
        "height" => Some(("height", FieldKind::Num { is_date: false })),
        "pixels" => Some(("pixels", FieldKind::Num { is_date: false })),
        "steps" => Some(("steps", FieldKind::Num { is_date: false })),
        "seed" => Some(("seed", FieldKind::Num { is_date: false })),
        "created" => Some(("created_at", FieldKind::Num { is_date: true })),
        "modified" => Some(("modified_at", FieldKind::Num { is_date: true })),
        _ => None,
    }
}

struct RawToken {
    /// クォートを外した全文（例 prompt:a b）。
    text: String,
    /// クォートが1度でも出現したか。
    quoted: bool,
    /// 最初のクォートより前の「素の」リード部（例 prompt:"a b" なら "prompt:"）。
    /// クォートが先頭から始まる純粋句では空になる。
    lead: String,
}

/// 空白区切り。ダブルクォートで囲まれた部分は1トークン（クォートは外す）。
/// lead にはクォート前の素のテキストを記録し、フィールド判定に用いる。
fn tokenize(input: &str) -> Vec<RawToken> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut lead = String::new();
    let mut in_quote = false;
    let mut quoted = false;

    let flush = |cur: &mut String, lead: &mut String, quoted: &mut bool, tokens: &mut Vec<RawToken>| {
        if !cur.is_empty() || *quoted {
            tokens.push(RawToken {
                text: std::mem::take(cur),
                quoted: *quoted,
                lead: std::mem::take(lead),
            });
            *quoted = false;
        } else {
            lead.clear();
        }
    };

    for c in input.chars() {
        match c {
            '"' => {
                if in_quote {
                    in_quote = false;
                } else {
                    in_quote = true;
                    quoted = true;
                }
            }
            c if c.is_whitespace() && !in_quote => {
                flush(&mut cur, &mut lead, &mut quoted, &mut tokens);
            }
            _ => {
                cur.push(c);
                if !quoted {
                    lead.push(c);
                }
            }
        }
    }
    flush(&mut cur, &mut lead, &mut quoted, &mut tokens);
    tokens
}

/// FTS5 用に語/句をダブルクォートで囲む（特殊文字を無害化）。
fn fts_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// 数値/日時の値を CondOp に変換する。日時は epoch 秒へ。
fn parse_value_op(value: &str, is_date: bool) -> Option<CondOp> {
    let to_num = |s: &str| -> Option<i64> {
        if is_date {
            date_to_epoch(s, false)
        } else {
            s.parse::<i64>().ok()
        }
    };
    if let Some(rest) = value.strip_prefix(">=") {
        return to_num(rest).map(CondOp::Ge);
    }
    if let Some(rest) = value.strip_prefix("<=") {
        return to_num(rest).map(CondOp::Le);
    }
    if let Some(rest) = value.strip_prefix('>') {
        return to_num(rest).map(CondOp::Gt);
    }
    if let Some(rest) = value.strip_prefix('<') {
        return to_num(rest).map(CondOp::Lt);
    }
    if let Some((a, b)) = value.split_once("..") {
        let lo = if is_date { date_to_epoch(a, false) } else { a.parse().ok() };
        let hi = if is_date { date_to_epoch(b, true) } else { b.parse().ok() };
        return match (lo, hi) {
            (Some(lo), Some(hi)) if lo <= hi => Some(CondOp::Range(lo, hi)),
            _ => None,
        };
    }
    if is_date {
        match (date_to_epoch(value, false), date_to_epoch(value, true)) {
            (Some(lo), Some(hi)) => Some(CondOp::Range(lo, hi)),
            _ => None,
        }
    } else {
        to_num(value).map(CondOp::Eq)
    }
}

/// "YYYY-MM-DD" をローカルTZの epoch 秒へ。end_of_day=true なら同日 23:59:59。
/// DST の重なり/欠落は最早の瞬間を採用する。
fn date_to_epoch(s: &str, end_of_day: bool) -> Option<i64> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    let date = NaiveDate::from_ymd_opt(y, m, d)?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)?
    } else {
        date.and_hms_opt(0, 0, 0)?
    };
    Local.from_local_datetime(&naive).earliest().map(|dt| dt.timestamp())
}

/// クエリ文字列をパースする。
pub fn parse(input: &str) -> ParsedQuery {
    let tokens = tokenize(input);
    let mut include = String::new();
    let mut include_or_pending = false;
    let mut excludes: Vec<String> = Vec::new();
    let mut conds: Vec<Cond> = Vec::new();

    let append_include = |buf: &mut String, or_pending: &mut bool, expr: &str| {
        if !buf.is_empty() {
            buf.push_str(if *or_pending { " OR " } else { " AND " });
        }
        buf.push_str(expr);
        *or_pending = false;
    };

    for tok in tokens {
        if !tok.quoted && tok.text.eq_ignore_ascii_case("OR") {
            include_or_pending = true;
            continue;
        }

        // 先頭 '-' は除外。判定は素のリード部で行う（純粋句 "..." は lead が空なので除外記号を持てない）。
        let negate = tok.lead.starts_with('-');
        let body = if negate { tok.text[1..].to_string() } else { tok.text.clone() };
        let lead = if negate { tok.lead[1..].to_string() } else { tok.lead.clone() };
        if body.is_empty() {
            continue;
        }

        // フィールド検出はクォート前の lead 内のコロンで行う。
        // lead は body の先頭と一致するため、コロン位置は body 上でも同じ。
        if let Some(colon) = lead.find(':') {
            let field = &lead[..colon];
            let value = &body[colon + 1..];
            if !value.is_empty() {
                if let Some((column, kind)) = struct_field(field) {
                    let op = match kind {
                        FieldKind::Like => Some(CondOp::Like(value.to_string())),
                        FieldKind::Num { is_date } => parse_value_op(value, is_date),
                    };
                    if let Some(op) = op {
                        conds.push(Cond { column, op, negate });
                    }
                    continue;
                }
                if let Some(col) = text_field_column(field) {
                    let expr = format!("{} : {}", col, fts_quote(value));
                    if negate {
                        excludes.push(expr);
                    } else {
                        append_include(&mut include, &mut include_or_pending, &expr);
                    }
                    continue;
                }
            }
        }

        let expr = fts_quote(&body);
        if negate {
            excludes.push(expr);
        } else {
            append_include(&mut include, &mut include_or_pending, &expr);
        }
    }

    ParsedQuery {
        fts_include: if include.is_empty() { None } else { Some(include) },
        fts_exclude: if excludes.is_empty() { None } else { Some(excludes.join(" OR ")) },
        conds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_terms_are_anded_and_quoted() {
        let pq = parse("masterpiece forest");
        assert_eq!(pq.fts_include.as_deref(), Some("\"masterpiece\" AND \"forest\""));
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn or_operator() {
        let pq = parse("forest OR mountain");
        assert_eq!(pq.fts_include.as_deref(), Some("\"forest\" OR \"mountain\""));
    }

    #[test]
    fn quoted_phrase() {
        let pq = parse("\"best quality\"");
        assert_eq!(pq.fts_include.as_deref(), Some("\"best quality\""));
    }

    #[test]
    fn text_field_maps_to_fts_column() {
        let pq = parse("prompt:forest");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"forest\""));
    }

    #[test]
    fn exclusion_goes_to_exclude_expr() {
        let pq = parse("forest -blurry");
        assert_eq!(pq.fts_include.as_deref(), Some("\"forest\""));
        assert_eq!(pq.fts_exclude.as_deref(), Some("\"blurry\""));
    }

    #[test]
    fn field_exclusion() {
        let pq = parse("-negative:blurry");
        assert_eq!(pq.fts_include, None);
        assert_eq!(pq.fts_exclude.as_deref(), Some("negative : \"blurry\""));
    }

    #[test]
    fn numeric_comparisons_and_ranges() {
        let pq = parse("rating:>=4 width:>=1024 steps:20..40");
        assert_eq!(pq.fts_include, None);
        assert_eq!(
            pq.conds,
            vec![
                Cond { column: "rating", op: CondOp::Ge(4), negate: false },
                Cond { column: "width", op: CondOp::Ge(1024), negate: false },
                Cond { column: "steps", op: CondOp::Range(20, 40), negate: false },
            ]
        );
    }

    #[test]
    fn sampler_and_tool_are_like_conds() {
        let pq = parse("sampler:euler tool:comfyui");
        assert_eq!(
            pq.conds,
            vec![
                Cond { column: "sampler", op: CondOp::Like("euler".into()), negate: false },
                Cond { column: "source_tool", op: CondOp::Like("comfyui".into()), negate: false },
            ]
        );
    }

    #[test]
    fn date_range_converts_to_epoch_seconds() {
        use chrono::{Local, NaiveDate, TimeZone};
        let pq = parse("created:2025-01-01..2025-01-02");
        assert_eq!(pq.conds.len(), 1);
        assert_eq!(pq.conds[0].column, "created_at");
        let lo = Local
            .from_local_datetime(&NaiveDate::from_ymd_opt(2025, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .unwrap()
            .timestamp();
        let hi = Local
            .from_local_datetime(&NaiveDate::from_ymd_opt(2025, 1, 2).unwrap().and_hms_opt(23, 59, 59).unwrap())
            .earliest()
            .unwrap()
            .timestamp();
        assert_eq!(pq.conds[0].op, CondOp::Range(lo, hi));
    }

    #[test]
    fn invalid_field_value_is_ignored() {
        let pq = parse("rating:abc");
        assert!(pq.conds.is_empty());
        assert_eq!(pq.fts_include, None);
    }

    #[test]
    fn unknown_field_is_treated_as_bare_text() {
        let pq = parse("foo:bar");
        assert_eq!(pq.fts_include.as_deref(), Some("\"foo:bar\""));
    }

    #[test]
    fn invalid_date_is_ignored() {
        let pq = parse("created:2025-02-30");
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn reverse_range_is_ignored() {
        let pq = parse("width:1000..100");
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn unclosed_quote_is_handled() {
        let pq = parse("\"unclosed");
        assert_eq!(pq.fts_include.as_deref(), Some("\"unclosed\""));
        assert_eq!(pq.fts_exclude, None);
    }

    #[test]
    fn or_only_produces_no_fts() {
        let pq = parse("OR");
        assert_eq!(pq.fts_include, None);
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn quoted_field_value_maps_to_fts_phrase() {
        let pq = parse("prompt:\"best quality\"");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"best quality\""));
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn quoted_colon_phrase_is_not_a_field() {
        // クォート内のコロンはフィールド指定にしない（純粋句として扱う）。
        let pq = parse("\"foo:bar\"");
        assert_eq!(pq.fts_include.as_deref(), Some("\"foo:bar\""));
    }

    #[test]
    fn negated_quoted_field_value() {
        let pq = parse("-negative:\"low quality\"");
        assert_eq!(pq.fts_include, None);
        assert_eq!(pq.fts_exclude.as_deref(), Some("negative : \"low quality\""));
    }
}
