# TypeScript: IME 変換確定 Enter の除外

## 問題

日本語 IME での変換確定（Enter キー）とフォーム送信の Enter を区別しないと、変換を確定しただけでダイアログが適用されてしまう。

## 解決策

`isComposing` と `keyCode === 229` の **両方を確認**する。

```ts
// src/util/dialogKeys.ts
export interface ApplyEnterInput {
  key: string;
  isComposing: boolean;
  keyCode: number;
  tagName: string;
  inputType: string;
}

export function isApplyEnter(e: ApplyEnterInput): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;  // IME 確定を除外
  if (e.tagName !== "INPUT") return false;
  return e.inputType === "text" || e.inputType === "number";
}
```

## ポイント

- `isComposing` は標準だが古い Android WebView では機能しないことがある
- `keyCode === 229` は IME 処理中に発火するイベントのコードで補完として機能する
- `tagName` チェック（`select`・`button` 等の Enter はネイティブ挙動を維持）と `inputType` チェック（`checkbox` 等を除外）を組み合わせることで誤発火を防ぐ
- フォーム内の **すべての input 種別を適用対象にしない**（`text` と `number` のみ）

## Tauri (WKWebView) での注意

WKWebView（macOS の WebView エンジン）では `isComposing` が特定の条件下で遅れて `false` になることがある。`keyCode 229` の二重チェックが安全側に倒す保険となる。

## 参照

`src/util/dialogKeys.ts`, `src/util/dialogKeys.test.ts`
