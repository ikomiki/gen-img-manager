# Rust: 2段階クエリコンパイル（パース → SQL WHERE）

## 概要

ユーザのクエリ文字列を直接 SQL に埋め込まず、**中間表現（`ParsedQuery`）** を経由することでテスト・拡張・セキュリティ管理を分離する。

```
ユーザ入力文字列
  → parse()    → ParsedQuery { fts_include, fts_exclude, conds: Vec<Cond> }
  → compile()  → CompiledFilter { where_sql: String, params: Vec<Value> }
  → rusqlite で実行
```

## ParsedQuery の構造

```rust
pub struct ParsedQuery {
    pub fts_include: Option<String>,     // FTS5 MATCH 式（包含）
    pub fts_exclude: Option<String>,     // FTS5 MATCH 式（除外）
    pub conds: Vec<Cond>,                // 構造化条件（rating/width/created 等）
}

pub struct Cond {
    pub column: &'static str,            // 許可リストの列名
    pub op: CondOp,
    pub negate: bool,
}

pub enum CondOp {
    Like(String),
    Ge(i64), Le(i64), Gt(i64), Lt(i64), Eq(i64),
    Range(i64, i64),
    InSet { values: Vec<i64>, include_null: bool },
}
```

## コンパイル出力

```rust
// 空クエリ
"missing = 0"

// フルクエリ例
"missing = 0
 AND id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)
 AND id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)
 AND rating >= ?"
// params: ["\"forest\"", "\"blurry\"", 4]
```

## 日付処理

`created:2025-01-01` を UNIX epoch 秒のレンジに変換してから SQL に渡す。タイムゾーンはローカル。

```rust
fn date_to_epoch(s: &str, end_of_day: bool) -> Option<i64> {
    let date = NaiveDate::from_ymd_opt(y, m, d)?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)?
    } else {
        date.and_hms_opt(0, 0, 0)?
    };
    Local.from_local_datetime(&naive).earliest().map(|dt| dt.timestamp())
}
```

`created:2025-01-01` → `Range(epoch_start, epoch_end_of_day)`

## NULL 集合

`rating:none,1,3` → `InSet { values: [1,3], include_null: true }` → `(rating IS NULL OR rating IN (?, ?))`

## ポイント

- `parse` と `compile` を分離することで、`parse` の単体テストで SQL を書かずに済む
- `CompiledFilter` を返す設計にするとテストで `where_sql` と `params` を直接 assert できる
- `Cond.column` が `&'static str` であることがインジェクション対策の型保証になる

## 参照

`src-tauri/src/query/mod.rs`, `src-tauri/src/query/parse.rs`, `src-tauri/src/query/compile.rs`
