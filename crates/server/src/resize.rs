use crate::error::ApiError;
use crate::fileserve::fnv1a64;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

/// 許可する幅。任意の値を受け付けるとキャッシュが際限なく増える。
const ALLOWED_WIDTHS: [u32; 4] = [640, 1280, 1920, 2560];
const WEBP_QUALITY: f32 = 82.0;
/// キャッシュ容量の上限。
const CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 何回生成するごとに容量を点検するか。
const SWEEP_EVERY: u64 = 50;

pub fn snap_width(requested: u32) -> u32 {
    ALLOWED_WIDTHS
        .iter()
        .copied()
        .find(|w| *w >= requested)
        .unwrap_or(ALLOWED_WIDTHS[ALLOWED_WIDTHS.len() - 1])
}

pub fn cache_key(path: &str, mtime: u64, width: u32) -> String {
    let m = mtime.to_string();
    let w = width.to_string();
    format!("{}.webp", fnv1a64(&[path, &m, &w]))
}

/// リサイズ済み WebP を返す。原画像の方が狭ければ `None`（呼び出し側が原画像を返す）。
pub async fn get_or_create(
    state: &AppState,
    src: &Path,
    mtime: u64,
    width: u32,
) -> Result<Option<Vec<u8>>, ApiError> {
    let key = cache_key(&src.to_string_lossy(), mtime, width);
    let cached = state.cache_dir.join(&key);

    if let Ok(bytes) = tokio::fs::read(&cached).await {
        return Ok(Some(bytes));
    }

    let src = src.to_path_buf();
    let cache_dir = state.cache_dir.clone();
    let out = tokio::task::spawn_blocking(move || encode_resized(&src, width, &cache_dir, &key))
        .await
        .map_err(|e| ApiError::Internal(format!("リサイズに失敗しました: {e}")))??;

    if out.is_some() {
        let n = state.generated.fetch_add(1, Ordering::Relaxed) + 1;
        if n.is_multiple_of(SWEEP_EVERY) {
            let dir = state.cache_dir.clone();
            tokio::task::spawn_blocking(move || sweep(&dir, CACHE_LIMIT_BYTES));
        }
    }
    Ok(out)
}

fn encode_resized(
    src: &Path,
    width: u32,
    cache_dir: &Path,
    key: &str,
) -> Result<Option<Vec<u8>>, ApiError> {
    let img = image::open(src).map_err(|e| match e {
        image::ImageError::IoError(io) if io.kind() == std::io::ErrorKind::NotFound => {
            ApiError::NotFound
        }
        other => ApiError::Internal(format!("画像を読めません: {other}")),
    })?;

    if img.width() <= width {
        return Ok(None);
    }
    let height = ((img.height() as u64 * width as u64) / img.width() as u64).max(1) as u32;
    let resized = img.resize_exact(width, height, image::imageops::FilterType::Lanczos3);

    let rgb = resized.to_rgb8();
    let encoder = webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height());
    let bytes = encoder.encode(WEBP_QUALITY).to_vec();

    // 一時ファイル → rename。同じ画像への同時リクエストが競合しても壊れない。
    let tmp = cache_dir.join(format!("{key}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, &bytes)
        .map_err(|e| ApiError::Internal(format!("キャッシュを書けません: {e}")))?;
    let _ = std::fs::rename(&tmp, cache_dir.join(key));

    Ok(Some(bytes))
}

/// 上限を超えていればアクセス時刻の古い順に削除する。
fn sweep(cache_dir: &Path, limit: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let atime = meta.accessed().or_else(|_| meta.modified()).ok()?;
            Some((atime, meta.len(), e.path()))
        })
        .collect();

    let mut total: u64 = files.iter().map(|(_, len, _)| *len).sum();
    if total <= limit {
        return;
    }
    files.sort_by_key(|(atime, _, _)| *atime);
    for (_, len, path) in files {
        if total <= limit {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_state, write_png};

    #[tokio::test]
    async fn get_or_create_writes_cache_and_reuses_it() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("big.png");
        write_png(&src, 3000, 2000);

        let first = get_or_create(&state, &src, 42, 1280)
            .await
            .unwrap()
            .unwrap();
        assert!(!first.is_empty());

        let key = cache_key(&src.to_string_lossy(), 42, 1280);
        let cached = state.cache_dir.join(&key);
        assert!(cached.exists(), "キャッシュファイルが作られていない");

        // 2回目はキャッシュから返る。中身が一致することで確認する。
        let second = get_or_create(&state, &src, 42, 1280)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn get_or_create_declines_to_upscale() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("small.png");
        write_png(&src, 400, 300);

        let out = get_or_create(&state, &src, 1, 1280).await.unwrap();
        assert!(out.is_none(), "原画像より大きい幅では None を返す");
    }

    #[tokio::test]
    async fn resized_output_is_narrower_than_source() {
        let (state, tmp) = test_state();
        let src = tmp.path().join("wide.png");
        write_png(&src, 3000, 1000);

        let bytes = get_or_create(&state, &src, 7, 640).await.unwrap().unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 640);
        assert_eq!(
            decoded.height(),
            213,
            "アスペクト比を保つ (1000 * 640 / 3000)"
        );
    }

    #[test]
    fn snap_width_rounds_up_to_allowed_values() {
        assert_eq!(snap_width(1), 640);
        assert_eq!(snap_width(640), 640);
        assert_eq!(snap_width(641), 1280);
        assert_eq!(snap_width(1920), 1920);
        assert_eq!(snap_width(4000), 2560, "上限を超えたら最大値へ落とす");
    }

    #[test]
    fn cache_key_is_stable_and_content_derived() {
        let a = cache_key("/d/a.png", 100, 1280);
        assert_eq!(a, cache_key("/d/a.png", 100, 1280));
        assert_ne!(a, cache_key("/d/a.png", 101, 1280), "mtime で変わる");
        assert_ne!(a, cache_key("/d/a.png", 100, 1920), "幅で変わる");
        assert_ne!(a, cache_key("/d/b.png", 100, 1280), "パスで変わる");
        assert!(a.ends_with(".webp"));
    }
}
