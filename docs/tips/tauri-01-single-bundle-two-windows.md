# Tauri: 単一バンドルで 2 ウィンドウを出し分ける

## パターン

`index.html` の単一バンドルから `window.location.hash` でマウントするコンポーネントを切り替える。

```tsx
// src/main.tsx
const isSlideshow = window.location.hash.replace(/^#/, "") === "slideshow";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSlideshow ? <SlideshowApp /> : <App />}
  </React.StrictMode>,
);
```

Rust 側で別ウィンドウを生成するとき `index.html#slideshow` を URL に指定する。

```rust
// src-tauri/src/commands/slideshow.rs
WebviewWindowBuilder::new(
    &app,
    "slideshow",
    WebviewUrl::App("index.html#slideshow".into()),  // ← hash で出し分け
)
.title("スライドショー")
.inner_size(1000.0, 700.0)
.build()?;
```

## ウィンドウ間データ受け渡し

Tauri の管理状態（`app.manage`）をスナップショットバッファとして使う。

```rust
pub struct SlideshowState(pub Mutex<Option<SlideshowPayload>>);

// メインウィンドウが start_slideshow を呼ぶとき
pub fn start_slideshow(app: AppHandle, state: State<SlideshowState>, ...) {
    *state.0.lock().unwrap() = Some(payload);  // 先に保存
    // ウィンドウ生成（または前面化）
}

// スライドショーウィンドウがマウント時に取得
pub fn get_slideshow_payload(state: State<SlideshowState>) -> Option<SlideshowPayload> {
    state.0.lock().unwrap().clone()
}
```

## ケイパビリティ分離

`src-tauri/capabilities/` にウィンドウごとの JSON を置く。

- `default.json` → メインウィンドウ
- `slideshow.json` → スライドショー専用（フルスクリーン許可等）

## ポイント

- ウィンドウが既存かどうかは `app.get_webview_window("label")` で確認し、あれば `set_focus()` するだけで重複生成を防ぐ
- ロジックをコマンド関数から分離した純粋関数（`set_payload` / `get_payload`）にするとテストが容易

## 参照

`src/main.tsx`, `src-tauri/src/commands/slideshow.rs`, `src-tauri/capabilities/`
