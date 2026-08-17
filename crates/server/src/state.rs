use crate::error::ApiError;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub cache_dir: PathBuf,
    /// リサイズ生成の累計回数。キャッシュ容量の点検頻度を決めるのに使う。
    pub generated: Arc<AtomicU64>,
    /// フルデコード＋Lanczos3リサイズの同時実行数を制限する。認証なしでLANに
    /// 公開するため、並列リクエストだけで全コアとメモリを持っていかれないようにする。
    pub resize_slots: Arc<tokio::sync::Semaphore>,
    /// `--allow-host` で明示的に許可されたホスト名（DNSリバインディング対策の例外リスト）。
    pub allowed_hosts: Arc<Vec<String>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        let parallelism = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        Self {
            db_path: data_dir.join("library.db"),
            cache_dir: data_dir.join("web-cache"),
            generated: Arc::new(AtomicU64::new(0)),
            resize_slots: Arc::new(tokio::sync::Semaphore::new(parallelism)),
            allowed_hosts: Arc::new(Vec::new()),
        }
    }

    pub fn with_allowed_hosts(mut self, hosts: Vec<String>) -> Self {
        self.allowed_hosts = Arc::new(hosts);
        self
    }

    /// 接続はプールせずリクエストごとに開く。デスクトップ版によるスキーマ変更に
    /// 次のリクエストから追随でき、長い読み取りトランザクションで WAL が肥大しない。
    pub fn conn(&self) -> Result<rusqlite::Connection, ApiError> {
        gim_core::db::open_read_only(&self.db_path)
            .map_err(|e| ApiError::internal("DBを開けません", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn db_open_failure_does_not_leak_the_path() {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::new(tmp.path().join("no-such-dir"));
        let err = state.conn().unwrap_err();

        let res = err.into_response();
        assert_eq!(res.status(), 500);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(
            !body.contains("no-such-dir"),
            "DBのパスが応答に漏れている: {body}"
        );
    }
}
