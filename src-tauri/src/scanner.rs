use crate::db::{directories, images};
use crate::models::Directory;
use crate::{fs_guard, parser, thumbnail};
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const REACH_TIMEOUT: Duration = Duration::from_secs(3);
const EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
/// 進捗 emit を間引く間隔（件）。
pub const EMIT_INTERVAL: usize = 25;
/// 並列スキャンの既定同時実行数（settings の scan_concurrency で上書き）。
pub const DEFAULT_CONCURRENCY: usize = 8;

/// 事前ロードした既存画像メタ（変更検出用）。
#[derive(Debug, Clone, PartialEq)]
pub struct PrevMeta {
    pub id: i64,
    pub size: i64,
    pub mtime: i64,
    pub missing: bool,
}

/// 1ファイルの処理方針。
#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// 未変更。parse/サムネ不要。was_missing が真なら missing フラグ解除が必要。
    Skip { id: i64, was_missing: bool },
    /// 新規または変更。parse + サムネ生成が必要。
    NeedsParse,
}

/// stat 結果（size, mtime）と既存メタから処理方針を決める。
pub fn decide(size: i64, mtime: i64, prev: Option<&PrevMeta>) -> Decision {
    match prev {
        Some(p) if p.size == size && p.mtime == mtime => {
            Decision::Skip { id: p.id, was_missing: p.missing }
        }
        _ => Decision::NeedsParse,
    }
}

/// 進捗 emit すべきか（一定間隔ごと、かつ最終件は必ず）。
pub fn should_emit(processed: usize, total: usize, interval: usize) -> bool {
    processed == total || (interval > 0 && processed % interval == 0)
}

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

fn created_secs(meta: &std::fs::Metadata, fallback: i64) -> i64 {
    meta.created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(fallback)
}

/// 1ファイル分の並列処理の結果。DB 書き込みは呼び出し側（writer）で逐次行う。
enum FileOutcome {
    /// 未変更。was_missing が真なら missing フラグ解除のみ必要。
    Unchanged { id: i64, was_missing: bool },
    /// 新規/変更。parse + サムネ済み。タグ紐付けは writer で行う。
    Upsert {
        image: Box<images::NewImage>,
        tags: Vec<(String, crate::parser::tags::TagKind)>,
    },
    /// stat / parse 失敗（集計しない＝現状踏襲）。
    Failed,
}

/// 1ファイルを処理する（DB には触れない）。stat→変更検出→（必要なら）parse+サムネ。
fn process_one(
    file: &Path,
    path_str: &str,
    prev_map: &std::collections::HashMap<String, PrevMeta>,
    thumb_dir: &Path,
) -> FileOutcome {
    let meta = match std::fs::metadata(file) {
        Ok(m) => m,
        Err(_) => return FileOutcome::Failed,
    };
    let size = meta.len() as i64;
    let mtime = mtime_secs(&meta);
    let created = created_secs(&meta, mtime);

    match decide(size, mtime, prev_map.get(path_str)) {
        Decision::Skip { id, was_missing } => FileOutcome::Unchanged { id, was_missing },
        Decision::NeedsParse => {
            let parsed = match parser::parse(file) {
                Ok(p) => p,
                Err(_) => return FileOutcome::Failed,
            };
            let thumb_path = thumbnail::generate_thumbnail(file, thumb_dir)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            let rating = parser::xmp::read_rating_sidecar(file);
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            // NewImage に move する前にタグを抽出する。
            let tags = parser::tags::extract_tags(
                parsed.positive.as_deref(),
                parsed.negative.as_deref(),
                &parsed.source_tool,
            );
            FileOutcome::Upsert {
                image: Box::new(images::NewImage {
                    directory_id: 0, // writer 側で dir.id を設定する
                    path: path_str.to_string(),
                    filename,
                    size,
                    mtime,
                    created_at: Some(created),
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
                }),
                tags,
            }
        }
    }
}

/// 接続ロックを取得する（毒されていても中身を取り出して継続）。
fn lock_conn(conn: &Arc<Mutex<Connection>>) -> std::sync::MutexGuard<'_, Connection> {
    conn.lock().unwrap_or_else(|e| e.into_inner())
}

