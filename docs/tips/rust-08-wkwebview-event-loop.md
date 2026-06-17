# Tauri/macOS: WKWebView のイベントループとタイマー

## 症状

スライドショーの自動送りが、スライドが切り替わる瞬間だけ UI が反応し、それ以外のフレームはスクロールやクリックなど操作に全く反応しない。

## 原因

WKWebView は macOS 上で `CADisplayLink` 相当の vsync に同期したレンダリングループを持つが、JavaScript の `setInterval` / `setTimeout` はネイティブの run loop に統合されていない。長時間の `setInterval` タイマーが run loop をブロックしているとき、インタラクション（マウス・キー）が処理されない。

## 試みた対策（効果なし）

以下のアプローチは **実機で効果がなかった**ため再提案しない。

- ハートビートタイマー（定期的な DOM 書き込みで run loop を起こす試み）
- `flushSync` の定期呼び出し

## 現行の解決策

`requestAnimationFrame` 駆動のタイマー（`useSlideTimer` フック）でインターバルを自走させる。`rAF` は vsync に同期して呼ばれるため WKWebView のレンダリングループと自然に統合され、スライド以外のフレームでも UI が応答する。

```ts
// useSlideTimer フック（概略）
function useSlideTimer(interval: number, onTick: () => void) {
  useEffect(() => {
    let rafId: number;
    let last = performance.now();

    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        onTick();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [interval, onTick]);
}
```

## ポイント

- WKWebView（Tauri の macOS バックエンド）は Electron と異なりネイティブ run loop との統合が強い
- `setInterval` は WKWebView の run loop から「外れる」ことがある（UI が詰まる根本原因）
- `rAF` ベースのタイマーは描画と同期するため「keep-alive な描画」も兼ねる

## 参照

`src/components/SlideshowApp.tsx`, メモリファイル `wkwebview-event-loop-heartbeat.md`
