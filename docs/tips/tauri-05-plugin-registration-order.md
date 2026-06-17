# Tauri: プラグイン登録タイミングの落とし穴

## 問題

`tauri_plugin_window_state` のような「ウィンドウ生成時フック（`on_window_ready`）」を持つプラグインを `setup` クロージャ内で登録すると動作しない。

```rust
// 悪い例: setup 内で登録すると on_window_ready が間に合わない
.setup(|app| {
    app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;
    // ↑ ここより前にメインウィンドウが生成されているので
    //   on_window_ready を取りこぼす
    Ok(())
})
```

`tauri.conf.json` で定義されたウィンドウは `setup` クロージャより**前**に生成される。そのため `setup` 内でプラグインを登録しても `on_window_ready` コールバックが呼ばれない。

## 解決策

**`Builder` チェーンで `.plugin(...)` を呼ぶ**。

```rust
// 正しい例
tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
        // ここでは setup 固有の初期化のみ
        Ok(())
    })
    .run(tauri::generate_context!())
```

## ポイント

- 初期ウィンドウの生成イベントに依存するプラグインは必ず Builder チェーンに置く
- `setup` 内の `app.handle().plugin()` はランタイム後付けプラグイン登録には使えるが、初期ウィンドウには間に合わない
- プラグインの `with_denylist` でスライドショーウィンドウ等を除外できる

## 参照

`src-tauri/src/lib.rs`
