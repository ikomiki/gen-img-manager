# Tauri: HiDPI / 混在 DPI 環境でのウィンドウ位置・サイズ保存

## 問題

`tauri-plugin-window-state` は位置・サイズを**物理ピクセル**で保存・復元する。macOS の HiDPI（Retina）ディスプレイや、スケールが異なる複数モニタ環境（混在 DPI）では：

- 物理⇔論理変換のスケール係数が一貫しないため、復元後にサイズが**約 2 倍**に拡大する
- 位置が左右にずれる

## 解決策

**プラグインの POSITION/SIZE フラグを外し、論理ポイントで自前管理する。**

```rust
// lib.rs - プラグインには MAXIMIZED/FULLSCREEN だけ任せる
builder = builder.plugin(
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(
            StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
            // POSITION と SIZE は自前管理するため除外
        )
        .with_denylist(&["slideshow"])
        .build(),
);
```

保存: `inner_size()` / `outer_position()` を `to_logical(scale)` で論理ポイントへ変換してから SQLite へ。

```rust
let scale = window.scale_factor().unwrap_or(1.0);
let size = window.inner_size()?.to_logical::<u32>(scale);
let pos  = window.outer_position()?.to_logical::<i32>(scale);
```

復元: `set_size` / `set_position` は必ず `LogicalSize` / `LogicalPosition` を使う。

```rust
win.set_size(tauri::LogicalSize::new(w, h))?;
win.set_position(tauri::LogicalPosition::new(x, y))?;
```

## 切断モニタ対策

保存した位置がモニタ外にならないよう、復元前に「いずれかのモニタと重なるか」を確認する。

```rust
fn window_rect_visible(win: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> bool {
    let monitors = win.available_monitors().unwrap_or_default();
    // 各モニタを論理ポイントに変換してから重なり判定
    for m in monitors {
        let s = m.scale_factor();
        let mp = m.position().to_logical::<f64>(s);
        let ms = m.size().to_logical::<f64>(s);
        if wx < mp.x + ms.width && wx + ww > mp.x && ... {
            return true;
        }
    }
    false
}
```

## スロットル

Resized/Moved イベントは高頻度で発火するため、250ms のスロットルをかけて SQLite の fsync 頻度を抑える。

```rust
// 250ms 未満なら保存をスキップ
if now.duration_since(prev) < Duration::from_millis(250) {
    return;
}
```

## ポイント

- 最大化/フルスクリーン中は通常のサイズを書かない（復元時に通常サイズが汚れる）
- プラグイン登録は `Builder` チェーンで行う（`setup` クロージャ内の `handle.plugin()` では `on_window_ready` の取りこぼしが起きる）

## 参照

`src-tauri/src/lib.rs`（`persist_window_geometry`, `restore_window_geometry`, `window_rect_visible`）
