use std::collections::HashSet;

/// タグの出現元。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagKind {
    Prompt,
    Negative,
    Unclassified,
}

impl TagKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TagKind::Prompt => "prompt",
            TagKind::Negative => "negative",
            TagKind::Unclassified => "unclassified",
        }
    }
}

/// positive/negative テキストと source_tool から (正規化タグ名, kind) を抽出する純粋関数。
/// スキャン時と backfill で共用する。
pub fn extract_tags(
    positive: Option<&str>,
    negative: Option<&str>,
    source_tool: &str,
) -> Vec<(String, TagKind)> {
    let mut out: Vec<(String, TagKind)> = Vec::new();
    let mut seen: HashSet<(String, &'static str)> = HashSet::new();

    let positive_kind = match source_tool {
        "a1111" => Some(TagKind::Prompt),
        "comfyui" => Some(TagKind::Unclassified),
        _ => None,
    };
    if let (Some(text), Some(base)) = (positive, positive_kind) {
        collect_field(text, base, &mut out, &mut seen);
    }
    if source_tool == "a1111" {
        if let Some(text) = negative {
            collect_field(text, TagKind::Negative, &mut out, &mut seen);
        }
    }
    out
}

fn collect_field(
    text: &str,
    base: TagKind,
    out: &mut Vec<(String, TagKind)>,
    seen: &mut HashSet<(String, &'static str)>,
) {
    // カンマ・改行で区切り、各セグメント内の <...>（LoRA等）はその前後で切り分ける。
    for segment in text.split([',', '\n', '\r']) {
        for piece in split_pieces(segment) {
            if let Some((name, kind)) = normalize_token(piece, base) {
                if seen.insert((name.clone(), kind.as_str())) {
                    out.push((name, kind));
                }
            }
        }
    }
}

/// セグメントを「テキスト断片」と「<...> 断片」に分割する。
/// 例: "hyper detailed <lora:foo:0.7> clothing" -> ["hyper detailed", "<lora:foo:0.7>", "clothing"]
fn split_pieces(seg: &str) -> Vec<&str> {
    let mut pieces = Vec::new();
    let mut rest = seg;
    while let Some(lt) = rest.find('<') {
        match rest[lt..].find('>') {
            Some(gt_rel) => {
                let gt = lt + gt_rel; // '>' のバイト位置
                let before = &rest[..lt];
                if !before.trim().is_empty() {
                    pieces.push(before);
                }
                pieces.push(&rest[lt..=gt]);
                rest = &rest[gt + 1..];
            }
            // 閉じ '>' が無い場合は残り全体をテキストとして扱う。
            None => break,
        }
    }
    if !rest.trim().is_empty() {
        pieces.push(rest);
    }
    pieces
}

/// 1トークンを正規化し (タグ名, kind) を返す。空・BREAK・不正は None。
fn normalize_token(raw: &str, base: TagKind) -> Option<(String, TagKind)> {
    let (name, weight) = canon(raw)?;
    let kind = if weight < 0.0 { TagKind::Negative } else { base };
    Some((name, kind))
}

/// トークンを (正準タグ名, 重み) へ。重みは kind 判定にも使う。
/// <...>（LoRA等）はファイル名を含むため、変換せずトークンを丸ごと保持する。
fn canon(raw: &str) -> Option<(String, f64)> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    // LoRA / LyCORIS 等: <type:name:weight>（weight 省略可）。
    if t.len() >= 2 && t.starts_with('<') && t.ends_with('>') {
        let inner = &t[1..t.len() - 1];
        let parts: Vec<&str> = inner.splitn(3, ':').collect();
        if parts.len() < 2 {
            return None;
        }
        let weight: f64 = parts.get(2).and_then(|w| w.trim().parse().ok()).unwrap_or(1.0);
        // 重みは符号化せず実値のまま、小文字化・アンダースコア変換もせず保持する。
        return Some((t.to_string(), weight));
    }
    let (core, weight) = compute_emphasis(t);
    let core = core.trim();
    if core.is_empty() || core.eq_ignore_ascii_case("BREAK") {
        return None;
    }
    let final_core = finalize(core);
    if final_core.is_empty() {
        return None;
    }
    Some((render_weighted(&final_core, weight), weight))
}

/// 先頭/末尾の () [] を再帰的に剥がし、実効重みを計算する。
/// (tag) は ×1.1、(tag:w) は ×w、[tag] は ×0.9（角括弧は明示重みより 0.9 を優先）。
fn compute_emphasis(t: &str) -> (String, f64) {
    let mut s = t.trim();
    let mut weight = 1.0_f64;
    loop {
        if let Some(inner) = s.strip_prefix('(').and_then(|x| x.strip_suffix(')')) {
            match split_trailing_weight(inner) {
                Some((head, w)) => {
                    weight *= w;
                    s = head.trim();
                }
                None => {
                    weight *= 1.1;
                    s = inner.trim();
                }
            }
            continue;
        }
        if let Some(inner) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            s = match split_trailing_weight(inner) {
                Some((head, _)) => head.trim(),
                None => inner.trim(),
            };
            weight *= 0.9;
            continue;
        }
        break;
    }
    (s.to_string(), weight)
}

