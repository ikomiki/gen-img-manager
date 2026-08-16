pub mod a1111;
pub mod comfyui;
pub mod png;
pub mod raster_exif;
pub mod xmp;

// db::tags / db::analysis と共有するため gim-core へ移設した。既存パス crate::parser::tags を維持する。
pub use gim_core::parser::tags;

use std::path::Path;

/// 1画像から抽出した（埋め込み）メタデータ。レーティングはXMPサイドカー由来のため含めない。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedMetadata {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub raw_parameters: Option<String>,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
    pub source_tool: String,
    /// ComfyUI PNG の workflow チャンク由来の生JSON。JPEG/WebP や A1111 では None。
    pub comfy_workflow: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unsupported extension")]
    Unsupported,
    #[error("png: {0}")]
    Png(#[from] ::png::DecodingError), // `::png` = 外部クレート（`parser::png` サブモジュールと区別）
    #[error("image: {0}")]
    Image(#[from] image::ImageError),
}

/// A1111正規化結果を ParsedMetadata に反映する（parse_png/parse_raster 共通）。
fn apply_a1111(meta: &mut ParsedMetadata, f: a1111::A1111Fields) {
    meta.positive = f.positive;
    meta.negative = f.negative;
    meta.model = f.model;
    meta.sampler = f.sampler;
    meta.steps = f.steps;
    meta.seed = f.seed;
    meta.cfg = f.cfg;
}

/// 拡張子で振り分けて画像を解析する。
pub fn parse(path: &Path) -> Result<ParsedMetadata, ParseError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "png" => parse_png(path),
        "jpg" | "jpeg" | "webp" => parse_raster(path, &ext),
        _ => Err(ParseError::Unsupported),
    }
}

fn parse_png(path: &Path) -> Result<ParsedMetadata, ParseError> {
    let data = png::read_png(path)?;
    let mut meta = ParsedMetadata {
        width: data.width,
        height: data.height,
        format: "png".to_string(),
        source_tool: "unknown".to_string(),
        ..Default::default()
    };

    if let Some(params) = data.texts.get("parameters") {
        meta.source_tool = "a1111".to_string();
        meta.raw_parameters = Some(params.clone());
        apply_a1111(&mut meta, a1111::parse_a1111(params));
    } else if let Some(prompt) = data.texts.get("prompt") {
        meta.source_tool = "comfyui".to_string();
        meta.raw_parameters = Some(prompt.clone());
        meta.positive = comfyui::extract_comfy_text(prompt).positive;
        meta.comfy_workflow = data.texts.get("workflow").cloned();
    }

    Ok(meta)
}

fn parse_raster(path: &Path, ext: &str) -> Result<ParsedMetadata, ParseError> {
    let data = raster_exif::read_raster(path)?;
    let format = if ext == "jpg" { "jpeg".to_string() } else { ext.to_string() };
    let mut meta = ParsedMetadata {
        width: data.width,
        height: data.height,
        format,
        source_tool: "unknown".to_string(),
        ..Default::default()
    };

    if let Some(uc) = data.user_comment {
        // WebUIのJPEG/WebP出力はUserCommentにA1111 paramsを入れる。
        meta.source_tool = "a1111".to_string();
        meta.raw_parameters = Some(uc.clone());
        apply_a1111(&mut meta, a1111::parse_a1111(&uc));
    }

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    fn write_png_with_text(path: &Path, keyword: &str, text: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        // `::png` = 外部クレート（このモジュールの `pub mod png;` サブモジュールではない）
        let mut encoder = ::png::Encoder::new(w, 2, 2);
        encoder.set_color(::png::ColorType::Rgba);
        encoder.set_depth(::png::BitDepth::Eight);
        encoder.add_text_chunk(keyword.to_string(), text.to_string()).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0u8; 16]).unwrap();
    }

    #[test]
    fn parses_a1111_png_end_to_end() {
        let dir = std::env::temp_dir().join(format!("gim_parse_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.png");
        write_png_with_text(&p, "parameters", "a dog\nSteps: 12, Seed: 7, Model: m1");

        let meta = parse(&p).unwrap();
        assert_eq!(meta.format, "png");
        assert_eq!(meta.source_tool, "a1111");
        assert_eq!(meta.positive.as_deref(), Some("a dog"));
        assert_eq!(meta.steps, Some(12));
        assert_eq!(meta.model.as_deref(), Some("m1"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unsupported_extension_errors() {
        assert!(matches!(parse(Path::new("/x/y.gif")), Err(ParseError::Unsupported)));
    }

    /// 複数のtEXtチャンクを持つ 2x2 PNG を書く。
    fn write_png_with_texts(path: &Path, chunks: &[(&str, &str)]) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        let mut encoder = ::png::Encoder::new(w, 2, 2);
        encoder.set_color(::png::ColorType::Rgba);
        encoder.set_depth(::png::BitDepth::Eight);
        for (k, v) in chunks {
            encoder.add_text_chunk(k.to_string(), v.to_string()).unwrap();
        }
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0u8; 16]).unwrap();
    }

    #[test]
    fn parses_comfyui_png_end_to_end() {
        let dir = std::env::temp_dir().join(format!("gim_parse_comfy_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("c.png");
        let prompt = r#"{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"neon city street"}}}"#;
        write_png_with_texts(&p, &[("prompt", prompt), ("workflow", "{\"nodes\":[]}")]);

        let meta = parse(&p).unwrap();
        assert_eq!(meta.source_tool, "comfyui");
        assert_eq!(meta.raw_parameters.as_deref(), Some(prompt));
        assert!(meta.positive.as_deref().unwrap().contains("neon city street"));
        assert_eq!(meta.comfy_workflow.as_deref(), Some("{\"nodes\":[]}"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parses_png_without_metadata_is_unknown() {
        let dir = std::env::temp_dir().join(format!("gim_parse_plain_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("plain.png");
        write_png_with_texts(&p, &[]); // テキストチャンク無し
        let meta = parse(&p).unwrap();
        assert_eq!(meta.source_tool, "unknown");
        assert_eq!(meta.positive, None);
        assert_eq!(meta.raw_parameters, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
