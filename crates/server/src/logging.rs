use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use std::time::Instant;

/// 到達性の問題（URL 違い・ファイアウォール・404）を切り分ける最低限の手掛かり。
/// スマホから繋がらないとき、サーバ側に何も出ないと原因が絞れない。
pub async fn access_log(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_default();
    let started = Instant::now();

    let res = next.run(req).await;

    eprintln!(
        "{} {} -> {} ({} ms)",
        method,
        path,
        res.status().as_u16(),
        started.elapsed().as_millis()
    );
    res
}
