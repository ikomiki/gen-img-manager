//! テスト専用。一時ディレクトリに書き込み可能な library.db を作り、
//! ルータを oneshot で叩くための足回りを提供する。

use crate::routes;
use crate::state::AppState;
use axum::body::Body;
use axum::http::Request;
use http_body_util::BodyExt;
use tower::ServiceExt;

/// 画像3件（a.png rating 5 / b.png rating 3 / c.png rating 4）を持つ DB と
/// 空の thumbnails/・web-cache/ を用意する。TempDir は返り値で生かし続けること。
pub fn test_state() -> (AppState, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().to_path_buf();
    std::fs::create_dir_all(data_dir.join("thumbnails")).unwrap();
    std::fs::create_dir_all(data_dir.join("web-cache")).unwrap();

    let conn = gim_core::db::open(&data_dir.join("library.db")).unwrap();
    conn.execute(
        "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
        [],
    )
    .unwrap();
    for (name, positive, rating, width) in [
        ("a.png", "forest cabin", 5i64, 1024i64),
        ("b.png", "forest blurry", 3, 512),
        ("c.png", "mountain peak", 4, 2048),
    ] {
        let img = gim_core::db::images::NewImage {
            directory_id: 1,
            path: format!("/d/{name}"),
            filename: name.to_string(),
            size: 1,
            mtime: 1,
            created_at: Some(1000),
            modified_at: Some(1000),
            width,
            height: 100,
            rating: Some(rating),
            format: "png".to_string(),
            positive: Some(positive.to_string()),
            raw_parameters: Some(positive.to_string()),
            source_tool: "a1111".to_string(),
            ..Default::default()
        };
        gim_core::db::images::upsert(&conn, &img).unwrap();
    }
    drop(conn);

    (AppState::new(data_dir), tmp)
}

/// ルータへ GET し、200 を確認して JSON を返す。
pub async fn get_json(state: AppState, uri: &str) -> serde_json::Value {
    let res = routes::router(state)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "GET {uri} が 200 を返さなかった");
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// ルータへ GET し、ステータスとレスポンスをそのまま返す。
pub async fn get_raw(state: AppState, uri: &str) -> axum::response::Response {
    routes::router(state)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap()
}
