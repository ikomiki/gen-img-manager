use crate::error::ApiError;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub thumb_dir: PathBuf,
    pub cache_dir: PathBuf,
    /// リサイズ生成の累計回数。キャッシュ容量の点検頻度を決めるのに使う。
    pub generated: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            db_path: data_dir.join("library.db"),
            thumb_dir: data_dir.join("thumbnails"),
            cache_dir: data_dir.join("web-cache"),
            generated: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 接続はプールせずリクエストごとに開く。デスクトップ版によるスキーマ変更に
    /// 次のリクエストから追随でき、長い読み取りトランザクションで WAL が肥大しない。
    pub fn conn(&self) -> Result<rusqlite::Connection, ApiError> {
        gim_core::db::open_read_only(&self.db_path)
            .map_err(|e| ApiError::Internal(format!("DBを開けません: {e}")))
    }
}
