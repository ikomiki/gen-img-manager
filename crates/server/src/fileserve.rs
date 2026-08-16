use crate::error::ApiError;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

/// 到達できないネットワークドライブでの metadata()/read() のハングを、
/// UI を止めない範囲で打ち切る。
const READ_TIMEOUT: Duration = Duration::from_secs(3);

/// ファイル全体と mtime（epoch 秒）を読む。
/// 存在しなければ NotFound、時間内に読めなければ Unavailable。
pub async fn read_with_timeout(path: PathBuf) -> Result<(Vec<u8>, u64), ApiError> {
    let job = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        let mtime = meta
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let bytes = std::fs::read(&path)?;
        Ok::<_, std::io::Error>((bytes, mtime))
    });

    match tokio::time::timeout(READ_TIMEOUT, job).await {
        Err(_) => Err(ApiError::Unavailable),
        Ok(Err(e)) => Err(ApiError::Internal(format!("読み出しに失敗しました: {e}"))),
        Ok(Ok(Err(e))) if e.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
        Ok(Ok(Err(_))) => Err(ApiError::Unavailable),
        Ok(Ok(Ok(v))) => Ok(v),
    }
}

/// mtime だけを読む。リサイズ経路ではキャッシュが当たれば原画像を読まずに済む。
pub async fn read_meta_with_timeout(path: PathBuf) -> Result<u64, ApiError> {
    let job = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        let mtime = meta
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok::<_, std::io::Error>(mtime)
    });

    match tokio::time::timeout(READ_TIMEOUT, job).await {
        Err(_) => Err(ApiError::Unavailable),
        Ok(Err(e)) => Err(ApiError::Internal(format!("読み出しに失敗しました: {e}"))),
        Ok(Ok(Err(e))) if e.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
        Ok(Ok(Err(_))) => Err(ApiError::Unavailable),
        Ok(Ok(Ok(mtime))) => Ok(mtime),
    }
}

/// 内容で決まるキャッシュキー。mtime を含むので画像が差し替われば自然に無効化される。
pub fn fnv1a64(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.as_bytes() {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub fn etag_of(path: &str, mtime: u64, width: Option<u32>) -> String {
    let m = mtime.to_string();
    let w = width.map(|w| w.to_string()).unwrap_or_default();
    format!("\"{}\"", fnv1a64(&[path, &m, &w]))
}

pub fn content_type_for(format: &str) -> &'static str {
    match format.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// ETag が一致すれば 304、そうでなければ本体を返す。
/// キーが内容で決まるので immutable で永続キャッシュしてよい。
pub fn respond(bytes: Vec<u8>, content_type: &str, etag: &str, headers: &HeaderMap) -> Response {
    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag));

    let common = [
        (header::ETAG, etag.to_string()),
        (
            header::CACHE_CONTROL,
            "public, max-age=31536000, immutable".to_string(),
        ),
    ];

    if matches {
        return (StatusCode::NOT_MODIFIED, common).into_response();
    }
    (
        StatusCode::OK,
        common,
        [(header::CONTENT_TYPE, content_type.to_string())],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etag_changes_with_mtime_and_width() {
        let a = etag_of("/d/a.png", 100, None);
        assert_eq!(a, etag_of("/d/a.png", 100, None), "同じ入力なら安定する");
        assert_ne!(a, etag_of("/d/a.png", 101, None));
        assert_ne!(a, etag_of("/d/a.png", 100, Some(1280)));
        assert_ne!(a, etag_of("/d/b.png", 100, None));
    }

    #[test]
    fn fnv1a64_separates_fields() {
        // 区切りが無いと ("ab","c") と ("a","bc") が衝突する。
        assert_ne!(fnv1a64(&["ab", "c"]), fnv1a64(&["a", "bc"]));
    }

    #[test]
    fn content_type_maps_known_formats() {
        assert_eq!(content_type_for("PNG"), "image/png");
        assert_eq!(content_type_for("jpeg"), "image/jpeg");
        assert_eq!(content_type_for("webp"), "image/webp");
        assert_eq!(content_type_for("tiff"), "application/octet-stream");
    }

    #[tokio::test]
    async fn read_with_timeout_reports_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("nope.png");
        assert!(matches!(
            read_with_timeout(missing).await,
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn read_with_timeout_returns_bytes_and_mtime() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.bin");
        std::fs::write(&p, b"hello").unwrap();
        let (bytes, mtime) = read_with_timeout(p).await.unwrap();
        assert_eq!(bytes, b"hello");
        assert!(mtime > 0);
    }
}