/// "tag:1.3" のように末尾が数値なら (head, weight) を返す。
fn split_trailing_weight(inner: &str) -> Option<(&str, f64)> {
    let idx = inner.rfind(':')?;
    let w: f64 = inner[idx + 1..].trim().parse().ok()?;
    Some((&inner[..idx], w))
}

/// 実効重みをタグ名表記へ。1.0=重み無し、1.1=丸括弧のみ、その他=(core:weight)。
fn render_weighted(core: &str, weight: f64) -> String {
    if (weight - 1.0).abs() < 1e-6 {
        core.to_string()
    } else if (weight - 1.1).abs() < 1e-6 {
        format!("({core})")
    } else {
        format!("({core}:{})", fmt_weight(weight))
    }
}

/// 重みを簡潔な小数表記へ（末尾の 0 と小数点を削る）。例: 1.21000.. -> "1.21"、-1.0 -> "-1"。
fn fmt_weight(w: f64) -> String {
    let s = format!("{w:.3}");
    let trimmed = s.trim_end_matches('0').trim_end_matches('.');
    trimmed.to_string()
}

/// 単一のタグ名（除外リスト入力など）を、保存済みタグと同じ正準形へ正規化する。
pub fn normalize_tag_name(s: &str) -> String {
    canon(s).map(|(n, _)| n).unwrap_or_default()
}

/// 正準タグ名から重み/強調を取り除いた「ベース名」を返す。
/// 除外照合を重み非依存にするために使う。
/// 例: "(masterpiece:1.2)" -> "masterpiece"、"(detailed)" -> "detailed"、
///     "(soft:0.9)" -> "soft"、"<lora:foo:0.7>" -> "<lora:foo>"、"cat" -> "cat"。
pub fn base_tag_name(canonical: &str) -> String {
    let t = canonical.trim();
    // LoRA等: <type:name:weight> -> <type:name>（verbatim 保持）。
    if t.len() >= 2 && t.starts_with('<') && t.ends_with('>') {
        let inner = &t[1..t.len() - 1];
        let parts: Vec<&str> = inner.splitn(3, ':').collect();
        if parts.len() >= 2 {
            return format!("<{}:{}>", parts[0], parts[1]);
        }
        return t.to_string();
    }
    // (core) / (core:weight) -> core。それ以外は素のまま。
    if let Some(inner) = t.strip_prefix('(').and_then(|x| x.strip_suffix(')')) {
        return match split_trailing_weight(inner) {
            Some((head, _)) => head.trim().to_string(),
            None => inner.trim().to_string(),
        };
    }
    t.to_string()
}

/// 除外リスト入力をベース名（重み無視）へ正規化する。空入力は空文字。
pub fn normalize_excluded_name(s: &str) -> String {
    base_tag_name(&normalize_tag_name(s))
}

