# TypeScript: キーボードショートカットの修飾キー完全一致判定

## 問題

`Cmd+A`（全選択）の判定を「`metaKey` を含む」程度の緩い条件で書くと、`Cmd+Shift+A`（分析メニュー等）でも発火し `preventDefault()` でネイティブメニューのアクセラレータを奪ってしまう。

```ts
// 悪い例: Cmd+Shift+A も巻き込む
if (e.metaKey && e.key === "a") {
  e.preventDefault();
  selectAll();
}
```

## 解決策

修飾キーは **使うものを true、使わないものを false で明示的にチェック**する。

```ts
// src/util/platform.ts
export function isSelectAllKey(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "key">,
): boolean {
  return (
    hasPrimaryModifier(e) &&
    !e.shiftKey &&  // Shift 不使用を明示
    !e.altKey &&    // Alt 不使用を明示
    (e.key === "a" || e.key === "A")
  );
}
```

## ポイント

- 修飾キー判定ロジックは純粋関数（`src/util/platform.ts`）に切り出してテストする
- `hasPrimaryModifier` は `metaKey || ctrlKey` の抽象化（macOS/Windows 両対応）
- macOS の Option+Command+F（フルスクリーン）は `e.key` が特殊文字になるため `e.code` で判定する

```ts
export function isFullscreenToggleKey(
  e: Pick<KeyboardEvent, "altKey" | "metaKey" | "code" | "key">,
): boolean {
  if (isMac()) {
    return e.altKey && e.metaKey && e.code === "KeyF"; // e.key は "ƒ" 等になる
  }
  return e.key === "F11";
}
```

## 参照

`src/util/platform.ts`, `src/util/platform.test.ts`
