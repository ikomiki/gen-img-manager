use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::path::{Path, PathBuf};

/// Start/Empty 要素の属性から xmp:Rating を取り出す（0..=5 にクランプ）。
fn rating_from_attrs(e: &BytesStart) -> Option<i64> {
    for attr in e.attributes().flatten() {
        if attr.key.as_ref() == b"xmp:Rating" {
            if let Ok(v) = attr.unescape_value() {
                if let Ok(r) = v.trim().parse::<i64>() {
                    return Some(r.clamp(0, 5));
                }
            }
        }
    }
    None
}

/// XMP文字列から xmp:Rating を抽出する（0..=5 にクランプ）。
/// 属性 `xmp:Rating="4"` と要素 `<xmp:Rating>4</xmp:Rating>` の両方に対応。
/// 注: quick-xml の Text は文字コード変換のみ（XMLエンティティ解決はしない）が、
/// 数値レーティングにエンティティは含まれないため実害はない。
/// 注: XMP仕様の Rating=-1（rejected）は clamp により 0 として扱う。
pub fn parse_rating(xml: &str) -> Option<i64> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut in_rating_element = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"xmp:Rating" {
                    in_rating_element = true;
                }
                if let Some(r) = rating_from_attrs(&e) {
                    return Some(r);
                }
            }
            Ok(Event::Empty(e)) => {
                // 自己完結タグはテキストを持たないため属性のみ確認（フラグは立てない）。
                if let Some(r) = rating_from_attrs(&e) {
                    return Some(r);
                }
            }
            Ok(Event::Text(t)) if in_rating_element => {
                if let Ok(s) = t.decode() {
                    if let Ok(r) = s.trim().parse::<i64>() {
                        return Some(r.clamp(0, 5));
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"xmp:Rating" {
                    in_rating_element = false;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    None
}

/// 画像パスに対応するサイドカー .xmp を探して読み、レーティングを返す。
/// `image.png.xmp` を優先し、無ければ `image.xmp` を試す。
pub fn read_rating_sidecar(image_path: &Path) -> Option<i64> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // image.ext.xmp
    let mut with_suffix = image_path.as_os_str().to_os_string();
    with_suffix.push(".xmp");
    candidates.push(PathBuf::from(with_suffix));
    // image.xmp
    candidates.push(image_path.with_extension("xmp"));

    for cand in candidates {
        if let Ok(xml) = std::fs::read_to_string(&cand) {
            if let Some(r) = parse_rating(&xml) {
                return Some(r);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rating_as_element() {
        let xml = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
              <rdf:Description><xmp:Rating>4</xmp:Rating></rdf:Description>
            </rdf:RDF></x:xmpmeta>"#;
        assert_eq!(parse_rating(xml), Some(4));
    }

    #[test]
    fn reads_rating_as_attribute() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"/>"#;
        assert_eq!(parse_rating(xml), Some(5));
    }

    #[test]
    fn clamps_out_of_range() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="9"/>"#;
        assert_eq!(parse_rating(xml), Some(5));
    }

    #[test]
    fn no_rating_returns_none() {
        assert_eq!(parse_rating("<x>nothing</x>"), None);
    }

    #[test]
    fn sidecar_with_suffix_is_read() {
        let dir = std::env::temp_dir().join(format!("gim_xmp_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"not a real png").unwrap();
        std::fs::write(
            dir.join("pic.png.xmp"),
            r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="3"/>"#,
        )
        .unwrap();
        assert_eq!(read_rating_sidecar(&img), Some(3));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_rating_tag_does_not_leak_into_sibling_text() {
        // <xmp:Rating/> の後の兄弟テキストをレーティングと誤認しないこと。
        let xml = r#"<root xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Rating/><foo>3</foo></root>"#;
        assert_eq!(parse_rating(xml), None);
    }

    #[test]
    fn sidecar_with_bare_extension_is_read() {
        let dir = std::env::temp_dir().join(format!("gim_xmp_bare_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"not a real png").unwrap();
        // image.png.xmp は作らず、image.xmp（bare）のみ作成 → fallback 経路を検証。
        std::fs::write(
            dir.join("pic.xmp"),
            r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="2"/>"#,
        )
        .unwrap();
        assert_eq!(read_rating_sidecar(&img), Some(2));
        std::fs::remove_dir_all(&dir).ok();
    }
}