/// 小文字化 + アンダースコア→空白 + 連続空白の畳み込み。
fn finalize(s: &str) -> String {
    s.to_ascii_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[(String, TagKind)], kind: TagKind) -> Vec<String> {
        v.iter().filter(|(_, k)| *k == kind).map(|(n, _)| n.clone()).collect()
    }

    #[test]
    fn a1111_splits_positive_and_negative() {
        let v = extract_tags(Some("masterpiece, 1girl, forest"), Some("blurry, lowres"), "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["masterpiece", "1girl", "forest"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["blurry", "lowres"]);
    }

    #[test]
    fn comfyui_positive_is_unclassified() {
        let v = extract_tags(Some("neon city, rain"), None, "comfyui");
        assert_eq!(names(&v, TagKind::Unclassified), vec!["neon city", "rain"]);
        assert!(names(&v, TagKind::Prompt).is_empty());
    }

    #[test]
    fn unknown_tool_yields_nothing() {
        assert!(extract_tags(Some("anything"), Some("x"), "unknown").is_empty());
    }

    #[test]
    fn lowercases_and_unifies_underscore() {
        let v = extract_tags(Some("Long_Hair, BlueSky"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["long hair", "bluesky"]);
    }

    #[test]
    fn keeps_effective_weight_in_name() {
        let v = extract_tags(Some("(masterpiece:1.3), (detailed), [soft], ((cat))"), None, "a1111");
        assert_eq!(
            names(&v, TagKind::Prompt),
            vec!["(masterpiece:1.3)", "(detailed)", "(soft:0.9)", "(cat:1.21)"]
        );
    }

    #[test]
    fn weight_1_1_becomes_bare_parens() {
        let v = extract_tags(Some("(masterpiece:1.1)"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["(masterpiece)"]);
    }

    #[test]
    fn square_bracket_is_treated_as_0_9() {
        let v = extract_tags(Some("[masterpiece]"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["(masterpiece:0.9)"]);
    }

    #[test]
    fn negative_weight_moves_to_negative_kind() {
        let v = extract_tags(Some("good, (bad:-1)"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["good"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["(bad:-1)"]);
    }

    #[test]
    fn lora_kept_verbatim_and_split_by_brackets() {
        let v = extract_tags(
            Some("hyper detailed <lora:inglis_eucus-66:0.7> clothing sex"),
            None,
            "a1111",
        );
        assert_eq!(
            names(&v, TagKind::Prompt),
            vec!["hyper detailed", "<lora:inglis_eucus-66:0.7>", "clothing sex"]
        );
    }

    #[test]
    fn lora_weight_sign_sets_kind_but_token_unchanged() {
        let v = extract_tags(Some("<lora:foo:0.8>, <lora:bar:-0.5>, <lora:baz>"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["<lora:foo:0.8>", "<lora:baz>"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["<lora:bar:-0.5>"]);
    }

    #[test]
    fn lora_name_case_and_underscore_preserved() {
        let v = extract_tags(Some("<lora:My_Cool_LoRA:1>"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["<lora:My_Cool_LoRA:1>"]);
    }

    #[test]
    fn splits_on_newlines() {
        let v = extract_tags(Some("cat\ndog,\nbird"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat", "dog", "bird"]);
    }

    #[test]
    fn break_keyword_is_dropped() {
        let v = extract_tags(Some("cat, BREAK, dog"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat", "dog"]);
    }

    #[test]
    fn dedups_within_field() {
        let v = extract_tags(Some("cat, cat, Cat"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat"]);
    }

    #[test]
    fn empty_tokens_dropped() {
        let v = extract_tags(Some("cat, , ,dog,"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat", "dog"]);
    }

    #[test]
    fn normalize_tag_name_matches_stored_form() {
        assert_eq!(normalize_tag_name("Score_9"), "score 9");
        assert_eq!(normalize_tag_name("  Masterpiece  "), "masterpiece");
    }

    #[test]
    fn base_tag_name_strips_weight_and_emphasis() {
        assert_eq!(base_tag_name("(masterpiece:1.2)"), "masterpiece");
        assert_eq!(base_tag_name("(detailed)"), "detailed");
        assert_eq!(base_tag_name("(soft:0.9)"), "soft");
        assert_eq!(base_tag_name("cat"), "cat");
        assert_eq!(base_tag_name("<lora:foo:0.7>"), "<lora:foo>");
        assert_eq!(base_tag_name("<lora:foo>"), "<lora:foo>");
    }

    #[test]
    fn normalize_excluded_name_is_weight_insensitive() {
        assert_eq!(normalize_excluded_name("(Masterpiece:1.1)"), "masterpiece");
        assert_eq!(normalize_excluded_name("Score_9"), "score 9");
        assert_eq!(normalize_excluded_name("[soft]"), "soft");
    }
}
