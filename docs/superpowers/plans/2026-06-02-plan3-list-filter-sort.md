# 計画3：一覧UI + フィルタ + ソート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B案クエリ構文（裸の語＝全文・`field:`・範囲・`OR`・`-除外`・`"句"`）をパースしてSQLite+FTS5クエリにコンパイルし、フィルタ済み画像をソート可能なレスポンシブ正方形サムネイル仮想グリッドで表示する。詳細条件ダイアログ・クエリヒストリ・ファイル名表示トグルを備える。

**Architecture:** Rust側に `query` モジュール（純粋な parser→compiler）を置き、`db::image_query` がそれを使って `images`/`images_fts` を引く。正テキストは `id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)`、除外は `id NOT IN (...)` に分離してFTS5を活用。サムネは Tauri asset protocol＋`convertFileSrc` で表示。フロントは Zustand の query ストア＋TanStack Virtual のグリッド。

**Tech Stack:** Rust / rusqlite(FTS5) / Tauri v2 (asset protocol, commands) / React + TypeScript / Zustand / @tanstack/react-virtual

---

## 前提（実行前に確認）

- 計画1・2完了済み（`main` にマージ）。既存:
  - DB: `directories`/`images`/`images_fts`（external-content＋同期トリガ）、`db/migrations.rs`（`MIGRATIONS` 配列・`PRAGMA user_version`、現在 v2 まで）、`db/images.rs`（`NewImage`/`upsert`/`count_in_directory` 等）、`db/directories.rs`。
  - `db::Db(pub Arc<Mutex<Connection>>)`、`db::open(&Path)`。
  - コマンド登録は `src-tauri/src/lib.rs` の `invoke_handler!`（directories 3＋scan 5）。`setup` で `app_data_dir()/library.db` を開き manage。`tauri_plugin_dialog` 使用。
  - フロント: `src/types.ts`（Directory/ScanProgress/ScanDone）、`src/store/useLibraryStore.ts`、`src/components/{DirectoryPanel,FilterBar,ImageGridPanel}.tsx`（FilterBar/ImageGridPanel はプレースホルダ）、`src/App.tsx`（3ペイン）。Vitest 設定済み。
- `images` の主な列: id, directory_id, path, filename, size, mtime, created_at, modified_at, width, height, pixels, rating, format, thumb_path, raw_parameters, positive, negative, model, sampler, steps, seed, cfg, source_tool, comfy_workflow, missing。
- `images_fts` の列: raw_parameters, positive, negative, model, filename（external-content, content_rowid=id）。
- 作業ディレクトリ: `/Users/ikomiki/workspace/gen-img-manager`。新ブランチ（例 `feature/plan3-list`）で実装（main直接実装禁止）。

## ファイル構成（このプランで作成/変更）

```
src-tauri/src/
  db/
    migrations.rs        # 変更: v3（filter_history, settings）追記
    history.rs           # 作成: filter_history DB層
    settings.rs          # 作成: settings DB層
    image_query.rs       # 作成: ImageRow, query_images, count_query
    mod.rs               # 変更: pub mod history; pub mod settings; pub mod image_query;
  query/
    mod.rs               # 作成: ParsedQuery/Cond/CondOp/SortKey/SortDir + pub mod
    parse.rs             # 作成: parse(&str)->ParsedQuery（純粋）
    compile.rs           # 作成: compile(&ParsedQuery)->CompiledFilter（純粋）
  commands/
    mod.rs               # 変更: pub mod query; pub mod prefs;
    query.rs             # 作成: query_images / count_query コマンド
    prefs.rs             # 作成: history / settings コマンド
  lib.rs                 # 変更: query モジュール宣言、コマンド登録、asset protocol scope
  tauri.conf.json        # 変更: assetProtocol 有効化
src/
  types.ts               # 変更: ImageRow/SortKey/SortDir 型追加
  api/images.ts          # 作成: queryImages/countQuery ラッパ
  api/prefs.ts           # 作成: history/settings ラッパ
  store/useQueryStore.ts # 作成: クエリ/ソート/結果/ヒストリ/設定の Zustand ストア
  store/useQueryStore.test.ts # 作成: ストアのテスト
  components/FilterBar.tsx     # 変更: テキスト欄・ヒストリ・ソート・詳細ボタン
  components/FilterDialog.tsx  # 作成: 詳細条件ダイアログ
  components/ImageGridPanel.tsx # 変更: 仮想レスポンシブ正方形グリッド
  App.tsx                # 変更: 起動時にクエリ実行・ストア接続
  App.css                # 変更: グリッド/ツールバー/ダイアログのスタイル
```

---

## Task 1: マイグレーション v3（filter_history / settings）

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`（`MIGRATIONS` に1要素追記＋テスト）

- [ ] **Step 1: v3を追記し失敗するテストを書く**

`src-tauri/src/db/migrations.rs` の `MIGRATIONS` 配列に **3番目の要素** として追加（既存 v1/v2 は変更しない）:
```rust
    // v3: filter_history, settings
    "CREATE TABLE filter_history (
        id INTEGER PRIMARY KEY,
        query_text TEXT NOT NULL UNIQUE,
        used_at INTEGER NOT NULL
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
```
`#[cfg(test)] mod tests` に追加:
```rust
    #[test]
    fn v3_creates_history_and_settings_and_version_is_3() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);
        for name in ["filter_history", "settings"] {
            let c: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [name], |r| r.get(0))
                .unwrap();
            assert_eq!(c, 1, "missing table: {name}");
        }
    }
```

- [ ] **Step 2: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test migrations` → 既存＋新規が PASS（v3で1件追加）。

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): add filter_history and settings tables (migration v3)"
```

---

## Task 2: history / settings DB層

**Files:**
- Create: `src-tauri/src/db/history.rs`
- Create: `src-tauri/src/db/settings.rs`
- Modify: `src-tauri/src/db/mod.rs`（`pub mod history; pub mod settings;`）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/db/mod.rs` に追記:
```rust
pub mod history;
pub mod settings;
```

- [ ] **Step 2: history.rs を作成（テスト付き）**

`src-tauri/src/db/history.rs`:
```rust
use rusqlite::{params, Connection};

const MAX_HISTORY: i64 = 20;

/// クエリ文字列をヒストリへ記録する。空文字は無視。
/// 既存の同一文字列は used_at を更新して先頭へ昇格。直近 MAX_HISTORY 件のみ保持。
pub fn record(conn: &Connection, query_text: &str, now: i64) -> rusqlite::Result<()> {
    let trimmed = query_text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO filter_history (query_text, used_at) VALUES (?1, ?2)
         ON CONFLICT(query_text) DO UPDATE SET used_at = excluded.used_at",
        params![trimmed, now],
    )?;
    conn.execute(
        "DELETE FROM filter_history
         WHERE id NOT IN (SELECT id FROM filter_history ORDER BY used_at DESC, id DESC LIMIT ?1)",
        params![MAX_HISTORY],
    )?;
    Ok(())
}

