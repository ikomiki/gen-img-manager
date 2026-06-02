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
    let root: Value = match serde_json::from_str(prompt_json) {
        Ok(v) => v,
        Err(_) => return fields,
    };
    let Some(obj) = root.as_object() else {
        return fields;
    };

    let mut texts: Vec<String> = Vec::new();
    for node in obj.values() {
        let class_type = node.get("class_type").and_then(|v| v.as_str()).unwrap_or("");
        if class_type.contains("CLIPTextEncode") {
            if let Some(t) = node
                .get("inputs")
                .and_then(|i| i.get("text"))
                .and_then(|t| t.as_str())
            {
                let t = t.trim();
                if !t.is_empty() {
                    texts.push(t.to_string());
                }
            }
        }
    }

    if !texts.is_empty() {
        fields.positive = Some(texts.join("\n"));
    }
    fields
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
    fn handles_no_text_nodes() {
        let json = r#"{"3": {"class_type": "KSampler", "inputs": {"seed": 1}}}"#;
        assert_eq!(extract_comfy_text(json), ComfyFields::default());
    }

    #[test]
    fn invalid_json_returns_default() {
        assert_eq!(extract_comfy_text("not json"), ComfyFields::default());
    }
}
