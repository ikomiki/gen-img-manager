# Rust: FTS5 クエリの構文検証とグレースフルデグラデーション

## 問題

FTS5 の MATCH 式に不正な構文（演算子の位置ズレ、未閉じ括弧等）が渡ると `rusqlite` がエラーを返し、検索結果が空になる。

## 解決策: バリデーション + フレーズ化フォールバック

ユーザ入力から FTS 式を組み立てる前に**構文を検証**し、不正なら 1 フレーズとして無害化する。

### 括弧バランスチェック

```rust
fn parens_balanced(s: &str) -> bool {
    let mut depth: i32 = 0;
    let mut in_quote = false;
    for c in s.chars() {
        match c {
            '"' => in_quote = !in_quote,
            '(' if !in_quote => depth += 1,
            ')' if !in_quote => {
                depth -= 1;
                if depth < 0 { return false; }
            }
            _ => {}
        }
    }
    depth == 0
}
```

### トークン列の構文チェック

```rust
fn fts_expr_valid(tokens: &[String]) -> bool {
    let is_op = |t: &str| t == "AND" || t == "OR";
    let is_term_end   = |t: &str| !is_op(t) && t != "(";
    let is_term_start = |t: &str| !is_op(t) && t != ")";

    for (i, t) in tokens.iter().enumerate() {
        if is_op(t) {
            let prev_ok = i > 0 && is_term_end(&tokens[i - 1]);
            let next_ok = tokens.get(i + 1).map(|n| is_term_start(n)).unwrap_or(false);
            if !prev_ok || !next_ok { return false; }
        }
    }
    // 空括弧ペア
    for i in 0..tokens.len() {
        if tokens[i] == "(" && tokens.get(i + 1).map(|s| s.as_str()) == Some(")") {
            return false;
        }
    }
    // 項が最低1つ必要
    tokens.iter().any(|t| !is_op(t) && t != "(" && t != ")")
}
```

### フォールバック実装

```rust
fn field_expr_to_fts(value: &str) -> String {
    if !parens_balanced(value) {
        return fts_quote(value);  // 未閉じ → 1フレーズ化
    }
    // ... トークン化と変換 ...
    if !fts_expr_valid(&out) {
        return fts_quote(value);  // 不正演算子配置 → 1フレーズ化
    }
    out.join(" ")
}
```

## 変換例

| 入力 | 出力 |
|------|------|
| `(forest AND cabin)` | `( "forest" AND "cabin" )` |
| `(forest AND)` | `"(forest AND)"` ← フォールバック |
| `(AND forest)` | `"(AND forest)"` ← フォールバック |
| `(unclosed` | `"(unclosed"` ← フォールバック |

## ポイント

- FTS5 の演算子は**大文字のみ**（`AND` は演算子、`and` は検索語として `"and"` にクォートされる）
- フォールバックにより「エラーで結果が出ない」ではなく「1 フレーズとして検索できる」体験を維持できる
- バリデーション関数は `field_expr_to_fts` 内部で使うだけでなく独立してテストする

## 参照

`src-tauri/src/query/parse.rs`（`parens_balanced`, `fts_expr_valid`, `field_expr_to_fts`）
