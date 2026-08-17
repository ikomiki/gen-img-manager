//! DNSリバインディング対策。認証なしで LAN に公開するこのサーバは、
//! 悪意あるページが被害者のブラウザ上で自分のドメイン名を LAN 側 IP に
//! 再解決させることで、同一オリジンとして `/api/*` を読まれる恐れがある。
//! 攻撃者が制御できるのは公開DNSの名前だけなので、IPリテラル・localhost・
//! `.local`（mDNS）・明示許可リストのいずれでもない Host は拒否する。

use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::net::IpAddr;

/// `Host` ヘッダのホスト名部分（`:port` を除く）が許可対象かを判定する。
/// ヘッダが無い場合（HTTP/2 の `:authority` など axum が `Host` を持たない経路）は
/// 到達性を壊さないことを優先し、許可する。
pub fn host_allowed(host_header: Option<&str>, allow: &[String]) -> bool {
    let Some(header) = host_header else {
        return true;
    };
    let hostname = extract_hostname(header);

    if hostname.parse::<IpAddr>().is_ok() {
        return true;
    }

    let lower = hostname.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".local") {
        return true;
    }

    allow.iter().any(|a| a.eq_ignore_ascii_case(&lower))
}

/// `Host` ヘッダ文字列からポートを除いたホスト名を取り出す。
/// 角括弧付き IPv6（`[::1]:5180`）と `host:port`/`host` の両方を扱う。
fn extract_hostname(header: &str) -> &str {
    let h = header.trim();

    if let Some(rest) = h.strip_prefix('[') {
        // 角括弧が閉じていない場合は壊れた入力として丸ごと返す（どの許可条件にも
        // 一致せず拒否される）。
        return rest.split(']').next().unwrap_or(h);
    }

    // 角括弧無しの IPv6 リテラル（複数コロンを含む）を先に処理しておく。
    // これをしないと下のポート分割ロジックが誤ってコロンの位置で切ってしまう。
    if h.parse::<IpAddr>().is_ok() {
        return h;
    }

    match h.rsplit_once(':') {
        Some((name, port))
            if !name.is_empty() && !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) =>
        {
            name
        }
        _ => h,
    }
}

/// `Host` ヘッダを検査するミドルウェア。判定ロジックは全て `host_allowed` に
/// 委ね、ここでは抽出と拒否時の応答・ログだけを行う。
pub async fn host_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let host_header = req
        .headers()
        .get(axum::http::header::HOST)
        .map(|v| v.to_str().unwrap_or(""));

    if !host_allowed(host_header, &state.allowed_hosts) {
        let shown = host_header.unwrap_or("(無し)");
        // --allow-host に渡す値はポートを含まないホスト名なので、案内にはそちらを使う。
        let hostname = host_header.map(extract_hostname).unwrap_or(shown);
        eprintln!("拒否: Host ヘッダ '{shown}' は許可されていません（DNSリバインディング対策）");
        return ApiError::Forbidden(format!(
            "Host ヘッダ '{shown}' からのアクセスは許可されていません。社内DNS名などで\
             アクセスする場合は --allow-host {hostname} を指定してサーバを起動してください。"
        ))
        .into_response();
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_header_is_allowed() {
        assert!(host_allowed(None, &[]));
    }

    #[test]
    fn ipv4_literal_is_allowed_with_and_without_port() {
        assert!(host_allowed(Some("192.168.10.6:5180"), &[]));
        assert!(host_allowed(Some("192.168.10.6"), &[]));
        assert!(host_allowed(Some("127.0.0.1"), &[]));
    }

    #[test]
    fn ipv6_literal_is_allowed_with_and_without_port() {
        assert!(host_allowed(Some("[::1]:5180"), &[]));
        assert!(host_allowed(Some("[::1]"), &[]));
        // 角括弧の無い生の IPv6（本来 Host ヘッダとしては非標準だが、防御的に許可する）。
        assert!(host_allowed(Some("::1"), &[]));
    }

    #[test]
    fn localhost_is_allowed_with_and_without_port() {
        assert!(host_allowed(Some("localhost:5180"), &[]));
        assert!(host_allowed(Some("localhost"), &[]));
        assert!(host_allowed(Some("LOCALHOST"), &[]));
    }

    #[test]
    fn dot_local_suffix_is_allowed() {
        assert!(host_allowed(Some("mymac.local:5180"), &[]));
        assert!(host_allowed(Some("mymac.local"), &[]));
    }

    #[test]
    fn public_dns_name_is_rejected() {
        assert!(!host_allowed(Some("evil.example.com:5180"), &[]));
        assert!(!host_allowed(Some("evil.example.com"), &[]));
    }

    #[test]
    fn allow_list_entry_is_accepted() {
        let allow = vec!["evil.example.com".to_string()];
        assert!(host_allowed(Some("evil.example.com:5180"), &allow));
        assert!(host_allowed(Some("evil.example.com"), &allow));
        assert!(!host_allowed(Some("other.example.com"), &allow));
    }

    #[test]
    fn confusing_name_does_not_pass_as_dot_local() {
        // "local" を部分文字列に含むが ".local" で終わらない名前は拒否されること。
        assert!(!host_allowed(Some("notlocal.example.com"), &[]));
        assert!(!host_allowed(Some("notlocal.example.com:5180"), &[]));
    }
}
