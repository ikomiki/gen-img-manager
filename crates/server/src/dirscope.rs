use gim_core::db::image_query::DirScope;

/// `dirs` に載せられる ID の上限。SQLite のホスト変数上限に達する前に
/// 明らかに異常な入力を弾く。
const MAX_DIR_IDS: usize = 500;

/// `dirs` クエリパラメータを `DirScope` へ変換する。
/// キーなし → Visible、空文字列 → 空集合（0件）、`1,2` → 指定ID。
pub fn parse_dirs(raw: Option<&str>) -> Result<DirScope, String> {
    let Some(raw) = raw else {
        return Ok(DirScope::Visible);
    };
    if raw.is_empty() {
        return Ok(DirScope::Ids(Vec::new()));
    }
    let parts: Vec<&str> = raw.split(',').collect();
    if parts.len() > MAX_DIR_IDS {
        return Err(format!("dirs が多すぎます (最大 {MAX_DIR_IDS} 件)"));
    }
    let mut ids = Vec::with_capacity(parts.len());
    for p in parts {
        let n: i64 = p
            .trim()
            .parse()
            .map_err(|_| format!("dirs に数値でない値があります: {p:?}"))?;
        ids.push(n);
    }
    Ok(DirScope::Ids(ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_key_means_visible() {
        assert_eq!(parse_dirs(None).unwrap(), DirScope::Visible);
    }

    #[test]
    fn empty_string_means_empty_set() {
        assert_eq!(parse_dirs(Some("")).unwrap(), DirScope::Ids(vec![]));
    }

    #[test]
    fn comma_separated_ids_are_parsed() {
        assert_eq!(
            parse_dirs(Some("1,2,3")).unwrap(),
            DirScope::Ids(vec![1, 2, 3])
        );
        assert_eq!(
            parse_dirs(Some(" 4 , 5 ")).unwrap(),
            DirScope::Ids(vec![4, 5])
        );
    }

    #[test]
    fn non_numeric_is_rejected() {
        assert!(parse_dirs(Some("1,x")).is_err());
    }

    #[test]
    fn too_many_ids_are_rejected() {
        let at_limit = (0..MAX_DIR_IDS)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        assert!(parse_dirs(Some(&at_limit)).is_ok(), "上限ちょうどは通る");

        let over_limit = (0..=MAX_DIR_IDS)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        assert!(parse_dirs(Some(&over_limit)).is_err());
    }
}
