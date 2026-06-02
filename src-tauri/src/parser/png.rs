use std::collections::HashMap;
use std::io::BufReader;
use std::path::Path;

/// PNGから取り出した寸法とテキストチャンク（keyword -> text）。
#[derive(Debug, Clone, PartialEq)]
pub struct PngData {
    pub width: u32,
    pub height: u32,
    pub texts: HashMap<String, String>,
}

/// PNGの IHDR と（IDAT前の）tEXt/zTXt/iTXt チャンクを読む。
/// A1111 の `parameters`、ComfyUI の `prompt`/`workflow` は IDAT 前に書かれるため取得できる。
pub fn read_png(path: &Path) -> Result<PngData, png::DecodingError> {
    let file = std::fs::File::open(path)?;
    let decoder = png::Decoder::new(BufReader::new(file));
    let reader = decoder.read_info()?;
    let info = reader.info();

    let mut texts = HashMap::new();
    for c in &info.uncompressed_latin1_text {
        texts.insert(c.keyword.clone(), c.text.clone());
    }
    for c in &info.compressed_latin1_text {
        if let Ok(t) = c.get_text() {
            texts.insert(c.keyword.clone(), t);
        }
        // ignore decompression errors
    }
    for c in &info.utf8_text {
        if let Ok(t) = c.get_text() {
            texts.insert(c.keyword.clone(), t);
        }
        // ignore decompression errors
    }

    Ok(PngData {
        width: info.width,
        height: info.height,
        texts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    /// 2x2 RGBA の PNG を tEXt チャンク付きで temp に書き出す。
    fn write_png_with_text(path: &Path, keyword: &str, text: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        let mut encoder = png::Encoder::new(w, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .add_text_chunk(keyword.to_string(), text.to_string())
            .unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0u8; 16]).unwrap();
    }

    #[test]
    fn reads_dimensions_and_parameters_text() {
        let dir = std::env::temp_dir().join(format!("gim_png_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.png");
        write_png_with_text(&p, "parameters", "masterpiece\nSteps: 20, Seed: 5");

        let data = read_png(&p).unwrap();
        assert_eq!((data.width, data.height), (2, 2));
        assert_eq!(
            data.texts.get("parameters").map(|s| s.as_str()),
            Some("masterpiece\nSteps: 20, Seed: 5")
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
