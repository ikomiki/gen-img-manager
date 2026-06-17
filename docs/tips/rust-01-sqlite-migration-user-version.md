# Rust/SQLite: PRAGMA user_version を使ったマイグレーション管理

## パターン

`PRAGMA user_version` をスキーマバージョンとして使い、`&[&str]` 配列の `index + 1` をバージョン番号に対応させる。

```rust
// src-tauri/src/db/migrations.rs
const MIGRATIONS: &[&str] = &[
    // v1
    "CREATE TABLE directories (...);",
    // v2
    "CREATE TABLE images (...); CREATE VIRTUAL TABLE images_fts ...",
    // v3 - テーブル追加
    "CREATE TABLE filter_history ...; CREATE TABLE settings ...;",
    // v4 - 列追加
    "ALTER TABLE directories ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;",
];

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            let stmt = sql.trim().trim_end_matches(';');
            conn.execute_batch(&format!(
                "BEGIN; {stmt}; PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}
```

## 重要な制約

- **追記のみ**。既存エントリの並び替えや変更は禁止（インデックスがバージョンを直接決めるため）
- 1 エントリに複数の SQL 文を入れて OK（セミコロン区切り）
- `execute_batch` はセミコロン末尾の有無に依存するため、`trim_end_matches(';')` で正規化してから `BEGIN; ...; PRAGMA user_version = N; COMMIT;` で囲む
- `PRAGMA user_version = N` は `execute_batch` 内に書けば同一トランザクションで確定する

## 冪等性

`version > current` の条件で適用済みのマイグレーションをスキップするため、`run()` を複数回呼んでも安全。

## テスト例

```rust
#[test]
fn run_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    run(&conn).unwrap();  // 2回目は何もしない
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, MIGRATIONS.len() as i64);
}
```

## 参照

`src-tauri/src/db/migrations.rs`
