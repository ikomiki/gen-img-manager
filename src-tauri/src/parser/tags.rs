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
    for raw in text.split(',') {
        if let Some((name, kind)) = normalize_token(raw, base) {
            if seen.insert((name.clone(), kind.as_str())) {
                out.push((name, kind));
            }
        }
    }
}

/// 1トークンを正規化し (タグ名, kind) を返す。空・BREAK は None。
fn normalize_token(raw: &str, base: TagKind) -> Option<(String, TagKind)> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    // LoRA / LyCORIS 等: <type:name:weight>（weight 省略可）
    if let Some(inner) = t.strip_prefix('<').and_then(|s| s.strip_suffix('>')) {
        let parts: Vec<&str> = inner.splitn(3, ':').collect();
        if parts.len() >= 2 {
            let weight: f64 = parts.get(2).and_then(|w| w.trim().parse().ok()).unwrap_or(1.0);
            let sign = if weight < 0.0 { '-' } else { '+' };
            let kind = if weight < 0.0 { TagKind::Negative } else { base };
            let canon = format!("<{}:{}:{}>", parts[0], parts[1], sign);
            return Some((finalize(&canon), kind));
        }
        return None;
    }
    let (core, weight) = strip_emphasis(t);
    let core = core.trim();
    if core.is_empty() || core.eq_ignore_ascii_case("BREAK") {
        return None;
    }
    let kind = if weight < 0.0 { TagKind::Negative } else { base };
    Some((finalize(core), kind))
}

/// 先頭/末尾の () [] を再帰的に剥がし、(tag:weight) の数値重みを取り出す。
/// [tag] は減衰だが正の重み扱い（kind を変えない）。
fn strip_emphasis(t: &str) -> (String, f64) {
    let mut s = t.trim();
    let mut weight = 1.0_f64;
    loop {
        if let Some(inner) = s.strip_prefix('(').and_then(|x| x.strip_suffix(')')) {
            match split_trailing_weight(inner) {
                Some((head, w)) => {
                    weight = w;
                    s = head.trim();
                }
                None => s = inner.trim(),
            }
            continue;
        }
        if let Some(inner) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            match split_trailing_weight(inner) {
                Some((head, _)) => s = head.trim(),
                None => s = inner.trim(),
            }
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

/// 単一のタグ名（除外リスト入力など）を、保存済みタグと同じ正準形へ正規化する。
pub fn normalize_tag_name(s: &str) -> String {
    finalize(s)
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
    fn strips_emphasis_and_weight_syntax() {
        let v = extract_tags(Some("(masterpiece:1.3), (detailed), [soft], ((cat))"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["masterpiece", "detailed", "soft", "cat"]);
    }

    #[test]
    fn negative_weight_moves_to_negative_kind() {
        let v = extract_tags(Some("good, (bad:-1)"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["good"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["bad"]);
    }

    #[test]
    fn lora_is_sign_encoded() {
        let v = extract_tags(Some("<lora:foo:0.8>, <lora:bar:-0.5>, <lora:baz>"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["<lora:foo:+>", "<lora:baz:+>"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["<lora:bar:->"]);
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
}
