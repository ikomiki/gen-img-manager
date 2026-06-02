use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// パスの到達性を「タイムアウト付き」で確認する。
/// 切断されたネットワークドライブで `exists()` がハングしてもUIを止めないため、
/// 別スレッドで判定し、期限内に応答が無ければ到達不可とみなす。
///
/// 注: タイムアウト時、ハング中の判定スレッドは join されずリークする
/// （切断ドライブで永久ブロックするスレッドを切り離してUIを守るための意図的設計）。
/// スキャンは手動＋起動時差分の低頻度トリガのため、リークの累積は実用上問題にならない。
pub fn is_reachable(path: &Path, timeout: Duration) -> bool {
    let p = path.to_path_buf();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(p.exists());
    });
    matches!(rx.recv_timeout(timeout), Ok(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_dir_is_reachable() {
        let dir = std::env::temp_dir();
        assert!(is_reachable(&dir, Duration::from_secs(2)));
    }

    #[test]
    fn nonexistent_path_is_not_reachable() {
        let p = std::env::temp_dir().join("definitely_not_here_gim_xyz");
        assert!(!is_reachable(&p, Duration::from_secs(2)));
    }
}
