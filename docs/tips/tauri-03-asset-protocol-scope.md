# Tauri: asset protocol でローカルファイルを表示する

## 概要

Tauri の webview では `file://` URL は使えない。ローカル画像を表示するには **asset protocol** を使い、アクセスを許可するディレクトリを明示的に登録する。

## フロント側

```ts
import { convertFileSrc } from "@tauri-apps/api/core";

// path は絶対パス（例 /Users/foo/images/a.png）
const src = convertFileSrc(path);
// → "asset://localhost/Users/foo/images/a.png" 等
```

## Rust 側: setup でディレクトリを許可

```rust
// src-tauri/src/lib.rs
app.setup(|app| {
    // サムネイルディレクトリ
    let thumb_dir = dir.join("thumbnails");
    app.asset_protocol_scope().allow_directory(&thumb_dir, true)?;

    // 登録済みの画像ディレクトリ
    let dirs = db::directories::list(&conn)?;
    for d in dirs {
        app.asset_protocol_scope()
           .allow_directory(std::path::Path::new(&d.path), d.recursive)?;
    }
    Ok(())
})
```

## 動的追加時

ディレクトリをアプリ実行中に追加したときは、コマンド内でも同様に許可が必要。

```rust
// add_directory コマンド内
app.asset_protocol_scope().allow_directory(&path, recursive)?;
```

## ポイント

- `allow_directory` の第 2 引数 `recursive = true` でサブディレクトリも許可
- 許可漏れは画像が表示されない（ブラウザコンソールにエラーは出ない場合もある）
- サムネイルは固定ディレクトリなので setup で一度だけ許可すれば足りる

## 参照

`src-tauri/src/lib.rs`, `src/components/ImageGridPanel.tsx`（`convertFileSrc` の使用箇所）
