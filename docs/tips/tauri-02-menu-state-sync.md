# Tauri: ネイティブメニューのチェック状態をフロントから同期する

## 問題

Tauri のネイティブメニュー（チェック付きメニュー項目）の状態は Rust 側で管理する。フロントで状態が変化したとき、メニューのチェックを同期する方法が必要。

## パターン: フロントが正、Rust は従う

```
フロントの状態変更
  → sync_xxx_menu コマンドを invoke
  → Rust の ViewMenu 構造体がメニューを更新
```

逆方向（メニュー操作 → フロント）は：

```
ユーザがメニューをクリック
  → Rust: app.emit("menu-action", event.id)
  → フロント: listen("menu-action") でアクションを振り分け
```

## 実装例

```rust
// src-tauri/src/commands/view_menu.rs
#[tauri::command]
pub fn sync_zoom_menu(menu: State<ViewMenu>, mode: String) {
    menu.sync_zoom(&mode);
}
```

```ts
// フロント: ズームモード変更後にメニュー同期
const setZoomMode = (mode) => {
  set({ zoomMode: mode });
  syncZoomMenu(mode).catch(console.error);
};
```

## メニューアクションのディスパッチ

```ts
// src/App.tsx
useEffect(() => {
  const un = listen<string>("menu-action", (e) => {
    const id = e.payload;
    if (id === "toggle_filename") void toggleShowFilename();
    else if (id === "rating_mode") void toggleRatingMode();
    // ...
  });
  return () => { void un.then(f => f()); };
}, []);
```

## ポイント

- **状態の正はフロント側**。Rust はメニューのビジュアルを反映するだけ
- `on_menu_event` は `tauri::Builder` に登録し、すべてのメニューイベントを単一の `"menu-action"` イベントとしてフロントに伝える（ ID で振り分け）
- `sync_*` コマンド群は機能ごとに 1 つずつ用意し、`invoke_handler!` に登録し忘れないよう注意

## 参照

`src-tauri/src/commands/view_menu.rs`, `src-tauri/src/menu.rs`, `src/App.tsx`