/// 直近のクエリ文字列を新しい順で返す。
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT query_text FROM filter_history ORDER BY used_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![MAX_HISTORY], |r| r.get::<_, String>(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        c
    }

    #[test]
    fn records_and_lists_newest_first() {
        let c = conn();
        record(&c, "a", 100).unwrap();
        record(&c, "b", 200).unwrap();
        assert_eq!(list(&c).unwrap(), vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn duplicate_promotes_to_top() {
        let c = conn();
        record(&c, "a", 100).unwrap();
        record(&c, "b", 200).unwrap();
        record(&c, "a", 300).unwrap(); // a を再実行
        assert_eq!(list(&c).unwrap(), vec!["a".to_string(), "b".to_string()]);
        let count: i64 = c.query_row("SELECT count(*) FROM filter_history", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn empty_query_is_ignored() {
        let c = conn();
        record(&c, "   ", 100).unwrap();
        assert!(list(&c).unwrap().is_empty());
    }

    #[test]
    fn keeps_only_last_20() {
        let c = conn();
        for i in 0..25 {
            record(&c, &format!("q{i}"), i).unwrap();
        }
        let all = list(&c).unwrap();
        assert_eq!(all.len(), 20);
        assert_eq!(all[0], "q24");
        assert!(!all.contains(&"q4".to_string()));
    }
}
```

- [ ] **Step 3: settings.rs を作成（テスト付き）**

`src-tauri/src/db/settings.rs`:
```rust
use rusqlite::{params, Connection};

/// 設定値を取得する。無ければ None。
pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

/// 設定値を保存する（UPSERT）。
pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        c
    }

    #[test]
    fn get_missing_is_none() {
        let c = conn();
        assert_eq!(get(&c, "nope").unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrip_and_overwrite() {
        let c = conn();
        set(&c, "sort", "created:desc").unwrap();
        assert_eq!(get(&c, "sort").unwrap(), Some("created:desc".to_string()));
        set(&c, "sort", "filename:asc").unwrap();
        assert_eq!(get(&c, "sort").unwrap(), Some("filename:asc".to_string()));
    }
}
```

- [ ] **Step 4: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test db::history db::settings` → history 4件・settings 2件 PASS。

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/db/history.rs src-tauri/src/db/settings.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add filter_history and settings DB layers"
```

---

## Task 3: query モデルとパーサ（純粋）

**Files:**
- Create: `src-tauri/src/query/mod.rs`
- Create: `src-tauri/src/query/parse.rs`
- Modify: `src-tauri/src/lib.rs`（`mod query;` 追加）

- [ ] **Step 1: モジュール宣言とモデル**

`src-tauri/src/lib.rs` のモジュール宣言群に `mod query;` を追記。
`src-tauri/src/query/mod.rs` を作成:
```rust
pub mod compile;
pub mod parse;

/// 構造化条件の演算子。日時も epoch 秒の数値として扱う。
#[derive(Debug, Clone, PartialEq)]
pub enum CondOp {
    Like(String),
    Ge(i64),
    Le(i64),
    Gt(i64),
    Lt(i64),
    Eq(i64),
    Range(i64, i64), // 両端含む
}

/// 1つの構造化条件（FTS対象外の列に対する条件）。
#[derive(Debug, Clone, PartialEq)]
pub struct Cond {
    pub column: &'static str, // 検証済みの列名（SQLに直接埋めてよい）
    pub op: CondOp,
    pub negate: bool,
}

/// パース結果。テキストはFTS式、構造化条件は Cond。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedQuery {
    pub fts_include: Option<String>, // 正のFTS5 MATCH式
    pub fts_exclude: Option<String>, // 除外のFTS5 MATCH式（id NOT IN に使う）
    pub conds: Vec<Cond>,
}

/// ソートキー（許可リスト）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SortKey {
    Filename,
    Created,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortKey {
    pub fn parse(s: &str) -> SortKey {
        match s {
            "created" => SortKey::Created,
            "modified" => SortKey::Modified,
            _ => SortKey::Filename,
        }
    }
    /// ORDER BY に埋める列式（許可リストのみなのでSQL注入の余地はない）。
    pub fn column(self) -> &'static str {
        match self {
            SortKey::Filename => "filename COLLATE NOCASE",
            SortKey::Created => "created_at",
            SortKey::Modified => "modified_at",
        }
    }
}

impl SortDir {
    pub fn parse(s: &str) -> SortDir {
        if s.eq_ignore_ascii_case("asc") {
            SortDir::Asc
        } else {
            SortDir::Desc
        }
    }
    pub fn sql(self) -> &'static str {
        match self {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        }
    }
}
```

- [ ] **Step 2: パーサと失敗するテストを書く**

`src-tauri/src/query/parse.rs` を作成:
```rust
use super::{Cond, CondOp, ParsedQuery};

/// クエリフィールド名 -> FTS列名（テキスト系フィールド）。
fn text_field_column(field: &str) -> Option<&'static str> {
    match field {
        "prompt" => Some("positive"),
        "negative" => Some("negative"),
        "model" => Some("model"),
        "filename" => Some("filename"),
        _ => None,
    }
}

/// 構造化フィールド -> (列名, is_date)。
fn struct_field(field: &str) -> Option<(&'static str, bool)> {
    match field {
        "sampler" => Some(("sampler", false)),
        "tool" => Some(("source_tool", false)),
        "rating" => Some(("rating", false)),
        "width" => Some(("width", false)),
        "height" => Some(("height", false)),
        "pixels" => Some(("pixels", false)),
        "steps" => Some(("steps", false)),
        "seed" => Some(("seed", false)),
        "created" => Some(("created_at", true)),
        "modified" => Some(("modified_at", true)),
        _ => None,
    }
}

struct RawToken {
    text: String,
    quoted: bool,
}

/// 空白区切り。ダブルクォートで囲まれた部分は1トークン（クォートは外す）。
fn tokenize(input: &str) -> Vec<RawToken> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();
    let mut cur = String::new();
    let mut in_quote = false;
    let mut quoted = false;

    while let Some(&c) = chars.peek() {
        match c {
            '"' => {
                if in_quote {
                    in_quote = false;
                } else {
                    in_quote = true;
                    quoted = true;
                }
                chars.next();
            }
            c if c.is_whitespace() && !in_quote => {
                if !cur.is_empty() || quoted {
                    tokens.push(RawToken { text: std::mem::take(&mut cur), quoted });
                    quoted = false;
                }
                chars.next();
            }
            _ => {
                cur.push(c);
                chars.next();
            }
        }
    }
    if !cur.is_empty() || quoted {
        tokens.push(RawToken { text: cur, quoted });
    }
    tokens
}

