use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::events::Event as WEvent;
use quick_xml::Reader;
use quick_xml::Writer;
use std::io::Cursor;
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

/// 書き込み先サイドカーパスを決める。
/// 既存の image.ext.xmp / image.xmp があればそれを優先し、無ければ image.ext.xmp を返す。
fn sidecar_write_path(image_path: &Path) -> PathBuf {
    let mut with_suffix = image_path.as_os_str().to_os_string();
    with_suffix.push(".xmp");
    let with_suffix = PathBuf::from(with_suffix);
    if with_suffix.exists() {
        return with_suffix;
    }
    let bare = image_path.with_extension("xmp");
    if bare.exists() {
        return bare;
    }
    with_suffix
}

/// 画像に対応する .xmp サイドカーへ Rating を書き出す（None でクリア）。
/// 既存ファイルがあれば xmp:Rating のみマージ更新し、無ければ最小XMPを新規作成する。
/// None かつ既存ファイルが無い場合は何もしない。
pub fn write_rating_sidecar(image_path: &Path, rating: Option<i64>) -> std::io::Result<()> {
    let target = sidecar_write_path(image_path);
    let existing = std::fs::read_to_string(&target).unwrap_or_default();
    if rating.is_none() && existing.trim().is_empty() {
        return Ok(());
    }
    let updated = upsert_rating_in_xmp(&existing, rating);
    if updated.trim().is_empty() {
        // 何も書くものが無い（空のままクリア）→ ファイルがあれば内容を空更新せず触らない。
        return Ok(());
    }
    std::fs::write(&target, updated)
}

const MINIMAL_TEMPLATE_HEAD: &str =
    "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
     <x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n\
     <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n\
     <rdf:Description xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"";

fn minimal_xmp(rating: i64) -> String {
    format!(
        "{head}><xmp:Rating>{r}</xmp:Rating></rdf:Description>\n\
         </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>",
        head = MINIMAL_TEMPLATE_HEAD,
        r = rating
    )
}

