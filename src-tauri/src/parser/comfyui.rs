use serde_json::Value;

/// ComfyUI の `prompt` JSON（API形式: node_id -> {class_type, inputs}）から
/// 検索対象テキストを抽出した結果。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ComfyFields {
    /// CLIPTextEncode 系ノードの text を結合したもの（検索用）。
    pub positive: Option<String>,
}

/// ComfyUI の prompt JSON 文字列からテキストエンコードノードの文字列を収集する。
/// 正負の区別は ComfyUI のグラフ構造依存で信頼できないため、すべて結合して
/// 全文検索の対象（positive）にする（ベストエフォート）。
pub fn extract_comfy_text(prompt_json: &str) -> ComfyFields {
    let mut fields = ComfyFields::default();
    let root: Value = match serde_json::from_str(&sanitize_json(prompt_json)) {
        Ok(v) => v,
        Err(_) => return fields,
    };
    let Some(obj) = root.as_object() else {
        return fields;
    };

    // NOTE(既知の制限):
    // - CLIPTextEncodeSDXL のように inputs.text ではなく text_g/text_l を使うノードは取得しない。
    // - serde_json の Map 反復順は preserve_order 無効時はキー辞書順で、ノードID順とは限らない。
    //   結合結果は全文検索用途のため順序は機能要件ではない。
    let mut texts: Vec<String> = Vec::new();
    for node in obj.values() {
        let class_type = node.get("class_type").and_then(|v| v.as_str()).unwrap_or("");
        if class_type.contains("CLIPTextEncode") {
            if let Some(t) = node.get("inputs").and_then(|i| i.get("text")) {
                collect_text(obj, t, &mut texts, &mut Vec::new());
            }
        }
    }

    if !texts.is_empty() {
        fields.positive = Some(texts.join("\n"));
    }
    fields
}

/// ComfyUI（Python の json.dumps）は `NaN` / `Infinity` を非標準トークンのまま書き出すことがあり
/// （例: `"is_changed": [NaN]`）、serde_json はそれで全体のパースに失敗する。
/// 文字列リテラル外に現れたこれらを `null` に置き換える。
fn sanitize_json(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    let mut in_str = false;
    let mut escaped = false;
    while let Some(c) = rest.chars().next() {
        if in_str {
            out.push(c);
            in_str = !(c == '"' && !escaped);
            escaped = c == '\\' && !escaped;
            rest = &rest[c.len_utf8()..];
            continue;
        }
        if let Some(r) = ["NaN", "Infinity", "-Infinity"].iter().find_map(|t| rest.strip_prefix(t)) {
            out.push_str("null");
            rest = r;
            continue;
        }
        in_str = c == '"';
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// `text` 入力の値を回収する。文字列ならそのまま、リンク `[node_id, slot]` なら
/// リンク先ノードの文字列入力をすべて集め、さらにリンクを再帰的に辿る
/// （ShowText → DPJinja/PrimitiveString のようなテキスト生成ノード経由の構成に対応するため）。
fn collect_text(
    nodes: &serde_json::Map<String, Value>,
    value: &Value,
    out: &mut Vec<String>,
    visited: &mut Vec<String>,
) {
    match value {
        Value::String(t) => {
            let t = t.trim();
            if !t.is_empty() && !out.iter().any(|s| s == t) {
                out.push(t.to_string());
            }
        }
        Value::Array(link) => {
            let Some(id) = link.first().and_then(|v| v.as_str()) else { return };
            if visited.iter().any(|v| v == id) {
                return;
            }
            visited.push(id.to_string());
            let Some(inputs) = nodes.get(id).and_then(|n| n.get("inputs")).and_then(|i| i.as_object()) else {
                return;
            };
            for v in inputs.values() {
                collect_text(nodes, v, out, visited);
            }
        }
        _ => {}
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_clip_text_encode_nodes() {
        let json = r#"{
            "3": {"class_type": "KSampler", "inputs": {"seed": 1}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "beautiful sunset over ocean"}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry, watermark"}}
        }"#;
        let f = extract_comfy_text(json);
        let pos = f.positive.unwrap();
        assert!(pos.contains("beautiful sunset over ocean"));
        assert!(pos.contains("blurry, watermark"));
    }

    #[test]
    fn follows_links_to_text_source_nodes() {
        // CLIPTextEncode.text がリンクで、ShowText → 文字列生成ノードの順に辿る構成。
        let json = r#"{
            "92": {"class_type": "DPJinja", "inputs": {"text": "{{ choice('a','b') }}, mizuhara hazuki", "autorefresh": "Yes"}},
            "93": {"class_type": "ShowText|pysssss", "inputs": {"text_0": "a, mizuhara hazuki", "text": ["92", 0]}},
            "95": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "bad quality"}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": ["93", 0], "clip": ["4", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": ["95", 0], "clip": ["4", 1]}},
            "8": {"class_type": "CLIPTextEncode", "inputs": {"text": ["93", 0], "clip": ["4", 1]}}
        }"#;
        let pos = extract_comfy_text(json).positive.unwrap();
        assert!(pos.contains("a, mizuhara hazuki"));
        assert!(pos.contains("{{ choice('a','b') }}"));
        assert!(pos.contains("bad quality"));
        // 同じ元ノードを複数の CLIPTextEncode が参照しても重複しない
        assert_eq!(pos.matches("a, mizuhara hazuki").count(), 1);
    }

    #[test]
    fn link_cycle_terminates() {
        let json = r#"{
            "1": {"class_type": "X", "inputs": {"text": ["2", 0]}},
            "2": {"class_type": "Y", "inputs": {"text": ["1", 0], "v": "loop"}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": ["1", 0]}}
        }"#;
        assert_eq!(extract_comfy_text(json).positive.as_deref(), Some("loop"));
    }

    #[test]
    fn nan_outside_strings_is_tolerated() {
        let json = r#"{
            "1": {"class_type": "DP", "inputs": {"x": 1}, "is_changed": [NaN, Infinity, -Infinity]},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "NaN girl, \"Infinity\" \\"}}
        }"#;
        assert_eq!(
            extract_comfy_text(json).positive.as_deref(),
            Some(r#"NaN girl, "Infinity" \"#)
        );
    }

    #[test]
    fn handles_no_text_nodes() {
        let json = r#"{"3": {"class_type": "KSampler", "inputs": {"seed": 1}}}"#;
        assert_eq!(extract_comfy_text(json), ComfyFields::default());
    }

    #[test]
    fn invalid_json_returns_default() {
        assert_eq!(extract_comfy_text("not json"), ComfyFields::default());
    }

    #[test]
    fn whitespace_only_text_is_filtered() {
        let json = r#"{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "   "}}}"#;
        assert_eq!(extract_comfy_text(json), ComfyFields::default());
    }

    #[test]
    fn non_object_json_returns_default() {
        assert_eq!(extract_comfy_text("[1, 2, 3]"), ComfyFields::default());
        assert_eq!(extract_comfy_text("42"), ComfyFields::default());
    }
}
