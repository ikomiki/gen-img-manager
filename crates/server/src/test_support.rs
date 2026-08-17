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

/// `test_state` に加えて、id 1 の画像だけ実ファイル（PNG）とサムネイル（WebP）を
/// ディスクに作り、DB のパスをそこへ向ける。id 2・3 の実体は作らない。
pub fn test_state_with_files() -> (AppState, tempfile::TempDir) {
    let (state, tmp) = test_state();
    let data_dir = tmp.path().to_path_buf();

    let img_path = data_dir.join("a.png");
    let thumb_path = data_dir.join("thumbnails").join("a.webp");
    write_png(&img_path, 64, 48);
    // WebP としての妥当性はこのテストの関心事ではないので、バイト列は何でもよい。
    std::fs::write(&thumb_path, b"fake-webp").unwrap();

    let conn = rusqlite::Connection::open(data_dir.join("library.db")).unwrap();
    conn.execute(
        "UPDATE images SET path = ?1, thumb_path = ?2 WHERE filename = 'a.png'",
        rusqlite::params![img_path.to_string_lossy(), thumb_path.to_string_lossy()],
    )
    .unwrap();
    drop(conn);

    (state, tmp)
}

/// `test_state_with_files` と同じだが、id 1 の画像を 3000px 幅にする。
pub fn test_state_with_wide_image() -> (AppState, tempfile::TempDir) {
    let (state, tmp) = test_state_with_files();
    let conn = rusqlite::Connection::open(tmp.path().join("library.db")).unwrap();
    let path: String = conn
        .query_row(
            "SELECT path FROM images WHERE filename = 'a.png'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    drop(conn);
    write_png(std::path::Path::new(&path), 3000, 1000);
    (state, tmp)
}

/// テスト用の最小 PNG を書き出す。
pub fn write_png(path: &std::path::Path, w: u32, h: u32) {
    let buf = image::RgbImage::from_pixel(w, h, image::Rgb([120, 160, 200]));
    buf.save_with_format(path, image::ImageFormat::Png).unwrap();
}

/// メソッドを指定してリクエストする。
pub async fn request_raw(state: AppState, method: &str, uri: &str) -> axum::response::Response {
    routes::router(state)
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

/// ヘッダ付きで GET する。
pub async fn get_raw_with_headers(
    state: AppState,
    uri: &str,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let mut req = Request::get(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    routes::router(state)
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}