/// XMP文字列中の xmp:Rating を更新（Some）または除去（None）したXMLを返す。
/// 属性形式 `xmp:Rating="N"` と要素形式 `<xmp:Rating>N</xmp:Rating>` の双方に対応する。
/// どちらも存在しない場合、Some なら最初の rdf:Description 終了直前に要素を挿入する。
/// 入力が空/Descriptionを含まない場合、Some なら最小XMPを生成し、None なら入力をそのまま返す。
pub fn upsert_rating_in_xmp(xml: &str, rating: Option<i64>) -> String {
    if xml.trim().is_empty() {
        return match rating {
            Some(r) => minimal_xmp(r.clamp(0, 5)),
            None => String::new(),
        };
    }

    let mut reader = Reader::from_str(xml);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut in_rating_element = false;
    let mut found = false;
    let mut injected = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"xmp:Rating" => {
                found = true;
                in_rating_element = true;
                if let Some(r) = rating {
                    let _ = writer.write_event(WEvent::Start(BytesStart::new("xmp:Rating")));
                    let _ = writer.write_event(WEvent::Text(BytesText::new(&r.clamp(0, 5).to_string())));
                }
                // None のときは Start を書かない（除去）。
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"xmp:Rating" => {
                in_rating_element = false;
                if rating.is_some() {
                    let _ = writer.write_event(WEvent::End(BytesEnd::new("xmp:Rating")));
                }
                // None のときは End も書かない。
            }
            Ok(Event::Text(_)) if in_rating_element => {
                // 旧Ratingのテキストは捨てる（Some時は上で新値を出力済み）。
            }
            Ok(Event::Empty(e)) => {
                // 属性に xmp:Rating を持つ自己完結要素を書き換える。
                let mut out = BytesStart::new(String::from_utf8_lossy(e.name().as_ref()).into_owned());
                let mut had_rating = false;
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == b"xmp:Rating" {
                        had_rating = true;
                        found = true;
                        if let Some(r) = rating {
                            out.push_attribute(("xmp:Rating", r.clamp(0, 5).to_string().as_str()));
                        }
                        // None のときは属性を落とす。
                    } else {
                        out.push_attribute(attr);
                    }
                }
                // Rating属性が無く、まだ挿入していない rdf:Description で Some の場合は属性を足す。
                if !had_rating
                    && rating.is_some()
                    && !found
                    && !injected
                    && e.name().as_ref() == b"rdf:Description"
                {
                    out.push_attribute(("xmp:Rating", rating.unwrap().clamp(0, 5).to_string().as_str()));
                    injected = true;
                }
                let _ = writer.write_event(WEvent::Empty(out));
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"rdf:Description" => {
                // 既存Ratingが無く Some の場合、Description 終了直前に要素を挿入。
                if rating.is_some() && !found && !injected {
                    let r = rating.unwrap().clamp(0, 5);
                    let _ = writer.write_event(WEvent::Start(BytesStart::new("xmp:Rating")));
                    let _ = writer.write_event(WEvent::Text(BytesText::new(&r.to_string())));
                    let _ = writer.write_event(WEvent::End(BytesEnd::new("xmp:Rating")));
                    injected = true;
                }
                let _ = writer.write_event(WEvent::End(e.to_owned()));
            }
            Ok(Event::Eof) => break,
            Ok(ev) => {
                let _ = writer.write_event(ev);
            }
            Err(_) => break,
        }
    }

    let bytes = writer.into_inner().into_inner();
    let result = String::from_utf8_lossy(&bytes).into_owned();
    // Description が無くて挿入できず、Some の場合は最小XMPにフォールバック。
    if rating.is_some() && !found && !injected {
        return minimal_xmp(rating.unwrap().clamp(0, 5));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_replaces_element_rating() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Rating>2</xmp:Rating></rdf:Description>"#;
        let out = upsert_rating_in_xmp(xml, Some(5));
        assert_eq!(parse_rating(&out), Some(5));
        // 既存の他構造（rdf:Description）が残る。
        assert!(out.contains("rdf:Description"));
    }

    #[test]
    fn upsert_replaces_attribute_rating() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="2"/>"#;
        let out = upsert_rating_in_xmp(xml, Some(4));
        assert_eq!(parse_rating(&out), Some(4));
    }

    #[test]
    fn upsert_injects_when_absent() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Label>x</xmp:Label></rdf:Description>"#;
        let out = upsert_rating_in_xmp(xml, Some(3));
        assert_eq!(parse_rating(&out), Some(3));
        // 既存タグを保持。
        assert!(out.contains("xmp:Label"));
    }

    #[test]
    fn upsert_clear_removes_element() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Rating>5</xmp:Rating><xmp:Label>x</xmp:Label></rdf:Description>"#;
        let out = upsert_rating_in_xmp(xml, None);
        assert_eq!(parse_rating(&out), None);
        assert!(out.contains("xmp:Label"));
    }

    #[test]
    fn upsert_clear_removes_attribute() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"/>"#;
        let out = upsert_rating_in_xmp(xml, None);
        assert_eq!(parse_rating(&out), None);
    }

    #[test]
    fn upsert_empty_doc_some_creates_minimal() {
        let out = upsert_rating_in_xmp("", Some(4));
        assert_eq!(parse_rating(&out), Some(4));
        assert!(out.contains("x:xmpmeta"));
    }

    #[test]
    fn upsert_empty_doc_none_is_empty() {
        let out = upsert_rating_in_xmp("", None);
        assert!(parse_rating(&out).is_none());
    }

    #[test]
    fn write_creates_sidecar_with_suffix_when_absent() {
        let dir = std::env::temp_dir().join(format!("gim_xmpw_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"x").unwrap();
        write_rating_sidecar(&img, Some(4)).unwrap();
        assert_eq!(read_rating_sidecar(&img), Some(4));
        assert!(dir.join("pic.png.xmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_updates_existing_bare_sidecar() {
        let dir = std::env::temp_dir().join(format!("gim_xmpw_bare_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"x").unwrap();
        std::fs::write(
            dir.join("pic.xmp"),
            r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="1"/>"#,
        )
        .unwrap();
        write_rating_sidecar(&img, Some(5)).unwrap();
        // 既存 image.xmp を更新（image.png.xmp は作らない）。
        assert!(!dir.join("pic.png.xmp").exists());
        assert_eq!(read_rating_sidecar(&img), Some(5));
        std::fs::remove_dir_all(&dir).ok();
    }

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