/// FTS5 用に語/句をダブルクォートで囲む（特殊文字を無害化）。
fn fts_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// 数値/日時の値を CondOp に変換する。日時は epoch 秒へ。
fn parse_value_op(value: &str, is_date: bool) -> Option<CondOp> {
    let to_num = |s: &str| -> Option<i64> {
        if is_date {
            date_to_epoch(s, false)
        } else {
            s.parse::<i64>().ok()
        }
    };
    if let Some(rest) = value.strip_prefix(">=") {
        return to_num(rest).map(CondOp::Ge);
    }
    if let Some(rest) = value.strip_prefix("<=") {
        return to_num(rest).map(CondOp::Le);
    }
    if let Some(rest) = value.strip_prefix('>') {
        return to_num(rest).map(CondOp::Gt);
    }
    if let Some(rest) = value.strip_prefix('<') {
        return to_num(rest).map(CondOp::Lt);
    }
    if let Some((a, b)) = value.split_once("..") {
        // 範囲。日時は開始=その日の0時、終了=その日の23:59:59。
        let lo = if is_date { date_to_epoch(a, false) } else { a.parse().ok() };
        let hi = if is_date { date_to_epoch(b, true) } else { b.parse().ok() };
        return match (lo, hi) {
            (Some(lo), Some(hi)) => Some(CondOp::Range(lo, hi)),
            _ => None,
        };
    }
    // 単独値。日時なら1日範囲、数値なら等価。
    if is_date {
        match (date_to_epoch(value, false), date_to_epoch(value, true)) {
            (Some(lo), Some(hi)) => Some(CondOp::Range(lo, hi)),
            _ => None,
        }
    } else {
        to_num(value).map(CondOp::Eq)
    }
}

/// "YYYY-MM-DD" を epoch 秒へ。end_of_day=true なら同日 23:59:59。
/// うるう年等は考慮しない素朴な計算（ローカルタイムゾーン非依存のUTC基準）。
fn date_to_epoch(s: &str, end_of_day: bool) -> Option<i64> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let d: i64 = parts[2].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d);
    let secs = days * 86400 + if end_of_day { 86399 } else { 0 };
    Some(secs)
}

/// 1970-01-01 からの経過日数（Howard Hinnant のアルゴリズム）。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// クエリ文字列をパースする。
pub fn parse(input: &str) -> ParsedQuery {
    let tokens = tokenize(input);
    let mut include = String::new();
    let mut include_or_pending = false;
    let mut excludes: Vec<String> = Vec::new();
    let mut conds: Vec<Cond> = Vec::new();

    let append_include = |buf: &mut String, or_pending: &mut bool, expr: &str| {
        if !buf.is_empty() {
            buf.push_str(if *or_pending { " OR " } else { " AND " });
        }
        buf.push_str(expr);
        *or_pending = false;
    };

    for tok in tokens {
        // OR 演算子（裸の "OR"）。
        if !tok.quoted && tok.text.eq_ignore_ascii_case("OR") {
            include_or_pending = true;
            continue;
        }

        // 除外プレフィックス '-'。
        let (negate, body) = if !tok.quoted && tok.text.len() > 1 && tok.text.starts_with('-') {
            (true, tok.text[1..].to_string())
        } else {
            (false, tok.text.clone())
        };
        if body.is_empty() {
            continue;
        }

        // field:value（クォートされていないトークンのみ field 判定）。
        if !tok.quoted {
            if let Some((field, value)) = body.split_once(':') {
                if !value.is_empty() {
                    // 構造化フィールド
                    if let Some((column, is_date)) = struct_field(field) {
                        if let Some(op) = parse_value_op(value, is_date) {
                            conds.push(Cond { column, op, negate });
                            continue;
                        }
                        // 値が不正なら無視（入力を妨げない）
                        continue;
                    }
                    // テキストフィールド
                    if let Some(col) = text_field_column(field) {
                        let expr = format!("{} : {}", col, fts_quote(value));
                        if negate {
                            excludes.push(expr);
                        } else {
                            append_include(&mut include, &mut include_or_pending, &expr);
                        }
                        continue;
                    }
                }
            }
        }

        // 裸の語 / 句。
        let expr = fts_quote(&body);
        if negate {
            excludes.push(expr);
        } else {
            append_include(&mut include, &mut include_or_pending, &expr);
        }
    }

    ParsedQuery {
        fts_include: if include.is_empty() { None } else { Some(include) },
        fts_exclude: if excludes.is_empty() { None } else { Some(excludes.join(" OR ")) },
        conds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_terms_are_anded_and_quoted() {
        let pq = parse("masterpiece forest");
        assert_eq!(pq.fts_include.as_deref(), Some("\"masterpiece\" AND \"forest\""));
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn or_operator() {
        let pq = parse("forest OR mountain");
        assert_eq!(pq.fts_include.as_deref(), Some("\"forest\" OR \"mountain\""));
    }

    #[test]
    fn quoted_phrase() {
        let pq = parse("\"best quality\"");
        assert_eq!(pq.fts_include.as_deref(), Some("\"best quality\""));
    }

    #[test]
    fn text_field_maps_to_fts_column() {
        let pq = parse("prompt:forest");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"forest\""));
    }

    #[test]
    fn exclusion_goes_to_exclude_expr() {
        let pq = parse("forest -blurry");
        assert_eq!(pq.fts_include.as_deref(), Some("\"forest\""));
        assert_eq!(pq.fts_exclude.as_deref(), Some("\"blurry\""));
    }

    #[test]
    fn field_exclusion() {
        let pq = parse("-negative:blurry");
        assert_eq!(pq.fts_include, None);
        assert_eq!(pq.fts_exclude.as_deref(), Some("negative : \"blurry\""));
    }

    #[test]
    fn numeric_comparisons_and_ranges() {
        let pq = parse("rating:>=4 width:>=1024 steps:20..40");
        assert_eq!(pq.fts_include, None);
        assert_eq!(
            pq.conds,
            vec![
                Cond { column: "rating", op: CondOp::Ge(4), negate: false },
                Cond { column: "width", op: CondOp::Ge(1024), negate: false },
                Cond { column: "steps", op: CondOp::Range(20, 40), negate: false },
            ]
        );
    }

    #[test]
    fn sampler_and_tool_are_like_conds() {
        let pq = parse("sampler:euler tool:comfyui");
        assert_eq!(
            pq.conds,
            vec![
                Cond { column: "sampler", op: CondOp::Like("euler".into()), negate: false },
                Cond { column: "source_tool", op: CondOp::Like("comfyui".into()), negate: false },
            ]
        );
    }

    #[test]
    fn date_range_converts_to_epoch_seconds() {
        let pq = parse("created:2025-01-01..2025-01-02");
        assert_eq!(pq.conds.len(), 1);
        assert_eq!(pq.conds[0].column, "created_at");
        // 2025-01-01 00:00:00 UTC = 1735689600、2025-01-02 23:59:59 UTC = 1735862399
        assert_eq!(pq.conds[0].op, CondOp::Range(1735689600, 1735862399));
    }

    #[test]
    fn invalid_field_value_is_ignored() {
        // 数値でない rating は無視され、条件もFTSも生まれない
        let pq = parse("rating:abc");
        assert!(pq.conds.is_empty());
        assert_eq!(pq.fts_include, None);
    }

    #[test]
    fn unknown_field_is_treated_as_bare_text() {
        let pq = parse("foo:bar");
        // foo は既知フィールドでないため "foo:bar" を裸テキストとして扱う
        assert_eq!(pq.fts_include.as_deref(), Some("\"foo:bar\""));
    }
}
```

- [ ] **Step 3: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test query::parse` → 全テスト PASS。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/query/mod.rs src-tauri/src/query/parse.rs src-tauri/src/lib.rs
git commit -m "feat(query): add query model and B-syntax parser"
```

---

## Task 4: query コンパイラ（ParsedQuery → SQL）

**Files:**
- Create: `src-tauri/src/query/compile.rs`

- [ ] **Step 1: コンパイラと失敗するテストを書く**

`src-tauri/src/query/compile.rs` を作成:
```rust
use super::{Cond, CondOp, ParsedQuery};
use rusqlite::types::Value;

