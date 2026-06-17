# TypeScript: フロント/バックエンドのクエリトークナイザ同期

## 問題

検索クエリをフロントで編集（フィールド値の upsert 等）してからバックエンドに送るとき、フロントのトークナイザがバックエンドと仕様が異なると、フロントが組み立てた文字列をバックエンドが正しく解析できない。

## 解決策

フロント（`src/util/queryTokens.ts`）とバックエンド（`src-tauri/src/query/parse.rs`）に**同一仕様のトークナイザ**を実装する。

主要な仕様：
- 空白区切り。ダブルクォートで囲んだ部分は 1 トークン（クォートを外す）
- `field:(...)` の括弧は対応する `)` まで空白を含めて 1 トークンに取り込む
- クォート前の「素のリード部（lead）」のコロンでフィールドを判定する
  - `"foo:bar"` はクォート内なのでフィールドではなく裸のフレーズ
- 先頭 `-` は除外マーカー（lead を使って判定し、クォート句には付かない）

```ts
// src/util/queryTokens.ts
export interface RawToken {
  text: string;    // クォートを外した本文
  quoted: boolean;
  lead: string;    // クォート前の素のリード（フィールド判定に使う）
  negate: boolean; // 先頭 - の除外トークンか
}
```

## `upsertField` パターン

```ts
// field:value を安全に置換（他トークンを保持）
export function upsertField(query: string, field: string, value: string | null): string {
  const kept: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    const isManaged = !t.negate && colon >= 0 && t.lead.slice(0, colon) === field;
    if (isManaged) continue;  // 古い値を除去
    kept.push(serializeToken(t));
  }
  if (value != null && value !== "") {
    kept.push(serializeField(field, value));  // 末尾に新しい値を追加
  }
  return kept.join(" ").trim();
}
```

## ポイント

- 同仕様を両言語で維持するコストは高いが、フロントでの編集→バックエンドでの解析を安全にするには避けられない
- テストで仕様の逸脱を検知する（`src/util/queryTokens.test.ts`）
- `serializeToken` で `RawToken` → 文字列の往復（ラウンドトリップ）を保証する

## 参照

`src/util/queryTokens.ts`, `src/util/promptQuery.ts`, `src-tauri/src/query/parse.rs`
