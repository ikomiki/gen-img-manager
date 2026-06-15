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
/// 例外: `field:(...)` のフィールド値括弧は、対応する `)` まで（内側のクォート・
/// 空白も含め）生のまま1トークンに取り込む（中身は field_expr_to_fts が解釈する）。
fn tokenize(input: &str) -> Vec<RawToken> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut lead = String::new();
    let mut in_quote = false;
    let mut quoted = false;
    // フィールド値括弧の状態。paren_depth>0 の間は空白で区切らずクォートも外さない。
    let mut paren_depth: u32 = 0;
    let mut paren_in_quote = false;

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
        if paren_depth > 0 {
            // フィールド値括弧の内側: 生のまま積む。lead は更新しない。
            cur.push(c);
            if c == '"' {
                paren_in_quote = !paren_in_quote;
            } else if !paren_in_quote {
                if c == '(' {
                    paren_depth += 1;
                } else if c == ')' {
                    paren_depth -= 1;
                    if paren_depth == 0 {
                        paren_in_quote = false;
                    }
                }
            }
            continue;
        }
        match c {
            '"' => {
                if in_quote {
                    in_quote = false;
                } else {
                    in_quote = true;
                    quoted = true;
                }
            }
            // コロン直後の '(' はフィールド値括弧の開始（未クォート時のみ）。
            '(' if !in_quote && !quoted && cur.ends_with(':') && cur.len() > 1 => {
                cur.push('(');
                paren_depth = 1;
                paren_in_quote = false;
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

/// 括弧（ダブルクォート外）が均衡しているか。未閉じ・過剰な閉じは false。
fn parens_balanced(s: &str) -> bool {
    let mut depth: i32 = 0;
    let mut in_quote = false;
    for c in s.chars() {
        match c {
            '"' => in_quote = !in_quote,
            '(' if !in_quote => depth += 1,
            ')' if !in_quote => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

/// 組み立て済みトークン列（"フレーズ" / AND / OR / ( / )）が FTS5 式として構文的に妥当か。
/// - 演算子(AND/OR)は直前が項末（フレーズ or `)`）、直後が項始（フレーズ or `(`）でなければ不正
/// - 空括弧 `( )` は不正
/// - 項（フレーズ）が1つも無いものは不正
fn fts_expr_valid(tokens: &[String]) -> bool {
    let is_op = |t: &str| t == "AND" || t == "OR";
    // 項末＝フレーズ or 閉じ括弧、項始＝フレーズ or 開き括弧
    let is_term_end = |t: &str| !is_op(t) && t != "(";
    let is_term_start = |t: &str| !is_op(t) && t != ")";

    for (i, t) in tokens.iter().enumerate() {
        if is_op(t) {
            let prev_ok = i > 0 && is_term_end(&tokens[i - 1]);
            let next_ok = tokens.get(i + 1).map(|n| is_term_start(n)).unwrap_or(false);
            if !prev_ok || !next_ok {
                return false;
            }
        }
    }
    // 空括弧ペア
    for i in 0..tokens.len() {
        if tokens[i] == "(" && tokens.get(i + 1).map(|s| s.as_str()) == Some(")") {
            return false;
        }
    }
    // 項（演算子でも括弧でもないトークン）が最低1つ必要
    tokens.iter().any(|t| !is_op(t) && t != "(" && t != ")")
}

/// フィールド値内のミニ論理式を FTS5 式へ変換する。
/// - 裸の語 → fts_quote でダブルクォート（インジェクション/構文エラー対策）
/// - `AND` / `OR`（大文字のみ）→ そのまま転写（FTS5 演算子）
/// - `(` / `)` → そのまま転写（FTS5 がグループ化を解釈）
/// - `"..."` → 中身を fts_quote でフレーズとして転写
/// - `NOT` は演算子扱いしない（語としてクォートする）。除外は `-prompt:` で括弧の外に出す設計。
///
/// 空白区切りは FTS5 の暗黙 AND に委ねる。出力はスペース結合（FTS5 はスペースを無視）。
fn field_expr_to_fts(value: &str) -> String {
    // 括弧が不均衡（未閉じ等）なら従来どおり1フレーズ化してフォールバック（FTS5 構文エラー回避）。
    if !parens_balanced(value) {
        return fts_quote(value);
    }
    let mut out: Vec<String> = Vec::new();
    let mut chars = value.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            '(' | ')' => {
                out.push(c.to_string());
                chars.next();
            }
            c if c.is_whitespace() => {
                chars.next();
            }
            '"' => {
                chars.next(); // 開きクォート
                let mut s = String::new();
                while let Some(&c2) = chars.peek() {
                    chars.next();
                    if c2 == '"' {
                        break;
                    }
                    s.push(c2);
                }
                out.push(fts_quote(&s));
            }
            _ => {
                let mut s = String::new();
                while let Some(&c2) = chars.peek() {
                    if c2.is_whitespace() || c2 == '(' || c2 == ')' || c2 == '"' {
                        break;
                    }
                    s.push(c2);
                    chars.next();
                }
                if s == "AND" || s == "OR" {
                    out.push(s);
                } else {
                    out.push(fts_quote(&s));
                }
            }
        }
    }
    if !fts_expr_valid(&out) {
        return fts_quote(value);
    }
    out.join(" ")
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
        return match (date_to_epoch(value, false), date_to_epoch(value, true)) {
            (Some(lo), Some(hi)) => Some(CondOp::Range(lo, hi)),
            _ => None,
        };
    }
    // 集合構文（"none"・カンマ区切り）。"none" は NULL を含める指定。
    // 単一の bare 整数は従来どおり Eq として扱う（ここには来ない）。
    if value == "none" || value.contains(',') {
        let mut values = Vec::new();
        let mut include_null = false;
        for part in value.split(',') {
            let p = part.trim();
            if p == "none" {
                include_null = true;
            } else {
                match p.parse::<i64>() {
                    Ok(n) => values.push(n),
                    Err(_) => return None, // 不正メンバーはトークンごと無視
                }
            }
        }
        if values.is_empty() && !include_null {
            return None;
        }
        return Some(CondOp::InSet { values, include_null });
    }
    to_num(value).map(CondOp::Eq)
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
                    // text_field_column は model:, filename: もここを通る（括弧式が効くが専用UIは無い）。
                    // 値が未クォートの括弧式なら論理式として展開、それ以外（クォート句・裸の語）は1フレーズ。
                    let rhs = if !tok.quoted && value.starts_with('(') {
                        field_expr_to_fts(value)
                    } else {
                        fts_quote(value)
                    };
                    let expr = format!("{col} : {rhs}");
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
    fn rating_comma_set_parses_to_inset() {
        let pq = parse("rating:none,1,3");
        assert_eq!(
            pq.conds,
            vec![Cond {
                column: "rating",
                op: CondOp::InSet { values: vec![1, 3], include_null: true },
                negate: false,
            }]
        );
    }

    #[test]
    fn rating_bare_none_is_null_only_inset() {
        let pq = parse("rating:none");
        assert_eq!(
            pq.conds,
            vec![Cond {
                column: "rating",
                op: CondOp::InSet { values: vec![], include_null: true },
                negate: false,
            }]
        );
    }

    #[test]
    fn numeric_comma_set_without_none() {
        let pq = parse("rating:2,4");
        assert_eq!(
            pq.conds,
            vec![Cond {
                column: "rating",
                op: CondOp::InSet { values: vec![2, 4], include_null: false },
                negate: false,
            }]
        );
    }

    #[test]
    fn invalid_set_member_makes_token_ignored() {
        // 集合の一部でも数値化できなければトークンごと無視。
        let pq = parse("rating:1,abc");
        assert!(pq.conds.is_empty());
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

    #[test]
    fn field_paren_value_is_single_token() {
        // prompt:(forest AND cabin) は空白で割れず1トークンとして field 値になる。
        let pq = parse("prompt:(forest AND cabin)");
        assert_eq!(
            pq.fts_include.as_deref(),
            Some("positive : ( \"forest\" AND \"cabin\" )")
        );
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn field_paren_negation_goes_to_exclude() {
        // -prompt:(blurry OR lowres) は除外側へ。
        let pq = parse("-prompt:(blurry OR lowres)");
        assert_eq!(pq.fts_include, None);
        assert_eq!(
            pq.fts_exclude.as_deref(),
            Some("positive : ( \"blurry\" OR \"lowres\" )")
        );
    }

    #[test]
    fn field_paren_combined_with_exclude_and_cond() {
        let pq = parse("prompt:(forest AND cabin) -prompt:blurry rating:>=4");
        assert_eq!(
            pq.fts_include.as_deref(),
            Some("positive : ( \"forest\" AND \"cabin\" )")
        );
        assert_eq!(pq.fts_exclude.as_deref(), Some("positive : \"blurry\""));
        assert_eq!(
            pq.conds,
            vec![Cond { column: "rating", op: CondOp::Ge(4), negate: false }]
        );
    }

    #[test]
    fn legacy_field_values_unchanged() {
        // 後方互換: 括弧なしの既存記法は従来どおり。
        assert_eq!(parse("prompt:forest").fts_include.as_deref(), Some("positive : \"forest\""));
        assert_eq!(parse("prompt:\"best quality\"").fts_include.as_deref(), Some("positive : \"best quality\""));
        let pq = parse("prompt:forest cabin");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"forest\" AND \"cabin\""));
    }

    #[test]
    fn field_expr_to_fts_quotes_terms_and_keeps_operators() {
        assert_eq!(
            field_expr_to_fts("(forest AND cabin OR sunset)"),
            "( \"forest\" AND \"cabin\" OR \"sunset\" )"
        );
    }

    #[test]
    fn field_expr_to_fts_handles_nested_and_phrases() {
        assert_eq!(
            field_expr_to_fts("((forest AND cabin) OR \"best quality\")"),
            "( ( \"forest\" AND \"cabin\" ) OR \"best quality\" )"
        );
    }

    #[test]
    fn field_expr_to_fts_lowercase_and_is_a_term() {
        // 小文字 and は演算子でなく検索語（FTS5 準拠: 演算子は大文字のみ）。
        assert_eq!(field_expr_to_fts("(cat and dog)"), "( \"cat\" \"and\" \"dog\" )");
    }

    #[test]
    fn quoted_paren_value_stays_a_phrase() {
        // クォート付きで () を含む値は論理式でなくフレーズのまま（後方互換）。
        let pq = parse("prompt:\"(hello)\"");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"(hello)\""));
    }

    #[test]
    fn unclosed_field_paren_degrades_to_phrase() {
        // 未閉じ括弧は FTS5 構文エラーを避けるため1フレーズ化（graceful degradation）。
        let pq = parse("prompt:(unclosed");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"(unclosed\""));
    }

    #[test]
    fn field_expr_invalid_operator_placement_falls_back_to_phrase() {
        // 演算子の位置が不正な式は構文エラーを避けてフレーズ化フォールバック。
        assert_eq!(field_expr_to_fts("(forest AND)"), "\"(forest AND)\"");
        assert_eq!(field_expr_to_fts("(AND forest)"), "\"(AND forest)\"");
        assert_eq!(field_expr_to_fts("(forest AND OR cabin)"), "\"(forest AND OR cabin)\"");
        assert_eq!(field_expr_to_fts("()"), "\"()\"");
        assert_eq!(field_expr_to_fts("(AND)"), "\"(AND)\"");
    }

    #[test]
    fn field_expr_valid_expressions_still_convert() {
        // 正常な式は従来どおり変換される（回帰防止）。
        assert_eq!(field_expr_to_fts("(forest AND cabin)"), "( \"forest\" AND \"cabin\" )");
        assert_eq!(field_expr_to_fts("(forest)"), "( \"forest\" )");
        assert_eq!(
            field_expr_to_fts("((forest AND cabin) OR sunset)"),
            "( ( \"forest\" AND \"cabin\" ) OR \"sunset\" )"
        );
    }

    #[test]
    fn parse_invalid_operator_field_falls_back() {
        // parse 経由でも構文エラーにならない（フレーズ化）。
        let pq = parse("prompt:(forest AND)");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"(forest AND)\""));
    }
}
