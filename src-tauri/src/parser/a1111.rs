/// A1111 (AUTOMATIC1111 / WebUI) の `parameters` テキストから抽出した構造化フィールド。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct A1111Fields {
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
}

/// A1111 の geninfo 文字列を解析する。
/// 形式:
///   <positive prompt (複数行可)>
///   Negative prompt: <negative>
///   Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123, Model: v1-5, ...
pub fn parse_a1111(raw: &str) -> A1111Fields {
    let raw = raw.trim();
    let mut fields = A1111Fields::default();

    // 末尾行がパラメータ行（"Steps:" を含む key: value の並び）なら切り出す。
    let (body, params_line) = match raw.rfind('\n') {
        Some(idx) if raw[idx + 1..].contains("Steps:") => {
            (raw[..idx].trim_end(), &raw[idx + 1..])
        }
        // 改行が無く1行のみでも、Steps: を含むならパラメータ行扱い。
        None if raw.contains("Steps:") => ("", raw),
        _ => (raw, ""),
    };

    // body を positive / negative に分割。
    if !body.is_empty() {
        if let Some(npos) = body.find("Negative prompt:") {
            let pos = body[..npos].trim();
            let neg = body[npos + "Negative prompt:".len()..].trim();
            if !pos.is_empty() {
                fields.positive = Some(pos.to_string());
            }
            if !neg.is_empty() {
                fields.negative = Some(neg.to_string());
            }
        } else {
            fields.positive = Some(body.trim().to_string());
        }
    }

    // パラメータ行を ", " 区切りの key: value に分解する。
    // NOTE(既知の制限): 値自体が ", " を含む場合（例: サンプラー名やLoRAハッシュ）は
    // トークンが分裂し値が欠損しうる。完全な解析には key 境界を辿るステートマシンが必要だが、
    // 実用上の大半のケースはこの単純分割でカバーできるため、現状は許容する。
    for token in params_line.split(", ") {
        if let Some((key, value)) = token.split_once(": ") {
            let value = value.trim();
            match key.trim() {
                "Steps" => fields.steps = value.parse().ok(),
                "Sampler" => fields.sampler = Some(value.to_string()),
                "CFG scale" => fields.cfg = value.parse().ok(),
                "Seed" => fields.seed = value.parse().ok(),
                "Model" => fields.model = Some(value.to_string()),
                _ => {}
            }
        }
    }

    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_example() {
        let raw = "masterpiece, 1girl, forest\n\
                   Negative prompt: blurry, lowres\n\
                   Steps: 28, Sampler: DPM++ 2M, CFG scale: 7.5, Seed: 12345, Size: 512x768, Model: sdxl_base";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("masterpiece, 1girl, forest"));
        assert_eq!(f.negative.as_deref(), Some("blurry, lowres"));
        assert_eq!(f.steps, Some(28));
        assert_eq!(f.sampler.as_deref(), Some("DPM++ 2M"));
        assert_eq!(f.cfg, Some(7.5));
        assert_eq!(f.seed, Some(12345));
        assert_eq!(f.model.as_deref(), Some("sdxl_base"));
    }

    #[test]
    fn handles_missing_negative_prompt() {
        let raw = "a cat\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Model: m";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("a cat"));
        assert_eq!(f.negative, None);
        assert_eq!(f.steps, Some(20));
    }

    #[test]
    fn handles_plain_prompt_without_params() {
        let f = parse_a1111("just a prompt with no settings");
        assert_eq!(f.positive.as_deref(), Some("just a prompt with no settings"));
        assert_eq!(f.steps, None);
        assert_eq!(f.sampler, None);
    }

    #[test]
    fn multiline_positive_prompt() {
        let raw = "line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("line one\nline two"));
        assert_eq!(f.negative.as_deref(), Some("bad"));
        assert_eq!(f.seed, Some(9));
    }
}
