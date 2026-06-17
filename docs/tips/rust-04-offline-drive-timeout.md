# Rust: 切断ネットワークドライブで `exists()` がハングする問題

## 問題

切断された NFS/SMB ドライブのパスに対して `Path::exists()` を呼ぶと、OS のタイムアウトまで（数十秒〜数分）スレッドがブロックする。UI スレッドやロック内で呼ぶと**アプリが固まる**。

## 解決策: 別スレッド + タイムアウト

```rust
// src-tauri/src/fs_guard.rs

pub fn is_reachable(path: &Path, timeout: Duration) -> bool {
    let p = path.to_path_buf();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(p.exists());  // ブロックしてもよい別スレッド
    });
    matches!(rx.recv_timeout(timeout), Ok(true))
}
```

`recv_timeout` が期限内に `Ok(true)` を受け取れなければ `false`（到達不可）とみなす。

## 意図的なスレッドリーク

タイムアウト後、`p.exists()` でブロック中のスレッドは **join されずにリークする**。これは意図的な設計。

- 切断ドライブに対する `exists()` は永久ブロックになりうる
- join を試みると呼び出し元もブロックしてしまう
- スキャンは手動＋起動時差分の低頻度トリガなので、リークの累積は実用上問題にならない

## 使用箇所

```rust
// scanner.rs（スキャン前の到達性チェック）
if !fs_guard::is_reachable(&path, Duration::from_secs(2)) {
    return Err("ディレクトリに到達できません".into());
}
```

## ポイント

- タイムアウト値はユーザ体験に直結する。ローカルドライブは数 ms で応答するため、2 秒は十分な猶予
- `mpsc::channel` + `recv_timeout` パターンはスレッドを「切り離せる非同期」として機能させる最小実装
- `async-std` / `tokio` を導入する代わりに標準ライブラリだけで実装できる

## 参照

`src-tauri/src/fs_guard.rs`