/// 1ディレクトリをスキャンする。`on_progress` は進捗の節目ごとに呼ばれる。
/// 到達不可なら is_online=0 にして early return（解析しない）。
///
/// 前提: `thumb_dir` は**絶対パス**であること（walkdir が返す絶対パスとの
/// `starts_with` 比較で生成済みサムネを除外するため。相対パスだと除外が効かない）。
/// 既知の限界: ファイルシステムが mtime を返さない場合 mtime=0 となり、
/// サイズも不変なら変更を取りこぼしうる（大半のFSでは問題にならない）。
pub fn scan_directory<F: Fn(ScanProgress) + Sync>(
    conn: &Arc<Mutex<Connection>>,
    dir: &Directory,
    thumb_dir: &Path,
    now: i64,
    concurrency: usize,
    on_progress: F,
) -> rusqlite::Result<ScanSummary> {
    let root = Path::new(&dir.path);
    if !fs_guard::is_reachable(root, REACH_TIMEOUT) {
        let c = lock_conn(conn);
        directories::set_online(&c, dir.id, false)?;
        return Ok(ScanSummary { reachable: false, ..Default::default() });
    }

    // 対象ファイル列挙（thumb_dir 配下は除外）。DBロック不要。
    let walker = walkdir::WalkDir::new(root).max_depth(if dir.recursive { usize::MAX } else { 1 });
    let files: Vec<std::path::PathBuf> = walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if !e.file_type().is_file() || !is_image(e.path()) {
                return false;
            }
            !e.path().starts_with(thumb_dir)
        })
        .map(|e| e.path().to_path_buf())
        .collect();
    let total = files.len();

    // 既存メタを一度だけ事前ロード（変更検出 + missing 検出に共用）。短時間ロック。
    let existing = {
        let c = lock_conn(conn);
        images::list_meta_in_directory(&c, dir.id)?
    };
    let prev_map: std::collections::HashMap<String, PrevMeta> = existing
        .iter()
        .map(|(path, id, size, mtime, missing)| {
            (
                path.clone(),
                PrevMeta { id: *id, size: *size, mtime: *mtime, missing: *missing },
            )
        })
        .collect();

    // 並列フェーズ: stat→decide→parse+サムネ。DB には触れない（ロックを保持しない）。
    // ここが長時間（NASのファイルI/O）なので、この間は他のDB操作をブロックしない。
    let counter = AtomicUsize::new(0);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(concurrency.max(1))
        .build()
        .expect("failed to build rayon pool");
    let outcomes: Vec<FileOutcome> = pool.install(|| {
        files
            .par_iter()
            .map(|file| {
                let path_str = file.to_string_lossy().to_string();
                let outcome = process_one(file, &path_str, &prev_map, thumb_dir);
                let processed = counter.fetch_add(1, Ordering::Relaxed) + 1;
                if should_emit(processed, total, EMIT_INTERVAL) {
                    on_progress(ScanProgress {
                        directory_id: dir.id,
                        processed,
                        total,
                        current: path_str,
                    });
                }
                outcome
            })
            .collect()
    });
    // 0件時は並列ループが何も emit しないため、ここで1回だけ UI を進める。
    if total == 0 {
        on_progress(ScanProgress { directory_id: dir.id, processed: 0, total: 0, current: String::new() });
    }

    // 書き込みフェーズ（逐次・単一接続）。ここだけロックを保持する。
    let mut summary = ScanSummary { reachable: true, ..Default::default() };
    {
        let c = lock_conn(conn);
        for outcome in outcomes {
            match outcome {
                FileOutcome::Unchanged { id, was_missing } => {
                    if was_missing {
                        images::mark_missing(&c, id, false)?;
                    }
                    summary.skipped += 1;
                }
                FileOutcome::Upsert { mut image, tags } => {
                    image.directory_id = dir.id;
                    let image_id = images::upsert(&c, &image)?;
                    let pairs: Vec<(&str, &str)> =
                        tags.iter().map(|(n, k)| (n.as_str(), k.as_str())).collect();
                    crate::db::tags::replace_image_tags(&c, image_id, &pairs)?;
                    summary.added_or_updated += 1;
                }
                FileOutcome::Failed => {}
            }
        }

        // missing 検出: 列挙されなかった既存パスに印を付ける（事前ロード済み existing を再利用）。
        let seen: std::collections::HashSet<String> =
            files.iter().map(|f| f.to_string_lossy().to_string()).collect();
        for (db_path, id, _size, _mtime, _missing) in &existing {
            if !seen.contains(db_path) {
                images::mark_missing(&c, *id, true)?;
                summary.missing += 1;
            }
        }

        directories::set_online(&c, dir.id, true)?;
        directories::set_last_scanned(&c, dir.id, now)?;
    }
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

    fn unique_id() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        COUNTER.fetch_add(1, Ordering::Relaxed)
    }

    // gim-core 側の同名ヘルパは #[cfg(test)] 限定で crate 境界を越えて参照できないため複製。
    fn count_in_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT count(*) FROM images WHERE directory_id = ?1 AND missing = 0",
            rusqlite::params![directory_id],
            |r| r.get(0),
        )
    }

    fn setup() -> (Arc<Mutex<Connection>>, std::path::PathBuf, Directory) {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        let base = std::env::temp_dir().join(format!(
            "gim_scan_{}_{}",
            std::process::id(),
            unique_id()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let dir = directories::add(&c, base.to_str().unwrap(), "scan", true).unwrap();
        (Arc::new(Mutex::new(c)), base, dir)
    }

    #[test]
    fn scans_inserts_and_change_detection_skips() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(&base.join("a.png"), "a cat\nSteps: 10, Seed: 1");
        write_png_with_params(&base.join("b.png"), "a dog\nSteps: 12, Seed: 2");

        let s1 = scan_directory(&c, &dir, &thumb_dir, 1000, 4, |_| {}).unwrap();
        assert!(s1.reachable);
        assert_eq!(s1.added_or_updated, 2);
        assert_eq!(count_in_directory(&c.lock().unwrap(), dir.id).unwrap(), 2);

        // 2回目: 変更なし → 全てスキップ。
        let s2 = scan_directory(&c, &dir, &thumb_dir, 1001, 4, |_| {}).unwrap();
        assert_eq!(s2.added_or_updated, 0);
        assert_eq!(s2.skipped, 2);

        // 検索（FTS）が効く。
        let hits: i64 = c.lock().unwrap()
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
        scan_directory(&c, &dir, &thumb_dir, 1000, 4, |_| {}).unwrap();
        assert_eq!(count_in_directory(&c.lock().unwrap(), dir.id).unwrap(), 1);

        std::fs::remove_file(&a).unwrap();
        let s = scan_directory(&c, &dir, &thumb_dir, 1001, 4, |_| {}).unwrap();
        assert_eq!(s.missing, 1);
        // missing は count から除外（行は残る）。
        assert_eq!(count_in_directory(&c.lock().unwrap(), dir.id).unwrap(), 0);
        let rows: i64 = c.lock().unwrap().query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unreachable_directory_sets_offline() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        let dir = directories::add(&conn, "/no/such/path/gim_unreachable", "x", true).unwrap();
        let c = Arc::new(Mutex::new(conn));
        let s = scan_directory(&c, &dir, Path::new("/tmp/thumbs"), 1000, 4, |_| {}).unwrap();
        assert!(!s.reachable);
        assert!(!directories::get(&c.lock().unwrap(), dir.id).unwrap().is_online);
    }

    #[test]
    fn decide_skip_when_unchanged() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(
            decide(100, 200, Some(&prev)),
            Decision::Skip { id: 7, was_missing: false }
        );
    }

    #[test]
    fn decide_skip_reports_was_missing() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: true };
        assert_eq!(
            decide(100, 200, Some(&prev)),
            Decision::Skip { id: 7, was_missing: true }
        );
    }

    #[test]
    fn decide_needs_parse_when_size_changed() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(decide(101, 200, Some(&prev)), Decision::NeedsParse);
    }

    #[test]
    fn decide_needs_parse_when_mtime_changed() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(decide(100, 201, Some(&prev)), Decision::NeedsParse);
    }

    #[test]
    fn decide_needs_parse_when_new() {
        assert_eq!(decide(100, 200, None), Decision::NeedsParse);
    }

    #[test]
    fn should_emit_on_interval_and_final() {
        assert!(should_emit(25, 1000, 25));
        assert!(should_emit(50, 1000, 25));
        assert!(!should_emit(24, 1000, 25));
        assert!(should_emit(1000, 1000, 25)); // final item always
        assert!(should_emit(0, 0, 25)); // 0 files: processed==total==0
    }

    #[test]
    fn parallel_scan_handles_many_files_and_skips_on_rescan() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        for i in 0..30 {
            write_png_with_params(&base.join(format!("f{i}.png")), &format!("p{i}\nSteps: 1, Seed: {i}"));
        }
        let s1 = scan_directory(&c, &dir, &thumb_dir, 1000, 8, |_| {}).unwrap();
        assert_eq!(s1.added_or_updated, 30);
        assert_eq!(count_in_directory(&c.lock().unwrap(), dir.id).unwrap(), 30);
        let s2 = scan_directory(&c, &dir, &thumb_dir, 1001, 8, |_| {}).unwrap();
        assert_eq!(s2.added_or_updated, 0);
        assert_eq!(s2.skipped, 30);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn progress_callback_reaches_final_total() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(&base.join("a.png"), "x\nSteps: 1, Seed: 1");
        write_png_with_params(&base.join("b.png"), "y\nSteps: 1, Seed: 2");
        let max_processed = std::sync::atomic::AtomicUsize::new(0);
        scan_directory(&c, &dir, &thumb_dir, 1000, 4, |p| {
            assert_eq!(p.total, 2);
            max_processed.fetch_max(p.processed, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(max_processed.load(std::sync::atomic::Ordering::Relaxed), 2);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn scan_links_tags_for_a1111_image() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(
            &base.join("a.png"),
            "forest, 1girl\nNegative prompt: blurry\nSteps: 10, Seed: 1",
        );
        scan_directory(&c, &dir, &thumb_dir, 1000, 4, |_| {}).unwrap();

        let conn = c.lock().unwrap();
        let prompt: i64 = conn
            .query_row("SELECT count(*) FROM image_tags WHERE kind='prompt'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prompt, 2); // forest, 1girl
        let neg: i64 = conn
            .query_row("SELECT count(*) FROM image_tags WHERE kind='negative'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(neg, 1); // blurry
        drop(conn);
        std::fs::remove_dir_all(&base).ok();
    }
}
