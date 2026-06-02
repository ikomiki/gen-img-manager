use image::GenericImageView;
use std::path::{Path, PathBuf};

const THUMB_SIZE: u32 = 512;
const THUMB_QUALITY: f32 = 80.0;

#[derive(Debug, thiserror::Error)]
pub enum ThumbError {
    #[error("image: {0}")]
    Image(#[from] image::ImageError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("webp encode failed: {0}")]
    Webp(String),
}

/// 画像パスから安定なサムネイルファイル名（FNV-1a 64bit hex + .webp）を作る。
fn thumb_filename(src: &Path) -> String {
    let s = src.to_string_lossy();
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}.webp")
}

/// 中央クロップで正方形にし、512pxへ縮小、WebP(品質80)で `thumb_dir` に保存する。
/// 保存先パスを返す。
pub fn generate_thumbnail(src: &Path, thumb_dir: &Path) -> Result<PathBuf, ThumbError> {
    let img = image::ImageReader::open(src)?
        .with_guessed_format()?
        .decode()?;
    let (w, h) = img.dimensions();
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = (h - side) / 2;
    let square = img.crop_imm(x, y, side, side);
    let thumb = square.resize_exact(THUMB_SIZE, THUMB_SIZE, image::imageops::FilterType::Lanczos3);

    let encoder = webp::Encoder::from_image(&thumb).map_err(|e| ThumbError::Webp(e.to_string()))?;
    let data = encoder.encode(THUMB_QUALITY);

    std::fs::create_dir_all(thumb_dir)?;
    let out = thumb_dir.join(thumb_filename(src));
    std::fs::write(&out, &*data)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    fn write_png(path: &Path, w: u32, h: u32) {
        let file = std::fs::File::create(path).unwrap();
        let bw = BufWriter::new(file);
        let mut encoder = png::Encoder::new(bw, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let buf = vec![0u8; (w * h * 4) as usize];
        writer.write_image_data(&buf).unwrap();
    }

    #[test]
    fn generates_square_512_webp() {
        let dir = std::env::temp_dir().join(format!("gim_thumb_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wide.png");
        write_png(&src, 100, 40); // 横長

        let thumb_dir = dir.join("thumbs");
        let out = generate_thumbnail(&src, &thumb_dir).unwrap();
        assert!(out.exists());
        assert_eq!(out.extension().unwrap(), "webp");

        // 生成物を読み戻して 512x512 正方形を確認。
        let (tw, th) = image::ImageReader::open(&out)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!((tw, th), (512, 512));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filename_is_stable_for_same_path() {
        assert_eq!(thumb_filename(Path::new("/a/b.png")), thumb_filename(Path::new("/a/b.png")));
        assert_ne!(thumb_filename(Path::new("/a/b.png")), thumb_filename(Path::new("/a/c.png")));
    }
}
