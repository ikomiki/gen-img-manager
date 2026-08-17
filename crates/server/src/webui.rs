//! `web/dist` をバイナリへ同梱して配信する。
//! debug ビルドでは rust-embed が実行時にディスクから読むので、
//! `pnpm -C web build` の結果が再ビルド無しで反映される。

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../../web/dist/"]
struct WebAssets;

/// Vite が出す資産の拡張子だけを見る。`mime_guess` を足すほどの種類は無い。
pub fn content_type_for_path(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ico") => "image/vnd.microsoft.icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// 資産はファイル名にハッシュが入るので永続キャッシュしてよい。
/// index.html は固定名なので、毎回サーバに確認させる。
fn cache_control_for(path: &str) -> &'static str {
    if path == "index.html" {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    }
}

const INDEX: &str = "index.html";

pub async fn spa_handler(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    // 実体があればそれを返し、無ければ index.html。クライアント側のルーティングに任せる。
    let (path, file) = match WebAssets::get(requested) {
        Some(f) => (requested, f),
        None => match WebAssets::get(INDEX) {
            Some(f) => (INDEX, f),
            // build.rs が index.html を必ず用意するので、ここへは来ない。
            None => return (StatusCode::NOT_FOUND, "web フロントが同梱されていません").into_response(),
        },
    };

    let etag = format!("\"{}\"", hex_of(&file.metadata.sha256_hash()));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type_for_path(path).to_string()),
            (header::CACHE_CONTROL, cache_control_for(path).to_string()),
            (header::ETAG, etag),
        ],
        file.data.into_owned(),
    )
        .into_response()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header, StatusCode};
    use http_body_util::BodyExt;

    async fn body_of(res: axum::response::Response) -> String {
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8_lossy(&bytes).to_string()
    }

    #[test]
    fn content_type_comes_from_extension() {
        assert_eq!(content_type_for_path("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type_for_path("assets/a.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type_for_path("assets/a.css"), "text/css; charset=utf-8");
        assert_eq!(content_type_for_path("favicon.svg"), "image/svg+xml");
        assert_eq!(content_type_for_path("x.bin"), "application/octet-stream");
    }

    #[tokio::test]
    async fn root_serves_index_html() {
        let res = spa_handler("/".parse().unwrap()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        assert!(body_of(res).await.contains("<!doctype html"));
    }

    #[tokio::test]
    async fn unknown_path_falls_back_to_index_html() {
        // SPA なので、ブックマークされた任意のパスでも index.html を返して
        // クライアント側のルーティングに任せる。
        let res = spa_handler("/viewer/123".parse().unwrap()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
    }

    #[tokio::test]
    async fn index_html_is_not_cached_forever() {
        // 資産のファイル名はハッシュ付きだが index.html は固定名。
        // immutable にすると新しいフロントが永久に降りてこない。
        let res = spa_handler("/".parse().unwrap()).await;
        let cc = res.headers()[header::CACHE_CONTROL].to_str().unwrap();
        assert!(cc.contains("no-cache"), "index.html の Cache-Control: {cc}");
    }

    #[tokio::test]
    async fn responses_carry_an_etag() {
        let res = spa_handler("/".parse().unwrap()).await;
        assert!(res.headers().contains_key(header::ETAG));
    }
}
