# Rust/SQLite: SQLインジェクション対策

## 問題

ユーザ入力をそのまま SQL 文字列に埋め込むと SQL インジェクションが発生する。特に動的な列名はプレースホルダ（`?`）で代替できないため対策が必要。

## 解決策: 列名は許可リストのみ

列名は文字列変数ではなく **`&'static str`（コンパイル時の許可リスト）** からのみ選択する。

```rust
// src-tauri/src/query/compile.rs
fn struct_field(field: &str) -> Option<(&'static str, FieldKind)> {
    match field {
        "rating"  => Some(("rating",      FieldKind::Num { is_date: false })),
        "width"   => Some(("width",       FieldKind::Num { is_date: false })),
        "created" => Some(("created_at",  FieldKind::Num { is_date: true  })),
        // 未知フィールドは None → トークンを無視
        _ => None,
    }
}
```

FTS の列名も同様。

```rust
fn text_field_column(field: &str) -> Option<&'static str> {
    match field {
        "prompt"   => Some("positive"),
        "negative" => Some("negative"),
        _ => None,
    }
}
```

## 値は必ずバインドパラメータ

```rust
// 悪い例（インジェクション可能）
format!("WHERE rating = {user_input}")

// 良い例
clauses.push("rating >= ?".to_string());
params.push(Value::Integer(n));
```

LIKE のワイルドカードも必ずエスケープ。

```rust
let escaped = v.replace('\\', "\\\\")
               .replace('%', "\\%")
               .replace('_', "\\_");
format!("{col} LIKE ? ESCAPE '\\'"),
vec![Value::Text(format!("%{escaped}%"))],
```

## FTS5 MATCH 文字列

FTS の MATCH 式はプレースホルダ全体として渡せる（`?` で OK）が、中に含まれる検索語はさらに `"..."` でクォートする。

```rust
fn fts_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))  // " → "" でエスケープ
}
```

## ポイント

- `&'static str` 型の列名はリテラル由来であることがコンパイル時に保証される
- ユーザ入力から列名を作らない（プレースホルダは列名に使えないが、`match` ガードが代替する）
- LIKE のエスケープを忘れると `_` や `%` を含むサンプラー名で意図しない広範一致が起きる

## 参照

`src-tauri/src/query/parse.rs`, `src-tauri/src/query/compile.rs`
