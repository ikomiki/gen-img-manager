use crate::db::{directories, images};
use crate::models::Directory;
use crate::{fs_guard, parser, thumbnail};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

const REACH_TIMEOUT: Duration = Duration::from_secs(3);
const EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// 進捗イベントのペイロード。
#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub directory_id: i64,
    pub processed: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScanSummary {
    pub reachable: bool,
    pub added_or_updated: usize,
    pub skipped: usize,
    pub missing: usize,
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 1ディレクトリをスキャンする。`on_progress` は1ファイルごとに呼ばれる。
/// 到達不可なら is_online=0 にして early return（解析しない）。
///
/// 前提: `thumb_dir` は**絶対パス**であること（walkdir が返す絶対パスとの
/// `starts_with` 比較で生成済みサムネを除外するため。相対パスだと除外が効かない）。
/// 既知の限界: ファイルシステムが mtime を返さない場合 mtime=0 となり、
/// サイズも不変なら変更を取りこぼしうる（大半のFSでは問題にならない）。
pub fn scan_directory<F: FnMut(ScanProgress)>(
    conn: &Connection,
    dir: &Directory,
    thumb_dir: &Path,
    now: i64,
    mut on_progress: F,
) -> rusqlite::Result<ScanSummary> {
    let root = Path::new(&dir.path);
    if !fs_guard::is_reachable(root, REACH_TIMEOUT) {
        directories::set_online(conn, dir.id, false)?;
        return Ok(ScanSummary { reachable: false, ..Default::default() });
    }

    // 対象ファイル列挙。thumb_dir 配下は除外する（サムネ自身を誤スキャンしない）。
    let walker = walkdir::WalkDir::new(root).max_depth(if dir.recursive { usize::MAX } else { 1 });
    let files: Vec<std::path::PathBuf> = walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if !e.file_type().is_file() || !is_image(e.path()) {
                return false;
            }
            // サムネディレクトリ配下はスキップ（thumb_dir が root 内にある場合の誤スキャン防止）。
            !e.path().starts_with(thumb_dir)
        })
        .map(|e| e.path().to_path_buf())
        .collect();
    let total = files.len();

    let mut summary = ScanSummary { reachable: true, ..Default::default() };
    let mut seen: HashSet<String> = HashSet::new();

    for (i, file) in files.iter().enumerate() {
        let path_str = file.to_string_lossy().to_string();
        seen.insert(path_str.clone());

        let meta = match std::fs::metadata(file) {
            Ok(m) => m,
            Err(_) => {
                // 1ファイルの失敗で全体を止めない（進捗は単調に進める）
                on_progress(ScanProgress {
                    directory_id: dir.id,
                    processed: i + 1,
                    total,
                    current: path_str,
                });
                continue;
            }
        };
        let size = meta.len() as i64;
        let mtime = mtime_secs(&meta);

        // 変更検出: path+size+mtime 一致ならスキップ（再処理抑制）。
        if let Ok(Some((id, prev_size, prev_mtime))) =
            images::find_meta_by_path(conn, &path_str)
        {
            if prev_size == size && prev_mtime == mtime {
                images::mark_missing(conn, id, false)?;
                summary.skipped += 1;
                on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str.clone() });
                continue;
            }
        }

        // 解析（失敗しても全体は継続。寸法だけ不明な場合はスキップ）。
        let parsed = match parser::parse(file) {
            Ok(p) => p,
            Err(_) => {
                on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str.clone() });
                continue;
            }
        };

        // サムネ生成（失敗してもメタは登録）。
        let thumb_path = thumbnail::generate_thumbnail(file, thumb_dir)
            .ok()
            .map(|p| p.to_string_lossy().to_string());

        // XMPサイドカーのレーティング。
        let rating = parser::xmp::read_rating_sidecar(file);

        let filename = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let new_img = images::NewImage {
            directory_id: dir.id,
            path: path_str.clone(),
            filename,
            size,
            mtime,
            created_at: Some(mtime),
            modified_at: Some(mtime),
            width: parsed.width as i64,
            height: parsed.height as i64,
            rating,
            format: parsed.format,
            thumb_path,
            raw_parameters: parsed.raw_parameters,
            positive: parsed.positive,
            negative: parsed.negative,
            model: parsed.model,
            sampler: parsed.sampler,
            steps: parsed.steps,
            seed: parsed.seed,
            cfg: parsed.cfg,
            source_tool: parsed.source_tool,
            comfy_workflow: parsed.comfy_workflow,
        };
        images::upsert(conn, &new_img)?;
        summary.added_or_updated += 1;

        on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str });
    }

    // missing検出: DB上にあるが今回見つからなかったものに印を付ける（削除はしない）。
    for (id, db_path) in images::list_paths_in_directory(conn, dir.id)? {
        if !seen.contains(&db_path) {
            images::mark_missing(conn, id, true)?;
            summary.missing += 1;
        }
    }

    directories::set_online(conn, dir.id, true)?;
    directories::set_last_scanned(conn, dir.id, now)?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use std::io::BufWriter;

    fn write_png_with_params(path: &Path, params: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        let mut encoder = ::png::Encoder::new(w, 4, 2);
        encoder.set_color(::png::ColorType::Rgba);
        encoder.set_depth(::png::BitDepth::Eight);
        encoder.add_text_chunk("parameters".into(), params.into()).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&vec![0u8; 4 * 2 * 4]).unwrap();
    }

    fn setup() -> (Connection, std::path::PathBuf, Directory) {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        let base = std::env::temp_dir().join(format!("gim_scan_{}_{}", std::process::id(), now_nonce()));
        std::fs::create_dir_all(&base).unwrap();
        let dir = directories::add(&c, base.to_str().unwrap(), "scan", true).unwrap();
        (c, base, dir)
    }

    fn now_nonce() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn scans_inserts_and_change_detection_skips() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(&base.join("a.png"), "a cat\nSteps: 10, Seed: 1");
        write_png_with_params(&base.join("b.png"), "a dog\nSteps: 12, Seed: 2");

        let s1 = scan_directory(&c, &dir, &thumb_dir, 1000, |_| {}).unwrap();
        assert!(s1.reachable);
        assert_eq!(s1.added_or_updated, 2);
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 2);

        // 2回目: 変更なし → 全てスキップ。
        let s2 = scan_directory(&c, &dir, &thumb_dir, 1001, |_| {}).unwrap();
        assert_eq!(s2.added_or_updated, 0);
        assert_eq!(s2.skipped, 2);

        // 検索（FTS）が効く。
        let hits: i64 = c
            .query_row("SELECT count(*) FROM images_fts WHERE images_fts MATCH 'cat'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hits, 1);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn deleted_file_is_marked_missing() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        let a = base.join("a.png");
        write_png_with_params(&a, "x\nSteps: 1, Seed: 1");
        scan_directory(&c, &dir, &thumb_dir, 1000, |_| {}).unwrap();
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 1);

        std::fs::remove_file(&a).unwrap();
        let s = scan_directory(&c, &dir, &thumb_dir, 1001, |_| {}).unwrap();
        assert_eq!(s.missing, 1);
        // missing は count から除外（行は残る）。
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 0);
        let rows: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unreachable_directory_sets_offline() {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        let dir = directories::add(&c, "/no/such/path/gim_unreachable", "x", true).unwrap();
        let s = scan_directory(&c, &dir, Path::new("/tmp/thumbs"), 1000, |_| {}).unwrap();
        assert!(!s.reachable);
        assert!(!directories::get(&c, dir.id).unwrap().is_online);
    }
}
