use std::path::Path;

/// JPEG/WebP の寸法とEXIF UserComment（A1111 paramsが入ることが多い）。
#[derive(Debug, Clone, PartialEq)]
pub struct RasterData {
    pub width: u32,
    pub height: u32,
    pub user_comment: Option<String>,
}

/// EXIF UserComment の先頭8バイトの文字コード指定を解釈して文字列化する。
/// "ASCII\0\0\0" / "UNICODE\0"(UTF-16BE) / それ以外はUTF-8とみなす。
pub fn decode_user_comment(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 8 {
        let s = String::from_utf8_lossy(bytes).trim().to_string();
        return if s.is_empty() { None } else { Some(s) };
    }
    let (header, body) = bytes.split_at(8);
    let text = match header {
        b"ASCII\0\0\0" => String::from_utf8_lossy(body).to_string(),
        b"UNICODE\0" => {
            let u16s: Vec<u16> = body
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        }
        // 不明な文字コード指定: ヘッダ8バイトを除いた本体をUTF-8とみなす。
        _ => String::from_utf8_lossy(body).to_string(),
    };
    let text = text.trim_matches(char::from(0)).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// JPEG/WebP ファイルを読み、寸法とUserCommentを返す。
pub fn read_raster(path: &Path) -> Result<RasterData, image::ImageError> {
    let (width, height) = image::ImageReader::open(path)?
        .with_guessed_format()?
        .into_dimensions()?;

    let user_comment = read_user_comment(path);

    Ok(RasterData {
        width,
        height,
        user_comment,
    })
}

fn read_user_comment(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut reader)
        .ok()?;
    let field = exif.get_field(exif::Tag::UserComment, exif::In::PRIMARY)?;
    if let exif::Value::Undefined(ref bytes, _) = field.value {
        decode_user_comment(bytes)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ascii_user_comment() {
        let mut bytes = b"ASCII\0\0\0".to_vec();
        bytes.extend_from_slice(b"masterpiece\nSteps: 20");
        assert_eq!(
            decode_user_comment(&bytes).as_deref(),
            Some("masterpiece\nSteps: 20")
        );
    }

    #[test]
    fn decodes_unicode_user_comment() {
        let mut bytes = b"UNICODE\0".to_vec();
        for u in "hi".encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        assert_eq!(decode_user_comment(&bytes).as_deref(), Some("hi"));
    }

    #[test]
    fn empty_comment_is_none() {
        let bytes = b"ASCII\0\0\0".to_vec();
        assert_eq!(decode_user_comment(&bytes), None);
    }

    #[test]
    fn reads_jpeg_dimensions() {
        // image クレートで小さなJPEGを書き出して寸法を読み戻す。
        let dir = std::env::temp_dir().join(format!("gim_jpg_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.jpg");
        let img = image::RgbImage::new(7, 3);
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(&p, image::ImageFormat::Jpeg)
            .unwrap();

        let data = read_raster(&p).unwrap();
        assert_eq!((data.width, data.height), (7, 3));
        // EXIFを書いていないので UserComment は None。
        assert_eq!(data.user_comment, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unknown_charset_header_is_stripped() {
        // 先頭8バイトが未知コード（例: JIS\0...）でも本体だけを返す。
        let mut bytes = b"JIS\0\0\0\0\0".to_vec();
        bytes.extend_from_slice(b"hello");
        assert_eq!(decode_user_comment(&bytes).as_deref(), Some("hello"));
    }

    #[test]
    fn ascii_trailing_nulls_are_trimmed() {
        let mut bytes = b"ASCII\0\0\0".to_vec();
        bytes.extend_from_slice(b"foo\0\0");
        assert_eq!(decode_user_comment(&bytes).as_deref(), Some("foo"));
    }
}
