use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// docker-compose.yml の既定公開ポート。ネイティブ起動の gim-server（既定 5180）は
/// 同じホスト上で SQLite のロックを共有できて安全なので、こちらだけを見る。
const DOCKER_SERVER_ADDR: &str = "127.0.0.1:25180";
const TIMEOUT: Duration = Duration::from_millis(300);

/// Docker 版 gim-server が既定ポートで動いているか。
/// macOS の Docker Desktop は VM 越しの bind mount で WAL のロックと `-shm` を共有できず、
/// 同時に書き込むとこのアプリが SIGBUS で落ちる。
#[tauri::command]
pub async fn docker_server_running() -> bool {
    probe(DOCKER_SERVER_ADDR.parse().expect("valid addr"))
}

/// `/api/health` はコンテナ内で library.db を開いてしまい、それ自体が事故の引き金になる。
/// DB に触れない未知の `/api/*` パスの 404 応答で gim-server かどうかを見分ける。
fn probe(addr: SocketAddr) -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&addr, TIMEOUT) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(TIMEOUT));
    let _ = s.set_write_timeout(Some(TIMEOUT));
    if s
        .write_all(b"GET /api/__gim_probe HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = Vec::new();
    let _ = s.take(64 * 1024).read_to_end(&mut buf);
    looks_like_gim_server(&String::from_utf8_lossy(&buf))
}

fn looks_like_gim_server(resp: &str) -> bool {
    let Some((head, body)) = resp.split_once("\r\n\r\n") else {
        return false;
    };
    let is_404 = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        == Some("404");
    is_404
        && serde_json::from_str::<serde_json::Value>(body)
            .is_ok_and(|v| v.get("error").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_gim_server_404() {
        let r = "HTTP/1.0 404 Not Found\r\ncontent-type: application/json\r\n\r\n{\"error\":\"見つかりません\"}";
        assert!(looks_like_gim_server(r));
    }

    #[test]
    fn rejects_other_responses() {
        assert!(!looks_like_gim_server("HTTP/1.1 404 Not Found\r\n\r\n<html>nope</html>"));
        assert!(!looks_like_gim_server("HTTP/1.1 200 OK\r\n\r\n{\"error\":\"x\"}"));
        assert!(!looks_like_gim_server("HTTP/1.1 404 Not Found\r\n\r\n{\"message\":\"x\"}"));
        assert!(!looks_like_gim_server(""));
    }

    #[test]
    fn probe_against_closed_port_is_false() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        drop(l);
        assert!(!probe(addr));
    }
}