/// コンパイル済みフィルタ。`where_sql` は "WHERE" を含まない条件式、`params` は束縛値。
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledFilter {
    pub where_sql: String,
    pub params: Vec<Value>,
}

/// ParsedQuery を SQL の WHERE 条件式へコンパイルする。
/// 常に missing=0 を基底とし、FTSとCondをANDで結合する。
pub fn compile(pq: &ParsedQuery) -> CompiledFilter {
    let mut clauses: Vec<String> = vec!["missing = 0".to_string()];
    let mut params: Vec<Value> = Vec::new();

    if let Some(inc) = &pq.fts_include {
        clauses.push("id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)".to_string());
        params.push(Value::Text(inc.clone()));
    }
    if let Some(exc) = &pq.fts_exclude {
        clauses.push("id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)".to_string());
        params.push(Value::Text(exc.clone()));
    }

    for cond in &pq.conds {
        let (frag, ps) = compile_cond(cond);
        clauses.push(frag);
        params.extend(ps);
    }

    CompiledFilter {
        where_sql: clauses.join(" AND "),
        params,
    }
}

fn compile_cond(cond: &Cond) -> (String, Vec<Value>) {
    let col = cond.column;
    let (frag, params) = match &cond.op {
        CondOp::Like(v) => (
            format!("{col} LIKE ?"),
            vec![Value::Text(format!("%{v}%"))],
        ),
        CondOp::Ge(n) => (format!("{col} >= ?"), vec![Value::Integer(*n)]),
        CondOp::Le(n) => (format!("{col} <= ?"), vec![Value::Integer(*n)]),
        CondOp::Gt(n) => (format!("{col} > ?"), vec![Value::Integer(*n)]),
        CondOp::Lt(n) => (format!("{col} < ?"), vec![Value::Integer(*n)]),
        CondOp::Eq(n) => (format!("{col} = ?"), vec![Value::Integer(*n)]),
        CondOp::Range(a, b) => (
            format!("{col} BETWEEN ? AND ?"),
            vec![Value::Integer(*a), Value::Integer(*b)],
        ),
    };
    if cond.negate {
        (format!("NOT ({frag})"), params)
    } else {
        (frag, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::parse::parse;

    #[test]
    fn empty_query_is_missing_zero_only() {
        let cf = compile(&parse(""));
        assert_eq!(cf.where_sql, "missing = 0");
        assert!(cf.params.is_empty());
    }

    #[test]
    fn include_and_exclude_and_conds() {
        let cf = compile(&parse("forest -blurry rating:>=4"));
        assert_eq!(
            cf.where_sql,
            "missing = 0 AND id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?) \
             AND id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?) AND rating >= ?"
        );
        assert_eq!(cf.params.len(), 3);
        assert_eq!(cf.params[0], Value::Text("\"forest\"".to_string()));
        assert_eq!(cf.params[1], Value::Text("\"blurry\"".to_string()));
        assert_eq!(cf.params[2], Value::Integer(4));
    }

    #[test]
    fn like_wraps_with_percent() {
        let cf = compile(&parse("sampler:euler"));
        assert_eq!(cf.where_sql, "missing = 0 AND sampler LIKE ?");
        assert_eq!(cf.params[0], Value::Text("%euler%".to_string()));
    }

    #[test]
    fn range_uses_between() {
        let cf = compile(&parse("steps:20..40"));
        assert_eq!(cf.where_sql, "missing = 0 AND steps BETWEEN ? AND ?");
        assert_eq!(cf.params, vec![Value::Integer(20), Value::Integer(40)]);
    }
}
```

- [ ] **Step 2: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test query::compile` → 4件 PASS。

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/query/compile.rs
git commit -m "feat(query): compile ParsedQuery into SQL where-clause and params"
```

---

## Task 5: image_query DB層（ImageRow / query_images / count_query）

**Files:**
- Create: `src-tauri/src/db/image_query.rs`
- Modify: `src-tauri/src/db/mod.rs`（`pub mod image_query;`）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/db/mod.rs` に `pub mod image_query;` を追記。

- [ ] **Step 2: image_query.rs を作成（テスト付き）**

`src-tauri/src/db/image_query.rs`:
```rust
use crate::query::{compile, parse, SortDir, SortKey};
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 一覧表示用の画像行（必要列のみ）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageRow {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub thumb_path: Option<String>,
    pub width: i64,
    pub height: i64,
    pub pixels: i64,
    pub rating: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub source_tool: String,
    pub model: Option<String>,
}

const SELECT_COLS: &str = "id, path, filename, thumb_path, width, height, pixels, rating, \
                           created_at, modified_at, source_tool, model";

fn row_to_image(r: &rusqlite::Row) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow {
        id: r.get(0)?,
        path: r.get(1)?,
        filename: r.get(2)?,
        thumb_path: r.get(3)?,
        width: r.get(4)?,
        height: r.get(5)?,
        pixels: r.get(6)?,
        rating: r.get(7)?,
        created_at: r.get(8)?,
        modified_at: r.get(9)?,
        source_tool: r.get(10)?,
        model: r.get(11)?,
    })
}

/// クエリ文字列でフィルタし、ソート・ページングして画像行を返す。
pub fn query_images(
    conn: &Connection,
    query_text: &str,
    sort: SortKey,
    dir: SortDir,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<ImageRow>> {
    let cf = compile::compile(&parse::parse(query_text));
    let sql = format!(
        "SELECT {cols} FROM images WHERE {where_sql} ORDER BY {sortcol} {sortdir}, id {sortdir} LIMIT ? OFFSET ?",
        cols = SELECT_COLS,
        where_sql = cf.where_sql,
        sortcol = sort.column(),
        sortdir = dir.sql(),
    );
    let mut p = cf.params;
    p.push(Value::Integer(limit));
    p.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(p), row_to_image)?;
    rows.collect()
}

/// クエリ文字列に一致する画像件数を返す。
pub fn count_query(conn: &Connection, query_text: &str) -> rusqlite::Result<i64> {
    let cf = compile::compile(&parse::parse(query_text));
    let sql = format!("SELECT count(*) FROM images WHERE {}", cf.where_sql);
    conn.query_row(&sql, params_from_iter(cf.params), |r| r.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{images::NewImage, migrations};

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        c.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        c
    }

    fn img(path: &str, positive: &str, rating: Option<i64>, width: i64) -> NewImage {
        NewImage {
            directory_id: 1,
            path: path.to_string(),
            filename: path.rsplit('/').next().unwrap().to_string(),
            size: 1,
            mtime: 1,
            created_at: Some(1000),
            modified_at: Some(1000),
            width,
            height: 100,
            rating,
            format: "png".to_string(),
            positive: Some(positive.to_string()),
            raw_parameters: Some(positive.to_string()),
            source_tool: "a1111".to_string(),
            ..Default::default()
        }
    }

    fn seed(c: &Connection) {
        crate::db::images::upsert(c, &img("/d/a.png", "forest cabin", Some(5), 1024)).unwrap();
        crate::db::images::upsert(c, &img("/d/b.png", "forest blurry", Some(3), 512)).unwrap();
        crate::db::images::upsert(c, &img("/d/c.png", "mountain peak", Some(4), 2048)).unwrap();
    }

    #[test]
    fn empty_query_returns_all_non_missing() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(count_query(&c, "").unwrap(), 3);
    }

    #[test]
    fn fts_include_filters() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "forest", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(count_query(&c, "forest").unwrap(), 2);
    }

    #[test]
    fn fts_exclude_filters() {
        let c = conn();
        seed(&c);
        let rows = query_images(&c, "forest -blurry", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].filename, "a.png");
    }

    #[test]
    fn rating_and_width_conds() {
        let c = conn();
        seed(&c);
        // rating>=4 かつ width>=1024 → a(5,1024), c(4,2048)
        let n = count_query(&c, "rating:>=4 width:>=1024").unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn sort_desc_by_width_via_filename_proxy() {
        let c = conn();
        seed(&c);
        // filename昇順/降順の確認
        let asc = query_images(&c, "", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        let desc = query_images(&c, "", SortKey::Filename, SortDir::Desc, 100, 0).unwrap();
        assert_eq!(asc.first().unwrap().filename, "a.png");
        assert_eq!(desc.first().unwrap().filename, "c.png");
    }

    #[test]
    fn limit_and_offset_paginate() {
        let c = conn();
        seed(&c);
        let page1 = query_images(&c, "", SortKey::Filename, SortDir::Asc, 2, 0).unwrap();
        let page2 = query_images(&c, "", SortKey::Filename, SortDir::Asc, 2, 2).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 1);
        assert_eq!(page2[0].filename, "c.png");
    }

    #[test]
    fn missing_rows_excluded() {
        let c = conn();
        seed(&c);
        c.execute("UPDATE images SET missing = 1 WHERE filename = 'a.png'", []).unwrap();
        assert_eq!(count_query(&c, "").unwrap(), 2);
    }
}
```

- [ ] **Step 3: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test db::image_query` → 7件 PASS。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/db/image_query.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add image_query (filter/sort/paginate) and count_query"
```

---

## Task 6: query / prefs Tauri コマンド

**Files:**
- Create: `src-tauri/src/commands/query.rs`
- Create: `src-tauri/src/commands/prefs.rs`
- Modify: `src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`

- [ ] **Step 1: モジュール登録**

`src-tauri/src/commands/mod.rs` に追記:
```rust
pub mod prefs;
pub mod query;
```

- [ ] **Step 2: query コマンド**

`src-tauri/src/commands/query.rs`:
```rust
use crate::db::image_query::{self, ImageRow};
use crate::db::Db;
use crate::query::{SortDir, SortKey};
use tauri::State;

/// クエリ文字列でフィルタした画像行を返す。
#[tauri::command]
pub fn query_images(
    db: State<Db>,
    query: String,
    sort: String,
    dir: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<ImageRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::query_images(
        &conn,
        &query,
        SortKey::parse(&sort),
        SortDir::parse(&dir),
        limit,
        offset,
    )
    .map_err(|e| e.to_string())
}

/// クエリ文字列に一致する件数を返す。
#[tauri::command]
pub fn count_query(db: State<Db>, query: String) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::count_query(&conn, &query).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: prefs コマンド**

`src-tauri/src/commands/prefs.rs`:
```rust
use crate::db::{history, settings, Db};
use tauri::State;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn add_filter_history(db: State<Db>, query: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history::record(&conn, &query, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_filter_history(db: State<Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    settings::get(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    settings::set(&conn, &key, &value).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: invoke_handler に登録**

`src-tauri/src/lib.rs` の `invoke_handler!` に追加（既存は残す）:
```rust
            commands::query::query_images,
            commands::query::count_query,
            commands::prefs::add_filter_history,
            commands::prefs::list_filter_history,
            commands::prefs::get_setting,
            commands::prefs::set_setting,
```

- [ ] **Step 5: コンパイルとテスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build && cargo test` → 成功・全PASS。

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/commands/query.rs src-tauri/src/commands/prefs.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add query_images/count_query and history/settings commands"
```

---

## Task 7: サムネイル表示のための asset protocol 有効化

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs`（setup で thumbnails ディレクトリをスコープ許可）

- [ ] **Step 1: tauri.conf.json で assetProtocol を有効化**

`src-tauri/tauri.conf.json` の `app.security` に `assetProtocol` を追加（既存の `security`/`csp` があればマージ。無ければ `app` 直下に `security` を作る）:
```json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPDATA/**"]
      }
    }
  }
}
```
（実ファイル構成に合わせて既存JSONへマージすること。`$APPDATA` がスコープ変数として展開されない Tauri バージョンの場合は Step 2 のランタイム許可で担保するため、`scope` は空配列でも可。）

- [ ] **Step 2: setup で thumbnails ディレクトリをランタイム許可**

`src-tauri/src/lib.rs` の `setup` クロージャ内、DB初期化の後に thumbnails ディレクトリを作成し asset スコープへ許可するコードを追加:
```rust
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("library.db"))?;
            app.manage(db::Db(std::sync::Arc::new(std::sync::Mutex::new(conn))));

            // サムネイルディレクトリを作成し、asset protocol で読めるよう許可する。
            let thumb_dir = dir.join("thumbnails");
            std::fs::create_dir_all(&thumb_dir)?;
            app.asset_protocol_scope().allow_directory(&thumb_dir, true)?;
            Ok(())
        })
```
（注: `asset_protocol_scope()` / `allow_directory(path, recursive)` のシグネチャは Tauri v2 のバージョンで異なる場合がある。コンパイルエラーが出たら、当バージョンの asset スコープAPI（例: `tauri::Manager::asset_protocol_scope`）に合わせる。`allow_directory` がエラーを返さない版なら `?` を外す。スコープAPIが存在しない場合は Step 1 の config スコープ（`$APPDATA/**` あるいは絶対パス）のみで対応し、その旨をコミットメッセージに記す。）

- [ ] **Step 3: コンパイル確認** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build` → 成功。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs
git commit -m "feat(assets): enable asset protocol and allow thumbnails directory"
```

---

## Task 8: フロント型と API ラッパ

**Files:**
- Modify: `src/types.ts`
- Create: `src/api/images.ts`
- Create: `src/api/prefs.ts`

- [ ] **Step 1: 型追加**

`src/types.ts` に追記:
```ts
export interface ImageRow {
  id: number;
  path: string;
  filename: string;
  thumb_path: string | null;
  width: number;
  height: number;
  pixels: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  source_tool: string;
  model: string | null;
}

export type SortKey = "filename" | "created" | "modified";
export type SortDir = "asc" | "desc";
```

- [ ] **Step 2: API ラッパ**

`src/api/images.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { ImageRow, SortKey, SortDir } from "../types";

export const queryImages = (
  query: string,
  sort: SortKey,
  dir: SortDir,
  limit: number,
  offset: number,
) => invoke<ImageRow[]>("query_images", { query, sort, dir, limit, offset });

export const countQuery = (query: string) => invoke<number>("count_query", { query });
```

`src/api/prefs.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

export const addFilterHistory = (query: string) =>
  invoke<void>("add_filter_history", { query });
export const listFilterHistory = () => invoke<string[]>("list_filter_history");
export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });
```

- [ ] **Step 3: 型チェック** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功。

- [ ] **Step 4: Commit**
```bash
git add src/types.ts src/api/images.ts src/api/prefs.ts
git commit -m "feat(frontend): add ImageRow/sort types and query/prefs api wrappers"
```

---

## Task 9: query Zustand ストア（TDD）

**Files:**
- Create: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/store/useQueryStore.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/prefs");

const row = (id: number, filename: string): ImageRow => ({
  id, path: `/d/${filename}`, filename, thumb_path: `/t/${id}.webp`,
  width: 100, height: 100, pixels: 10000, rating: null,
  created_at: 1, modified_at: 1, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({
    query: "", sort: "filename", dir: "asc",
    results: [], total: 0, history: [], showFilename: true,
  });
  vi.resetAllMocks();
});

describe("useQueryStore", () => {
  it("runQuery loads results and total", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([row(1, "a.png")]);
    vi.mocked(imagesApi.countQuery).mockResolvedValue(1);
    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().results).toHaveLength(1);
    expect(useQueryStore.getState().total).toBe(1);
  });

  it("setQuery updates query text", () => {
    useQueryStore.getState().setQuery("forest");
    expect(useQueryStore.getState().query).toBe("forest");
  });

  it("setSort updates sort key and dir", () => {
    useQueryStore.getState().setSort("created", "desc");
    expect(useQueryStore.getState().sort).toBe("created");
    expect(useQueryStore.getState().dir).toBe("desc");
  });

  it("commitHistory records and refreshes history", async () => {
    vi.mocked(prefsApi.addFilterHistory).mockResolvedValue(undefined as unknown as void);
    vi.mocked(prefsApi.listFilterHistory).mockResolvedValue(["forest"]);
    useQueryStore.getState().setQuery("forest");
    await useQueryStore.getState().commitHistory();
    expect(prefsApi.addFilterHistory).toHaveBeenCalledWith("forest");
    expect(useQueryStore.getState().history).toEqual(["forest"]);
  });

  it("toggleShowFilename flips and persists", async () => {
    vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
    await useQueryStore.getState().toggleShowFilename();
    expect(useQueryStore.getState().showFilename).toBe(false);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("show_filename", "false");
  });
});
```

- [ ] **Step 2: 失敗確認** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test` → 失敗（useQueryStore 未定義）。

- [ ] **Step 3: ストアを実装**

`src/store/useQueryStore.ts`:
```ts
import { create } from "zustand";
import type { ImageRow, SortKey, SortDir } from "../types";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";

const PAGE = 200;

interface QueryState {
  query: string;
  sort: SortKey;
  dir: SortDir;
  results: ImageRow[];
  total: number;
  history: string[];
  showFilename: boolean;
  setQuery: (q: string) => void;
  setSort: (sort: SortKey, dir: SortDir) => void;
  runQuery: () => Promise<void>;
  commitHistory: () => Promise<void>;
  loadHistory: () => Promise<void>;
  toggleShowFilename: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  query: "",
  sort: "filename",
  dir: "asc",
  results: [],
  total: 0,
  history: [],
  showFilename: true,
  setQuery: (q) => set({ query: q }),
  setSort: (sort, dir) => {
    set({ sort, dir });
    void get().runQuery();
    void prefsApi.setSetting("sort", `${sort}:${dir}`);
  },
  runQuery: async () => {
    const { query, sort, dir } = get();
    const [results, total] = await Promise.all([
      imagesApi.queryImages(query, sort, dir, PAGE, 0),
      imagesApi.countQuery(query),
    ]);
    set({ results, total });
  },
  commitHistory: async () => {
    const q = get().query.trim();
    if (!q) return;
    await prefsApi.addFilterHistory(q);
    await get().loadHistory();
  },
  loadHistory: async () => {
    set({ history: await prefsApi.listFilterHistory() });
  },
  toggleShowFilename: async () => {
    const next = !get().showFilename;
    set({ showFilename: next });
    await prefsApi.setSetting("show_filename", String(next));
  },
  loadSettings: async () => {
    const [sortRaw, showRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
    ]);
    if (sortRaw) {
      const [sort, dir] = sortRaw.split(":");
      set({ sort: sort as SortKey, dir: (dir as SortDir) ?? "asc" });
    }
    if (showRaw !== null) {
      set({ showFilename: showRaw !== "false" });
    }
  },
}));
```

- [ ] **Step 4: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test` → 既存＋新規5件 PASS。

- [ ] **Step 5: Commit**
```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "feat(frontend): add query store (filter/sort/results/history/settings)"
```

---

## Task 10: FilterBar（テキスト欄・ヒストリ・ソート・詳細ボタン）

**Files:**
- Modify: `src/components/FilterBar.tsx`

- [ ] **Step 1: FilterBar を実装**

`src/components/FilterBar.tsx` の中身を全置換:
```tsx
import { useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
import type { SortKey, SortDir } from "../types";
import { FilterDialog } from "./FilterDialog";

const SORT_LABELS: Record<SortKey, string> = {
  filename: "名前",
  created: "作成日時",
  modified: "更新日時",
};

export function FilterBar() {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const commitHistory = useQueryStore((s) => s.commitHistory);
  const history = useQueryStore((s) => s.history);
  const sort = useQueryStore((s) => s.sort);
  const dir = useQueryStore((s) => s.dir);
  const setSort = useQueryStore((s) => s.setSort);
  const total = useQueryStore((s) => s.total);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const submit = async () => {
    await runQuery();
    await commitHistory();
    setHistoryIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void submit();
    } else if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setQuery(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setQuery(next === -1 ? "" : history[next]);
    }
  };

  return (
    <div className="filter-bar">
      <input
        className="filter-input"
        value={query}
        placeholder='例: prompt:1girl rating:>=4 -blurry'
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        list="filter-history"
        aria-label="フィルタクエリ"
      />
      <datalist id="filter-history">
        {history.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
      <button onClick={() => void submit()} aria-label="検索">
        検索
      </button>
      <button onClick={() => setDialogOpen(true)}>詳細…</button>
      <label className="sort-control">
        並べ替え:
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey, dir)}
          aria-label="ソートキー"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSort(sort, dir === "asc" ? "desc" : "asc")}
          aria-label="昇順降順切替"
        >
          {dir === "asc" ? "↑" : "↓"}
        </button>
      </label>
      <span className="result-count">{total} 件</span>
      {dialogOpen && <FilterDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: 型チェック** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → （`FilterDialog` 未作成のため失敗してよい。Task 11 で解消）。一旦 `git add` せず Task 11 へ進む。

（注: Task 10 と Task 11 は相互依存のため、両方完了後にまとめてビルド確認・コミットする。Task 11 Step 3 でまとめてコミットする。）

---

## Task 11: FilterDialog（詳細条件 → クエリ欄へ追記）

**Files:**
- Create: `src/components/FilterDialog.tsx`

- [ ] **Step 1: FilterDialog を実装**

`src/components/FilterDialog.tsx` を作成:
```tsx
import { useState } from "react";
import { useQueryStore } from "../store/useQueryStore";

interface Props {
  onClose: () => void;
}

/** 既存クエリから指定フィールドのトークンを除去して新トークンを追記する。 */
function upsertToken(query: string, field: string, token: string | null): string {
  const tokens = query.split(/\s+/).filter((t) => t && !t.startsWith(`${field}:`));
  if (token) tokens.push(token);
  return tokens.join(" ").trim();
}

export function FilterDialog({ onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);

  const [minRating, setMinRating] = useState("");
  const [minWidth, setMinWidth] = useState("");
  const [minHeight, setMinHeight] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  const apply = async () => {
    let q = query;
    q = upsertToken(q, "rating", minRating ? `rating:>=${minRating}` : null);
    q = upsertToken(q, "width", minWidth ? `width:>=${minWidth}` : null);
    q = upsertToken(q, "height", minHeight ? `height:>=${minHeight}` : null);
    q = upsertToken(
      q,
      "created",
      createdFrom && createdTo ? `created:${createdFrom}..${createdTo}` : null,
    );
    setQuery(q);
    await runQuery();
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>詳細フィルタ</h3>
        <label>
          レーティング下限
          <select value={minRating} onChange={(e) => setMinRating(e.target.value)}>
            <option value="">指定なし</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                ★{n}以上
              </option>
            ))}
          </select>
        </label>
        <label>
          幅下限(px)
          <input type="number" value={minWidth} onChange={(e) => setMinWidth(e.target.value)} />
        </label>
        <label>
          高さ下限(px)
          <input type="number" value={minHeight} onChange={(e) => setMinHeight(e.target.value)} />
        </label>
        <label>
          作成日 開始
          <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
        </label>
        <label>
          作成日 終了
          <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button onClick={onClose}>キャンセル</button>
          <button onClick={() => void apply()}>適用</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ビルド** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功（FilterBar＋FilterDialog が揃いコンパイルが通る）。`npm test` 既存PASS。

- [ ] **Step 3: Commit（Task 10 と一緒に）**
```bash
git add src/components/FilterBar.tsx src/components/FilterDialog.tsx
git commit -m "feat(frontend): filter bar with history/sort and detail filter dialog"
```

---

## Task 12: ImageGridPanel（仮想レスポンシブ正方形グリッド）

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`
- Modify: `package.json`（@tanstack/react-virtual）
- Modify: `src/App.css`（グリッド/ツールバー/ダイアログのスタイル）

- [ ] **Step 1: 依存追加** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm install @tanstack/react-virtual`

- [ ] **Step 2: ImageGridPanel を実装**

`src/components/ImageGridPanel.tsx` の中身を全置換:
```tsx
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryStore } from "../store/useQueryStore";

const MIN_CELL = 160; // セル最小幅(px)。これを基準に列数を決める。
const GAP = 6;

export function ImageGridPanel() {
  const results = useQueryStore((s) => s.results);
  const showFilename = useQueryStore((s) => s.showFilename);

  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // コンテナ幅を監視して列数を算出。
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
  const cellSize = columns > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL;
  const rowCount = Math.ceil(results.length / columns);
  const rowHeight = cellSize + (showFilename ? 20 : 0) + GAP;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  if (results.length === 0) {
    return (
      <div className="image-grid" ref={parentRef}>
        <p className="placeholder-note">該当する画像がありません</p>
      </div>
    );
  }

  return (
    <div className="image-grid" ref={parentRef}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vrow) => {
          const start = vrow.index * columns;
          const items = results.slice(start, start + columns);
          return (
            <div
              key={vrow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vrow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: GAP,
              }}
            >
              {items.map((img) => (
                <div key={img.id} className="thumb-cell">
                  <div className="thumb-square" style={{ height: cellSize }}>
                    {img.thumb_path ? (
                      <img
                        src={convertFileSrc(img.thumb_path)}
                        alt={img.filename}
                        loading="lazy"
                      />
                    ) : (
                      <div className="thumb-missing">▦</div>
                    )}
                  </div>
                  {showFilename && (
                    <div className="thumb-name" title={img.filename}>
                      {img.filename}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: App.css にスタイル追加**

`src/App.css` の末尾に追記:
```css
/* フィルタバー */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter-input {
  flex: 1;
}
.sort-control {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.result-count {
  color: #666;
  font-size: 12px;
  white-space: nowrap;
}

/* 画像グリッド */
.image-grid {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
  box-sizing: border-box;
}
.thumb-cell {
  display: flex;
  flex-direction: column;
}
.thumb-square {
  width: 100%;
  background: #1a1a1a;
  border-radius: 4px;
  overflow: hidden;
}
.thumb-square img {
  width: 100%;
  height: 100%;
  object-fit: cover; /* 中央クロップ表示（サムネは既に正方形） */
  display: block;
}
.thumb-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #555;
}
.thumb-name {
  font-size: 11px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 詳細ダイアログ */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.dialog {
  background: #fff;
  color: #111;
  padding: 16px;
  border-radius: 8px;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dialog label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
```

- [ ] **Step 4: ビルド** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功。`npm test` 既存PASS。

- [ ] **Step 5: Commit**
```bash
git add src/components/ImageGridPanel.tsx src/App.css package.json package-lock.json
git commit -m "feat(frontend): responsive virtualized square thumbnail grid"
```

---

## Task 13: 配線（起動時クエリ・設定/ヒストリ読込・ファイル名トグル）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/DirectoryPanel.tsx`（スキャン完了時に一覧を再クエリ）

- [ ] **Step 1: App.tsx で起動時に設定・ヒストリ・初回クエリを実行＋ファイル名トグル**

`src/App.tsx` の中身を全置換:
```tsx
import { useEffect } from "react";
import { useLibraryStore } from "./store/useLibraryStore";
import { useQueryStore } from "./store/useQueryStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
  const loadSettings = useQueryStore((s) => s.loadSettings);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const runQuery = useQueryStore((s) => s.runQuery);
  const showFilename = useQueryStore((s) => s.showFilename);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);

  useEffect(() => {
    void (async () => {
      await loadDirectories();
      await loadSettings();
      await loadHistory();
      await runQuery();
    })();
  }, [loadDirectories, loadSettings, loadHistory, runQuery]);

  return (
    <div className="app-shell">
      <header className="filter-bar-slot">
        <FilterBar />
        <button
          className="filename-toggle"
          onClick={() => void toggleShowFilename()}
          aria-pressed={showFilename}
        >
          ファイル名{showFilename ? "：表示" : "：非表示"}
        </button>
      </header>
      <DirectoryPanel />
      <main className="image-grid-slot">
        <ImageGridPanel />
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: スキャン完了時に一覧を再クエリ**

`src/components/DirectoryPanel.tsx` の `scan-done` リスナ内（`setImageCount` 取得の後）に、現在のクエリを再実行する行を追加する。ファイル冒頭の import に追記:
```tsx
import { useQueryStore } from "../store/useQueryStore";
```
コンポーネント内でアクションを取得:
```tsx
  const runQuery = useQueryStore((s) => s.runQuery);
```
`scan-done` ハンドラの `setImageCount(...)` 取得後に追記（依存配列にも `runQuery` を追加）:
```tsx
      // スキャン完了で新しい画像が入った可能性があるため一覧を更新。
      void runQuery();
```

- [ ] **Step 3: ビルドとテスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build && npm test` → 成功・全PASS。

- [ ] **Step 4: Commit**
```bash
git add src/App.tsx src/components/DirectoryPanel.tsx
git commit -m "feat(frontend): wire startup query, settings/history load, filename toggle, refresh on scan"
```

---

## Task 14: 結合・手動スモークテスト

**Files:** なし（検証のみ）

- [ ] **Step 1: 全自動テスト**
```bash
cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test
cd /Users/ikomiki/workspace/gen-img-manager && npm test
```
Expected: Rust 全テスト・フロント全テスト PASS。

- [ ] **Step 2: 開発モードで起動** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run tauri dev`

- [ ] **Step 3: 一覧表示の確認**
操作: 計画2でスキャン済みのディレクトリがあれば、一覧に正方形サムネイルがグリッド表示される。無ければディレクトリ追加→スキャン後に表示される。
Expected: サムネイルが表示され、ウィンドウ幅を変えると1行あたりの列数が増減する。

- [ ] **Step 4: フィルタの確認**
操作: 上部欄に `forest`、`prompt:1girl`、`rating:>=4`、`width:>=1024`、`forest -blurry` 等を入力しEnter。
Expected: 件数表示が更新され、一致画像のみ表示。Enterでヒストリに保存され、↑↓で履歴呼び出しできる。

- [ ] **Step 5: 詳細ダイアログ・ソート・ファイル名トグル**
操作: 「詳細…」でレーティング下限/幅/作成日を指定→適用（クエリ欄にトークンが追記される）。「並べ替え」で名前/作成日時/更新日時×昇順降順を切替。「ファイル名：表示/非表示」トグル。再起動してソート・ファイル名設定が復元されることを確認。
Expected: それぞれ反映され、設定は永続化される。

- [ ] **Step 6: マイルストーン完了コミット**
```bash
cd /Users/ikomiki/workspace/gen-img-manager
git commit --allow-empty -m "chore: milestone 3 complete - list, filter, sort UI"
```

---

## このプランで満たす設計書の項目（自己レビュー）

- §5 フィルタ構文（裸の語=全文・スペース=AND・OR・-除外・"句"・field指定 prompt/negative/model/sampler/tool・範囲 rating/width/height/pixels/steps/seed/created/modified・エラーは無視して有効部分のみ適用）✔（Task 3,4）
- §5 詳細ダイアログがトークンを欄に追記（状態を一行クエリに集約）✔（Task 11）
- §5 ヒストリ（直近20件・永続・重複は最新へ・↑↓呼出）✔（Task 2,10）
- §6 一覧: 正方形サムネ（中央クロップ=object-fit:cover）・CSS Grid auto-fill相当のレスポンシブ列数・仮想スクロール・ファイル名省略表示・ファイル名トグル ✔（Task 12,13）
- §6 ソート（名前/作成日時/更新日時 × 昇順降順・永続・ORDER BY直結）✔（Task 5,10）
- §3 filter_history / settings テーブル ✔（Task 1,2）
- §8 サムネはローカルキャッシュをasset protocolで表示 ✔（Task 7,12）

**計画4以降に持ち越す項目（範囲外）:** メインメニュー「表示」へのズーム/スライドショー/ファイル名チェック移設（本計画はツールバーのトグルで実装）、ダブルクリック/Enterでのビューア起動、ビューア本体、スライドショー。`tool:`/`sampler:` 以外の高度な検索（Lora等）。`created_at`/`modified_at` の厳密な値は計画2のscanner由来（birth time）に依存。

## 既知の注意点・実装時のリスク

- **asset protocol API**: `app.asset_protocol_scope().allow_directory(...)` のシグネチャは Tauri v2 のバージョンで差がある。コンパイルエラー時は当バージョンのAPIに合わせる。スコープが効かずサムネが表示されない場合は、`tauri.conf.json` の `assetProtocol.scope` に thumbnails の絶対パス相当（`$APPDATA/thumbnails/**` 等）を追加する。Task 14 のdevで実表示を必ず確認。
- **FTS5 MATCH の安全性**: 語は全て `fts_quote`（ダブルクォートで囲み内部の `"` を二重化）して特殊文字を無害化済み。`field : "term"` の列フィルタ構文を使用。
- **SQL注入**: 列名は許可リスト（parse の `struct_field`/`text_field_column`、SortKey/SortDir）由来のみをSQLへ埋め、値は全て束縛パラメータ（`params_from_iter`）。
- **ページング**: 既定 PAGE=200 件を取得。10万件規模での無限スクロール追加読みは計画外（必要なら後続でoffset追従）。件数は `count_query` で全件表示。
- **日付パース**: `date_to_epoch` はUTC基準の素朴計算。タイムゾーン厳密性は要件外。
- **react-virtual のバージョン差**: `useVirtualizer` のAPIがメジャーバージョンで異なる場合はコンパイル/型エラーに合わせて調整。
