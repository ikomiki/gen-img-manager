# タグ＆レーティング分析機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロンプトをタグ化して保存し、タグ頻度・特定タグのレーティング分布・高/低評価原因タグ（ベイズ縮約平均）を、全体／フィルタ範囲で分析できるメイン窓内ビューを追加する。

**Architecture:** マイグレーション v5 で `tags`/`image_tags` と分析用テーブル（`analysis_params`/`analysis_excluded_tags`/`analysis_scope`）＋全分析を表現する View 群を追加。タグ抽出は純粋関数 `extract_tags` に集約し、スキャン時の紐付けと起動時 backfill で共用する。分析は「スコープが空＝全可視画像」という規約の View で全体／フィルタ範囲を両立し、各コマンドがロック内でスコープ／パラメータを設定してから View を読む。

**Tech Stack:** Rust（Tauri 2 / rusqlite / SQLite View）、React 19 + TypeScript + zustand、vitest、cargo test。

設計仕様: `docs/superpowers/specs/2026-06-12-tag-rating-analysis-design.md`

---

## ファイル構成

**新規（Rust）**
- `src-tauri/src/parser/tags.rs` — `extract_tags` 純粋関数と `TagKind`。
- `src-tauri/src/db/tags.rs` — `get_or_create_tag` / `replace_image_tags` / `image_tag_sources`。
- `src-tauri/src/db/analysis.rs` — スコープ／パラメータ設定と各 View 読取、除外リスト CRUD。
- `src-tauri/src/backfill.rs` — 起動時の一括タグ生成（parser + db のブリッジ）。
- `src-tauri/src/commands/analysis.rs` — 分析の公開コマンド。

**変更（Rust）**
- `src-tauri/src/db/migrations.rs` — v5 追記＋既存バージョンアサート 4→5。
- `src-tauri/src/parser/mod.rs` — `pub mod tags;`。
- `src-tauri/src/db/mod.rs` — `pub mod tags;` / `pub mod analysis;`。
- `src-tauri/src/scanner.rs` — `FileOutcome::Upsert` にタグを同梱、writer で紐付け。
- `src-tauri/src/commands/mod.rs` — `pub mod analysis;`。
- `src-tauri/src/lib.rs` — `mod backfill;`、setup で backfill 実行、コマンド登録。
- `src-tauri/src/menu.rs` — 「表示」メニューに「分析」項目を追加。

**新規（フロント）**
- `src/api/analysis.ts` — コマンドの薄いラッパ。
- `src/store/useAnalysisStore.ts` — 分析ビューの状態。
- `src/components/AnalysisView.tsx` — タブ容器＋スコープ/除外トグル。
- `src/components/TagFrequencyTable.tsx` — 頻度一覧＋ドリルダウン。
- `src/components/TagRatingAnalysis.tsx` — 特定タグの「ある/ない」分布。
- `src/components/RatingCauseTable.tsx` — 高/低原因タグ。
- `src/components/ExcludedTagsEditor.tsx` — 除外リスト編集。

**変更（フロント）**
- `src/types.ts` — 分析系の型を追加。
- `src/App.tsx` — `open_analysis` リスナ＋ `AnalysisView` 描画。

---

## Task 1: マイグレーション v5（テーブル＋View＋seed）

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: 既存のバージョンアサートを 4→5 に更新**

`src-tauri/src/db/migrations.rs` のテスト内にある `assert_eq!(v, 4)` を **すべて** `assert_eq!(v, 5)` に置換する（`creates_directories_table_and_sets_version` / `run_is_idempotent` / `v2_creates_images_and_fts` / `v3_creates_history_and_settings_and_version_is_3` / `v4_adds_visible_column_default_1` の5箇所）。

- [ ] **Step 2: v5 マイグレーションを `MIGRATIONS` 配列末尾に追記**

`src-tauri/src/db/migrations.rs` の `MIGRATIONS` 配列、`v4` の要素の後（`];` の直前）に次の要素を追加する。**並び替え・既存要素の変更は禁止**。

```rust
    // v5: tags / image_tags / 分析用テーブル + 分析View
    "CREATE TABLE tags (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE image_tags (
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
        kind     TEXT NOT NULL,
        PRIMARY KEY (image_id, tag_id, kind)
    );
    CREATE INDEX idx_image_tags_tag   ON image_tags(tag_id, kind);
    CREATE INDEX idx_image_tags_image ON image_tags(image_id);
    CREATE TABLE analysis_params (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        apply_exclusion INTEGER NOT NULL DEFAULT 1,
        min_rated_count INTEGER NOT NULL DEFAULT 10,
        prior_weight    REAL    NOT NULL DEFAULT 10
    );
    INSERT INTO analysis_params(id) VALUES (1);
    CREATE TABLE analysis_excluded_tags ( name TEXT PRIMARY KEY );
    INSERT INTO analysis_excluded_tags(name) VALUES
        ('masterpiece'),('best quality'),('worst quality'),('low quality'),
        ('normal quality'),('high quality'),('lowres'),('highres'),('absurdres'),
        ('ultra detailed'),('very detailed'),('8k'),('4k'),
        ('score 9'),('score 8 up'),('score 7 up'),('score 6 up'),('score 5 up'),('score 4 up');
    CREATE TABLE analysis_scope ( image_id INTEGER PRIMARY KEY );
    CREATE VIEW analysis_images AS
        SELECT i.id, i.rating FROM images i
        WHERE i.missing = 0
          AND i.directory_id IN (SELECT id FROM directories WHERE visible = 1)
          AND (NOT EXISTS(SELECT 1 FROM analysis_scope)
               OR i.id IN (SELECT image_id FROM analysis_scope));
    CREATE VIEW analysis_tag_occurrence AS
        SELECT it.image_id, it.tag_id, t.name, ai.rating
        FROM image_tags it
        JOIN tags t             ON t.id  = it.tag_id
        JOIN analysis_images ai ON ai.id = it.image_id
        WHERE it.kind IN ('prompt','unclassified')
          AND ((SELECT apply_exclusion FROM analysis_params) = 0
               OR t.name NOT IN (SELECT name FROM analysis_excluded_tags));
    CREATE VIEW tag_frequency AS
        SELECT tag_id, name, COUNT(DISTINCT image_id) AS image_count
        FROM analysis_tag_occurrence GROUP BY tag_id, name;
    CREATE VIEW analysis_rating_baseline AS
        SELECT AVG(rating) AS mean_rating FROM analysis_images WHERE rating IS NOT NULL;
    CREATE VIEW tag_rating_lift AS
        SELECT * FROM (
            SELECT tag_id, name,
                SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rated_count,
                AVG(rating) AS raw_avg,
                ( SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) * AVG(rating)
                  + (SELECT prior_weight FROM analysis_params)
                    * (SELECT mean_rating FROM analysis_rating_baseline) )
                / ( SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END)
                    + (SELECT prior_weight FROM analysis_params) ) AS adjusted_avg,
                (SELECT mean_rating FROM analysis_rating_baseline) AS overall_avg
            FROM analysis_tag_occurrence GROUP BY tag_id, name
        )
        WHERE rated_count >= (SELECT min_rated_count FROM analysis_params);
    CREATE VIEW tag_rating_distribution AS
        SELECT tag_id, name, rating, COUNT(DISTINCT image_id) AS cnt
        FROM analysis_tag_occurrence GROUP BY tag_id, name, rating;
    CREATE VIEW scope_rating_distribution AS
        SELECT rating, COUNT(*) AS cnt FROM analysis_images GROUP BY rating;",
```

- [ ] **Step 3: v5 のテストを追記**

`migrations.rs` の `mod tests` 末尾（最後の `}` の直前）に追加する。

```rust
    #[test]
    fn v5_creates_tag_and_analysis_objects() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 5);
        for name in [
            "tags", "image_tags", "analysis_params", "analysis_excluded_tags",
            "analysis_scope", "tag_frequency", "tag_rating_lift",
            "tag_rating_distribution", "scope_rating_distribution",
        ] {
            let c: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [name], |r| r.get(0))
                .unwrap();
            assert!(c >= 1, "missing object: {name}");
        }
        // analysis_params は1行 seed 済み。
        let p: i64 = conn.query_row("SELECT count(*) FROM analysis_params", [], |r| r.get(0)).unwrap();
        assert_eq!(p, 1);
        // 除外リストの seed が入っている。
        let masterpiece: i64 = conn
            .query_row("SELECT count(*) FROM analysis_excluded_tags WHERE name='masterpiece'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(masterpiece, 1);
    }
```

- [ ] **Step 4: テスト実行**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::migrations`
Expected: PASS（既存テスト＋ `v5_creates_tag_and_analysis_objects`）。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): タグ・分析テーブルとView（マイグレーション v5）を追加"
```

---

## Task 2: タグ抽出の純粋関数 `extract_tags`

**Files:**
- Create: `src-tauri/src/parser/tags.rs`
- Modify: `src-tauri/src/parser/mod.rs`

- [ ] **Step 1: `parser/mod.rs` にモジュール登録**

`src-tauri/src/parser/mod.rs` の先頭 `pub mod a1111;` 群に1行追加する。

```rust
pub mod tags;
```

- [ ] **Step 2: 失敗するテスト付きで `parser/tags.rs` を作成**

`src-tauri/src/parser/tags.rs` を新規作成。まず関数シグネチャと型だけ置き、テストを書く。

```rust
/// タグの出現元。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagKind {
    Prompt,
    Negative,
    Unclassified,
}

impl TagKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TagKind::Prompt => "prompt",
            TagKind::Negative => "negative",
            TagKind::Unclassified => "unclassified",
        }
    }
}

/// positive/negative テキストと source_tool から (正規化タグ名, kind) を抽出する純粋関数。
/// スキャン時と backfill で共用する。
pub fn extract_tags(
    positive: Option<&str>,
    negative: Option<&str>,
    source_tool: &str,
) -> Vec<(String, TagKind)> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[(String, TagKind)], kind: TagKind) -> Vec<String> {
        v.iter().filter(|(_, k)| *k == kind).map(|(n, _)| n.clone()).collect()
    }

    #[test]
    fn a1111_splits_positive_and_negative() {
        let v = extract_tags(Some("masterpiece, 1girl, forest"), Some("blurry, lowres"), "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["masterpiece", "1girl", "forest"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["blurry", "lowres"]);
    }

    #[test]
    fn comfyui_positive_is_unclassified() {
        let v = extract_tags(Some("neon city, rain"), None, "comfyui");
        assert_eq!(names(&v, TagKind::Unclassified), vec!["neon city", "rain"]);
        assert!(names(&v, TagKind::Prompt).is_empty());
    }

    #[test]
    fn unknown_tool_yields_nothing() {
        assert!(extract_tags(Some("anything"), Some("x"), "unknown").is_empty());
    }

    #[test]
    fn lowercases_and_unifies_underscore() {
        let v = extract_tags(Some("Long_Hair, BlueSky"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["long hair", "bluesky"]);
    }

    #[test]
    fn strips_emphasis_and_weight_syntax() {
        let v = extract_tags(Some("(masterpiece:1.3), (detailed), [soft], ((cat))"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["masterpiece", "detailed", "soft", "cat"]);
    }

    #[test]
    fn negative_weight_moves_to_negative_kind() {
        let v = extract_tags(Some("good, (bad:-1)"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["good"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["bad"]);
    }

    #[test]
    fn lora_is_sign_encoded() {
        let v = extract_tags(Some("<lora:foo:0.8>, <lora:bar:-0.5>, <lora:baz>"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["<lora:foo:+>", "<lora:baz:+>"]);
        assert_eq!(names(&v, TagKind::Negative), vec!["<lora:bar:->"]);
    }

    #[test]
    fn break_keyword_is_dropped() {
        let v = extract_tags(Some("cat, BREAK, dog"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat", "dog"]);
    }

    #[test]
    fn dedups_within_field() {
        let v = extract_tags(Some("cat, cat, Cat"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat"]);
    }

    #[test]
    fn empty_tokens_dropped() {
        let v = extract_tags(Some("cat, , ,dog,"), None, "a1111");
        assert_eq!(names(&v, TagKind::Prompt), vec!["cat", "dog"]);
    }
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::tags`
Expected: FAIL（`todo!()` でパニック）。

- [ ] **Step 4: `extract_tags` を実装**

`parser/tags.rs` の `pub fn extract_tags(...) { todo!() }` を次の実装＋ヘルパで置き換える。

```rust
use std::collections::HashSet;

/// positive/negative テキストと source_tool から (正規化タグ名, kind) を抽出する純粋関数。
/// スキャン時と backfill で共用する。
pub fn extract_tags(
    positive: Option<&str>,
    negative: Option<&str>,
    source_tool: &str,
) -> Vec<(String, TagKind)> {
    let mut out: Vec<(String, TagKind)> = Vec::new();
    let mut seen: HashSet<(String, &'static str)> = HashSet::new();

    let positive_kind = match source_tool {
        "a1111" => Some(TagKind::Prompt),
        "comfyui" => Some(TagKind::Unclassified),
        _ => None,
    };
    if let (Some(text), Some(base)) = (positive, positive_kind) {
        collect_field(text, base, &mut out, &mut seen);
    }
    if source_tool == "a1111" {
        if let Some(text) = negative {
            collect_field(text, TagKind::Negative, &mut out, &mut seen);
        }
    }
    out
}

fn collect_field(
    text: &str,
    base: TagKind,
    out: &mut Vec<(String, TagKind)>,
    seen: &mut HashSet<(String, &'static str)>,
) {
    for raw in text.split(',') {
        if let Some((name, kind)) = normalize_token(raw, base) {
            if seen.insert((name.clone(), kind.as_str())) {
                out.push((name, kind));
            }
        }
    }
}

/// 1トークンを正規化し (タグ名, kind) を返す。空・BREAK は None。
fn normalize_token(raw: &str, base: TagKind) -> Option<(String, TagKind)> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    // LoRA / LyCORIS 等: <type:name:weight>（weight 省略可）
    if let Some(inner) = t.strip_prefix('<').and_then(|s| s.strip_suffix('>')) {
        let parts: Vec<&str> = inner.splitn(3, ':').collect();
        if parts.len() >= 2 {
            let weight: f64 = parts.get(2).and_then(|w| w.trim().parse().ok()).unwrap_or(1.0);
            let sign = if weight < 0.0 { '-' } else { '+' };
            let kind = if weight < 0.0 { TagKind::Negative } else { base };
            let canon = format!("<{}:{}:{}>", parts[0], parts[1], sign);
            return Some((finalize(&canon), kind));
        }
        return None;
    }
    let (core, weight) = strip_emphasis(t);
    let core = core.trim();
    if core.is_empty() || core.eq_ignore_ascii_case("BREAK") {
        return None;
    }
    let kind = if weight < 0.0 { TagKind::Negative } else { base };
    Some((finalize(core), kind))
}

/// 先頭/末尾の () [] を再帰的に剥がし、(tag:weight) の数値重みを取り出す。
/// [tag] は減衰だが正の重み扱い（kind を変えない）。
fn strip_emphasis(t: &str) -> (String, f64) {
    let mut s = t.trim();
    let mut weight = 1.0_f64;
    loop {
        if let Some(inner) = s.strip_prefix('(').and_then(|x| x.strip_suffix(')')) {
            match split_trailing_weight(inner) {
                Some((head, w)) => {
                    weight = w;
                    s = head.trim();
                }
                None => s = inner.trim(),
            }
            continue;
        }
        if let Some(inner) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            match split_trailing_weight(inner) {
                Some((head, _)) => s = head.trim(),
                None => s = inner.trim(),
            }
            continue;
        }
        break;
    }
    (s.to_string(), weight)
}

/// "tag:1.3" のように末尾が数値なら (head, weight) を返す。
fn split_trailing_weight(inner: &str) -> Option<(&str, f64)> {
    let idx = inner.rfind(':')?;
    let w: f64 = inner[idx + 1..].trim().parse().ok()?;
    Some((&inner[..idx], w))
}

/// 小文字化 + アンダースコア→空白 + 連続空白の畳み込み。
fn finalize(s: &str) -> String {
    s.to_ascii_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::tags`
Expected: PASS（全10テスト）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/parser/tags.rs src-tauri/src/parser/mod.rs
git commit -m "feat(parser): プロンプトをタグへ正規化する extract_tags を追加"
```

---

## Task 3: DB タグ紐付け層 `db/tags.rs`

**Files:**
- Create: `src-tauri/src/db/tags.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: `db/mod.rs` にモジュール登録**

`src-tauri/src/db/mod.rs` の `pub mod settings;` の後に追加する。

```rust
pub mod tags;
```

- [ ] **Step 2: 失敗するテスト付きで `db/tags.rs` を作成**

```rust
use rusqlite::{params, Connection};

/// タグ名から id を引く。無ければ作成する。
pub fn get_or_create_tag(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    todo!()
}

/// 画像のタグ紐付けを置き換える（全削除→挿入）。tags は (name, kind) の並び。
pub fn replace_image_tags(
    conn: &Connection,
    image_id: i64,
    tags: &[(&str, &str)],
) -> rusqlite::Result<()> {
    todo!()
}

/// backfill 用: 全画像の (id, positive, negative, source_tool)。
pub fn image_tag_sources(
    conn: &Connection,
) -> rusqlite::Result<Vec<(i64, Option<String>, Option<String>, String)>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, source_tool)
             VALUES (1, '/d/a.png', 'a.png', 1, 1, 4, 4, 16, 'png', 'a1111')",
            [],
        )
        .unwrap();
        c
    }

    #[test]
    fn get_or_create_is_idempotent() {
        let c = conn();
        let id1 = get_or_create_tag(&c, "forest").unwrap();
        let id2 = get_or_create_tag(&c, "forest").unwrap();
        assert_eq!(id1, id2);
        let n: i64 = c.query_row("SELECT count(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn replace_inserts_and_replaces() {
        let c = conn();
        replace_image_tags(&c, 1, &[("forest", "prompt"), ("blurry", "negative")]).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags WHERE image_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        // 置き換え: 旧紐付けは消え、新しい1件だけになる。
        replace_image_tags(&c, 1, &[("cat", "prompt")]).unwrap();
        let names: Vec<String> = {
            let mut stmt = c
                .prepare("SELECT t.name FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE it.image_id = 1")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(names, vec!["cat"]);
    }

    #[test]
    fn deleting_image_cascades_to_image_tags() {
        let c = conn();
        replace_image_tags(&c, 1, &[("forest", "prompt")]).unwrap();
        c.execute("DELETE FROM images WHERE id = 1", []).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn image_tag_sources_returns_rows() {
        let c = conn();
        c.execute("UPDATE images SET positive = 'a, b' WHERE id = 1", []).unwrap();
        let rows = image_tag_sources(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[0].1.as_deref(), Some("a, b"));
        assert_eq!(rows[0].3, "a1111");
    }
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tags`
Expected: FAIL（`todo!()`）。

- [ ] **Step 4: 実装で `todo!()` を置き換える**

```rust
/// タグ名から id を引く。無ければ作成する。
pub fn get_or_create_tag(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![name])?;
    conn.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))
}

/// 画像のタグ紐付けを置き換える（全削除→挿入）。tags は (name, kind) の並び。
pub fn replace_image_tags(
    conn: &Connection,
    image_id: i64,
    tags: &[(&str, &str)],
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM image_tags WHERE image_id = ?1", params![image_id])?;
    for (name, kind) in tags {
        let tag_id = get_or_create_tag(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO image_tags (image_id, tag_id, kind) VALUES (?1, ?2, ?3)",
            params![image_id, tag_id, kind],
        )?;
    }
    Ok(())
}

/// backfill 用: 全画像の (id, positive, negative, source_tool)。
pub fn image_tag_sources(
    conn: &Connection,
) -> rusqlite::Result<Vec<(i64, Option<String>, Option<String>, String)>> {
    let mut stmt = conn.prepare("SELECT id, positive, negative, source_tool FROM images")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    rows.collect()
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tags`
Expected: PASS（全4テスト）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/db/tags.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): 画像→タグ紐付けの get_or_create/replace_image_tags を追加"
```

---

## Task 4: 起動時 backfill `backfill.rs`

**Files:**
- Create: `src-tauri/src/backfill.rs`
- Modify: `src-tauri/src/lib.rs`（モジュール宣言のみ。setup 呼び出しは Task 6）

- [ ] **Step 1: `lib.rs` にモジュール宣言を追加**

`src-tauri/src/lib.rs` の先頭モジュール群（`mod commands;` 等）に追加する。

```rust
mod backfill;
```

- [ ] **Step 2: 失敗するテスト付きで `backfill.rs` を作成**

```rust
use crate::db::{settings, tags};
use crate::parser::tags::extract_tags;
use rusqlite::Connection;

const FLAG: &str = "tags_backfilled";

/// 起動時に一度だけ、既存画像の positive/negative 列からタグを生成する。
/// すでに実行済み（settings フラグあり）なら何もしない。
pub fn run_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute("INSERT INTO directories (path, label, recursive) VALUES ('/d','d',1)", []).unwrap();
        c
    }

    fn add_image(c: &Connection, path: &str, pos: &str, neg: Option<&str>, tool: &str) {
        c.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, source_tool, positive, negative)
             VALUES (1, ?1, ?1, 1, 1, 4, 4, 16, 'png', ?2, ?3, ?4)",
            rusqlite::params![path, tool, pos, neg],
        )
        .unwrap();
    }

    #[test]
    fn backfills_existing_images_and_sets_flag() {
        let c = conn();
        add_image(&c, "/d/a.png", "forest, 1girl", Some("blurry"), "a1111");
        add_image(&c, "/d/b.png", "neon city", None, "comfyui");

        run_if_needed(&c).unwrap();

        let prompt: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='prompt'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prompt, 2); // forest, 1girl
        let neg: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='negative'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(neg, 1); // blurry
        let unclassified: i64 = c
            .query_row("SELECT count(*) FROM image_tags WHERE kind='unclassified'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(unclassified, 1); // neon city
        assert_eq!(settings::get(&c, "tags_backfilled").unwrap(), Some("1".to_string()));
    }

    #[test]
    fn is_noop_when_already_done() {
        let c = conn();
        settings::set(&c, "tags_backfilled", "1").unwrap();
        add_image(&c, "/d/a.png", "forest", None, "a1111");
        run_if_needed(&c).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "backfill 済みなら触らない");
    }
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backfill`
Expected: FAIL（`todo!()`）。

- [ ] **Step 4: 実装で `todo!()` を置き換える**

```rust
/// 起動時に一度だけ、既存画像の positive/negative 列からタグを生成する。
/// すでに実行済み（settings フラグあり）なら何もしない。
pub fn run_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    if settings::get(conn, FLAG)?.is_some() {
        return Ok(());
    }
    let sources = tags::image_tag_sources(conn)?;
    for (id, positive, negative, source_tool) in &sources {
        let extracted = extract_tags(positive.as_deref(), negative.as_deref(), source_tool);
        let pairs: Vec<(&str, &str)> =
            extracted.iter().map(|(n, k)| (n.as_str(), k.as_str())).collect();
        tags::replace_image_tags(conn, *id, &pairs)?;
    }
    settings::set(conn, FLAG, "1")?;
    Ok(())
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backfill`
Expected: PASS（2テスト）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/backfill.rs src-tauri/src/lib.rs
git commit -m "feat(backfill): 既存画像の列からタグを一括生成する起動時backfillを追加"
```

---

## Task 5: スキャン時のタグ紐付け

**Files:**
- Modify: `src-tauri/src/scanner.rs`

- [ ] **Step 1: `FileOutcome::Upsert` をタグ同梱の構造体バリアントへ変更**

`src-tauri/src/scanner.rs` の `enum FileOutcome` を次に変更する。

```rust
/// 1ファイル分の並列処理の結果。DB 書き込みは呼び出し側（writer）で逐次行う。
enum FileOutcome {
    /// 未変更。was_missing が真なら missing フラグ解除のみ必要。
    Unchanged { id: i64, was_missing: bool },
    /// 新規/変更。parse + サムネ済み。タグ紐付けは writer で行う。
    Upsert {
        image: Box<images::NewImage>,
        tags: Vec<(String, crate::parser::tags::TagKind)>,
    },
    /// stat / parse 失敗（集計しない＝現状踏襲）。
    Failed,
}
```

- [ ] **Step 2: `process_one` でタグを算出して返す**

`process_one` 内の `Decision::NeedsParse => { ... }` ブロックを次に変更する（`parsed` を構築後、`NewImage` を作る前にタグを抽出する）。

```rust
        Decision::NeedsParse => {
            let parsed = match parser::parse(file) {
                Ok(p) => p,
                Err(_) => return FileOutcome::Failed,
            };
            let thumb_path = thumbnail::generate_thumbnail(file, thumb_dir)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            let rating = parser::xmp::read_rating_sidecar(file);
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            // NewImage に move する前にタグを抽出する。
            let tags = parser::tags::extract_tags(
                parsed.positive.as_deref(),
                parsed.negative.as_deref(),
                &parsed.source_tool,
            );
            FileOutcome::Upsert {
                image: Box::new(images::NewImage {
                    directory_id: 0, // writer 側で dir.id を設定する
                    path: path_str.to_string(),
                    filename,
                    size,
                    mtime,
                    created_at: Some(created),
                    modified_at: Some(mtime),
                    width: parsed.width as i64,
                    height: parsed.height as i64,
                    rating,
                    format: parsed.format,
                    thumb_path,
                    raw_parameters: parsed.raw_parameters,
                    positive: parsed.positive,
                    negative: parsed.negative,
                    model: parsed.model,
                    sampler: parsed.sampler,
                    steps: parsed.steps,
                    seed: parsed.seed,
                    cfg: parsed.cfg,
                    source_tool: parsed.source_tool,
                    comfy_workflow: parsed.comfy_workflow,
                }),
                tags,
            }
        }
```

- [ ] **Step 3: writer フェーズでタグを紐付ける**

`scan_directory` の書き込みフェーズ、`match outcome` の `FileOutcome::Upsert(...)` アームを次に置き換える。

```rust
                FileOutcome::Upsert { mut image, tags } => {
                    image.directory_id = dir.id;
                    let image_id = images::upsert(&c, &image)?;
                    let pairs: Vec<(&str, &str)> =
                        tags.iter().map(|(n, k)| (n.as_str(), k.as_str())).collect();
                    crate::db::tags::replace_image_tags(&c, image_id, &pairs)?;
                    summary.added_or_updated += 1;
                }
```

- [ ] **Step 4: スキャンがタグを生成するテストを追記**

`scanner.rs` の `mod tests` 末尾（最後の `}` の直前）に追加する。

```rust
    #[test]
    fn scan_links_tags_for_a1111_image() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(
            &base.join("a.png"),
            "forest, 1girl\nNegative prompt: blurry\nSteps: 10, Seed: 1",
        );
        scan_directory(&c, &dir, &thumb_dir, 1000, 4, |_| {}).unwrap();

        let conn = c.lock().unwrap();
        let prompt: i64 = conn
            .query_row("SELECT count(*) FROM image_tags WHERE kind='prompt'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prompt, 2); // forest, 1girl
        let neg: i64 = conn
            .query_row("SELECT count(*) FROM image_tags WHERE kind='negative'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(neg, 1); // blurry
        drop(conn);
        std::fs::remove_dir_all(&base).ok();
    }
```

- [ ] **Step 5: 全スキャンテストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scanner`
Expected: PASS（既存テスト＋ `scan_links_tags_for_a1111_image`）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/scanner.rs
git commit -m "feat(scanner): スキャン時に画像→タグの紐付けを行う"
```

---

## Task 6: 起動時に backfill を呼ぶ

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: setup で DB を開いた直後に backfill を実行**

`src-tauri/src/lib.rs` の setup クロージャ内、`let conn = db::open(&dir.join("library.db"))?;` の直後（`app.manage(...)` の前）に追加する。

```rust
            // 既存画像のタグ後付け（一度だけ）。DBを manage する前に所有権を持ったまま実行する。
            backfill::run_if_needed(&conn).map_err(|e| format!("backfill failed: {e}"))?;
```

- [ ] **Step 2: コンパイルを確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 成功（警告は可）。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(backfill): 起動時にタグの後付けを実行する"
```

---

## Task 7: 分析クエリ層（スコープ／パラメータ設定）

**Files:**
- Create: `src-tauri/src/db/analysis.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: `db/mod.rs` にモジュール登録**

`src-tauri/src/db/mod.rs` の `pub mod tags;` の後に追加する。

```rust
pub mod analysis;
```

- [ ] **Step 2: 失敗するテスト付きで `db/analysis.rs` を作成（スコープ／パラメータ部）**

```rust
use crate::query::{compile, parse};
use rusqlite::{params, params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 分析スコープを設定する。None=全体（空テーブル）、Some(query)=フィルタ範囲。
pub fn set_scope(conn: &Connection, query: Option<&str>) -> rusqlite::Result<()> {
    todo!()
}

/// 分析パラメータ（1行）を更新する。
pub fn set_params(
    conn: &Connection,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
) -> rusqlite::Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{images::NewImage, migrations, tags};

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&c).unwrap();
        c.execute("INSERT INTO directories (path, label, recursive) VALUES ('/d','d',1)", []).unwrap();
        c
    }

    /// 画像を1件入れてタグを紐付け、id を返す。
    fn add(c: &Connection, path: &str, rating: Option<i64>, prompt_tags: &[&str]) -> i64 {
        let id = crate::db::images::upsert(
            c,
            &NewImage {
                directory_id: 1,
                path: path.to_string(),
                filename: path.to_string(),
                size: 1,
                mtime: 1,
                width: 4,
                height: 4,
                rating,
                format: "png".into(),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let pairs: Vec<(&str, &str)> = prompt_tags.iter().map(|t| (*t, "prompt")).collect();
        tags::replace_image_tags(c, id, &pairs).unwrap();
        id
    }

    #[test]
    fn set_scope_none_clears_table() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["forest"]);
        set_scope(&c, Some("forest")).unwrap();
        let n1: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n1, 1);
        set_scope(&c, None).unwrap();
        let n2: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n2, 0);
    }

    #[test]
    fn set_scope_query_inserts_matching_ids() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["forest"]);
        add(&c, "/d/b.png", Some(3), &["mountain"]);
        set_scope(&c, Some("rating:>=4")).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM analysis_scope", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn set_params_updates_row() {
        let c = conn();
        set_params(&c, false, 25, 7.5).unwrap();
        let (ex, mn, pw): (i64, i64, f64) = c
            .query_row("SELECT apply_exclusion, min_rated_count, prior_weight FROM analysis_params WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((ex, mn), (0, 25));
        assert!((pw - 7.5).abs() < 1e-9);
    }
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::analysis`
Expected: FAIL（`todo!()`）。

- [ ] **Step 4: `set_scope` / `set_params` を実装**

`todo!()` を置き換える。

```rust
/// 分析スコープを設定する。None=全体（空テーブル）、Some(query)=フィルタ範囲。
pub fn set_scope(conn: &Connection, query: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM analysis_scope", [])?;
    if let Some(q) = query {
        let cf = compile::compile(&parse::parse(q));
        let sql = format!(
            "INSERT INTO analysis_scope (image_id) \
             SELECT id FROM images WHERE ({}) \
             AND directory_id IN (SELECT id FROM directories WHERE visible = 1)",
            cf.where_sql
        );
        conn.execute(&sql, params_from_iter(cf.params))?;
    }
    Ok(())
}

/// 分析パラメータ（1行）を更新する。
pub fn set_params(
    conn: &Connection,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE analysis_params SET apply_exclusion = ?1, min_rated_count = ?2, prior_weight = ?3 WHERE id = 1",
        params![apply_exclusion as i64, min_rated_count, prior_weight],
    )?;
    Ok(())
}

/// LIKE のワイルドカードをエスケープする（name_filter 用）。
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}
```

> `escape_like` は Task 8 の `tag_frequency` で使う。未使用警告は Task 8 完了時に解消する。

- [ ] **Step 5: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::analysis`
Expected: PASS（3テスト）。`escape_like` の dead_code 警告が出るが許容（次タスクで使用）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/db/analysis.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): 分析スコープ/パラメータ設定（set_scope/set_params）を追加"
```

---

## Task 8: 分析クエリ層（頻度一覧・原因タグ）

**Files:**
- Modify: `src-tauri/src/db/analysis.rs`

- [ ] **Step 1: 型と関数シグネチャ＋失敗テストを追加**

`db/analysis.rs` の `escape_like` 関数の後（`#[cfg(test)]` の前）に追加する。

```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagFreq {
    pub tag_id: i64,
    pub name: String,
    pub image_count: i64,
}

/// 頻度一覧。sort は "count"（既定・降順）か "name"（昇順）。
pub fn tag_frequency(
    conn: &Connection,
    name_filter: Option<&str>,
    sort: &str,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<TagFreq>> {
    let order = if sort == "name" { "name ASC" } else { "image_count DESC, name ASC" };
    let mut params: Vec<Value> = Vec::new();
    let filter_sql = match name_filter {
        Some(f) if !f.is_empty() => {
            params.push(Value::Text(format!("%{}%", escape_like(f))));
            "WHERE name LIKE ? ESCAPE '\\'".to_string()
        }
        _ => String::new(),
    };
    params.push(Value::Integer(limit));
    params.push(Value::Integer(offset));
    let sql = format!(
        "SELECT tag_id, name, image_count FROM tag_frequency {filter_sql} ORDER BY {order} LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params), |r| {
        Ok(TagFreq { tag_id: r.get(0)?, name: r.get(1)?, image_count: r.get(2)? })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiftRow {
    pub tag_id: i64,
    pub name: String,
    pub rated_count: i64,
    pub raw_avg: Option<f64>,
    pub adjusted_avg: Option<f64>,
    pub overall_avg: Option<f64>,
}

/// 高/低評価原因タグ。direction は "high"（adjusted_avg 降順）か "low"（昇順）。
pub fn rating_lift(conn: &Connection, direction: &str, limit: i64) -> rusqlite::Result<Vec<LiftRow>> {
    let order = if direction == "low" { "adjusted_avg ASC" } else { "adjusted_avg DESC" };
    let sql = format!(
        "SELECT tag_id, name, rated_count, raw_avg, adjusted_avg, overall_avg \
         FROM tag_rating_lift ORDER BY {order}, name ASC LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit], |r| {
        Ok(LiftRow {
            tag_id: r.get(0)?,
            name: r.get(1)?,
            rated_count: r.get(2)?,
            raw_avg: r.get(3)?,
            adjusted_avg: r.get(4)?,
            overall_avg: r.get(5)?,
        })
    })?;
    rows.collect()
}
```

`#[cfg(test)] mod tests` の中（`set_params_updates_row` の後）にテストを追加する。

```rust
    #[test]
    fn frequency_excludes_negative_and_excluded_list() {
        let c = conn();
        // forest を2枚、blurry は negative のみ。
        let a = add(&c, "/d/a.png", Some(5), &["forest"]);
        let b = add(&c, "/d/b.png", Some(4), &["forest"]);
        let _ = (a, b);
        // c 画像に negative の blurry を付与。
        let cid = add(&c, "/d/c.png", Some(2), &[]);
        tags::replace_image_tags(&c, cid, &[("blurry", "negative")]).unwrap();
        // masterpiece は除外リスト入り。
        add(&c, "/d/d.png", Some(5), &["masterpiece"]);

        set_scope(&c, None).unwrap();
        set_params(&c, true, 10, 10.0).unwrap();
        let freq = tag_frequency(&c, None, "count", 100, 0).unwrap();
        let names: Vec<&str> = freq.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["forest"]); // blurry(negative) と masterpiece(除外) は出ない
        assert_eq!(freq[0].image_count, 2);
    }

    #[test]
    fn frequency_respects_apply_exclusion_off() {
        let c = conn();
        add(&c, "/d/a.png", Some(5), &["masterpiece"]);
        set_scope(&c, None).unwrap();
        set_params(&c, false, 10, 10.0).unwrap(); // 除外無効化
        let freq = tag_frequency(&c, None, "count", 100, 0).unwrap();
        assert_eq!(freq.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["masterpiece"]);
    }

    #[test]
    fn rating_lift_uses_shrinkage_and_threshold() {
        let c = conn();
        // good: 4枚すべて★5。overall は good4枚(5)＋bad1枚(1)=平均4.2。
        for i in 0..4 {
            add(&c, &format!("/d/g{i}.png"), Some(5), &["good"]);
        }
        add(&c, "/d/bad.png", Some(1), &["bad"]);
        set_scope(&c, None).unwrap();
        // しきい値3, 事前重み m=2。bad(1枚)はしきい値未満で出ない。
        set_params(&c, true, 3, 2.0).unwrap();
        let high = rating_lift(&c, "high", 10).unwrap();
        assert_eq!(high.len(), 1);
        assert_eq!(high[0].name, "good");
        assert_eq!(high[0].rated_count, 4);
        // adjusted = (4*5 + 2*4.2)/(4+2) = 28.4/6 ≒ 4.733...
        let adj = high[0].adjusted_avg.unwrap();
        assert!((adj - 4.7333333).abs() < 1e-4, "adjusted_avg = {adj}");
        assert!((high[0].overall_avg.unwrap() - 4.2).abs() < 1e-9);
    }
```

- [ ] **Step 2: テストが失敗することを確認（実装はこのタスクで完結するため、まずビルド／テストでシグネチャの整合を確認）**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::analysis`
Expected: PASS。Step 1 で実装ごと記述しているため、ここで通る。通らない場合はコンパイルエラーを修正する。

> 注: 本タスクは「型・関数・テストを同時に追加」する構成。Step 1 のコードが正しければそのまま PASS する。TDD の赤を見たい場合は、Step 1 の関数本体を一時的に `todo!()` にしてから Run → FAIL を確認し、本体を戻す。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/db/analysis.rs
git commit -m "feat(db): タグ頻度一覧と高/低原因タグ（縮約平均）のクエリを追加"
```

---

## Task 9: 分析クエリ層（特定タグ分析・除外リストCRUD）

**Files:**
- Modify: `src-tauri/src/db/analysis.rs`

- [ ] **Step 1: 型・関数・テストを追加**

`db/analysis.rs` の `rating_lift` の後（`#[cfg(test)]` の前）に追加する。

```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RatingBucket {
    pub rating: Option<i64>,
    pub cnt: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagRatingAnalysis {
    pub has: Vec<RatingBucket>,
    pub without: Vec<RatingBucket>,
    pub has_avg: Option<f64>,
    pub without_avg: Option<f64>,
}

/// 特定タグの「ある/ない」レーティング別件数と平均（評価済みのみ平均）。
pub fn tag_rating_analysis(conn: &Connection, tag_id: i64) -> rusqlite::Result<TagRatingAnalysis> {
    use std::collections::HashMap;
    let mut has_map: HashMap<Option<i64>, i64> = HashMap::new();
    {
        let mut stmt =
            conn.prepare("SELECT rating, cnt FROM tag_rating_distribution WHERE tag_id = ?1")?;
        let rows = stmt.query_map([tag_id], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (rt, cnt) = row?;
            has_map.insert(rt, cnt);
        }
    }
    let mut scope_map: HashMap<Option<i64>, i64> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT rating, cnt FROM scope_rating_distribution")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (rt, cnt) = row?;
            scope_map.insert(rt, cnt);
        }
    }
    let mut keys: Vec<Option<i64>> = scope_map.keys().chain(has_map.keys()).cloned().collect();
    keys.sort();
    keys.dedup();

    let mut has = Vec::new();
    let mut without = Vec::new();
    for k in keys {
        let h = *has_map.get(&k).unwrap_or(&0);
        let s = *scope_map.get(&k).unwrap_or(&0);
        let w = (s - h).max(0);
        has.push(RatingBucket { rating: k, cnt: h });
        without.push(RatingBucket { rating: k, cnt: w });
    }
    let avg = |buckets: &[RatingBucket]| -> Option<f64> {
        let mut sum = 0i64;
        let mut n = 0i64;
        for b in buckets {
            if let Some(r) = b.rating {
                sum += r * b.cnt;
                n += b.cnt;
            }
        }
        if n > 0 { Some(sum as f64 / n as f64) } else { None }
    };
    let has_avg = avg(&has);
    let without_avg = avg(&without);
    Ok(TagRatingAnalysis { has, without, has_avg, without_avg })
}

/// 除外タグ一覧（名前昇順）。
pub fn list_excluded(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM analysis_excluded_tags ORDER BY name")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// 除外タグを追加する（既存なら無視）。
pub fn add_excluded(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT OR IGNORE INTO analysis_excluded_tags(name) VALUES (?1)", params![name])?;
    Ok(())
}

/// 除外タグを削除する。
pub fn remove_excluded(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM analysis_excluded_tags WHERE name = ?1", params![name])?;
    Ok(())
}
```

`mod tests` 内（`rating_lift_uses_shrinkage_and_threshold` の後）にテストを追加する。

```rust
    #[test]
    fn tag_rating_analysis_has_and_without() {
        let c = conn();
        // forest: ★5, ★3。non-forest: ★4, 未評価。
        add(&c, "/d/a.png", Some(5), &["forest"]);
        add(&c, "/d/b.png", Some(3), &["forest"]);
        add(&c, "/d/c.png", Some(4), &["mountain"]);
        add(&c, "/d/d.png", None, &["mountain"]);
        set_scope(&c, None).unwrap();
        set_params(&c, true, 1, 10.0).unwrap();
        let forest_id: i64 = c.query_row("SELECT id FROM tags WHERE name='forest'", [], |r| r.get(0)).unwrap();
        let a = tag_rating_analysis(&c, forest_id).unwrap();
        // has 平均 = (5+3)/2 = 4.0
        assert!((a.has_avg.unwrap() - 4.0).abs() < 1e-9);
        // without 平均 = 4.0（★4の1枚のみ、未評価は除外）
        assert!((a.without_avg.unwrap() - 4.0).abs() < 1e-9);
        // has 合計件数 = 2、without 合計件数 = 2（★4 と 未評価）
        let has_total: i64 = a.has.iter().map(|b| b.cnt).sum();
        let without_total: i64 = a.without.iter().map(|b| b.cnt).sum();
        assert_eq!(has_total, 2);
        assert_eq!(without_total, 2);
    }

    #[test]
    fn excluded_list_crud() {
        let c = conn();
        add_excluded(&c, "score 9").unwrap();
        add_excluded(&c, "score 9").unwrap(); // 重複は無視
        assert!(list_excluded(&c).unwrap().contains(&"score 9".to_string()));
        remove_excluded(&c, "masterpiece").unwrap();
        assert!(!list_excluded(&c).unwrap().contains(&"masterpiece".to_string()));
    }
```

- [ ] **Step 2: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::analysis`
Expected: PASS（全テスト）。

- [ ] **Step 3: clippy / fmt 確認（周囲のスタイルに手で合わせる方針。`cargo fmt` 全体適用はしない）**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml`
Expected: 重大な警告なし（`escape_like` の dead_code 警告は Task 8 で解消済み）。

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/db/analysis.rs
git commit -m "feat(db): 特定タグのレーティング分析と除外リストCRUDを追加"
```

---

## Task 10: 分析コマンド

**Files:**
- Create: `src-tauri/src/commands/analysis.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: `commands/mod.rs` にモジュール登録**

`src-tauri/src/commands/mod.rs` に追加する。

```rust
pub mod analysis;
```

- [ ] **Step 2: `commands/analysis.rs` を作成**

各コマンドはロック内でスコープ／パラメータを設定してから View を読む（自己完結・原子的）。

```rust
use crate::db::analysis::{self, LiftRow, TagFreq, TagRatingAnalysis};
use crate::db::Db;
use tauri::State;

/// 頻度一覧。scope=None で全体、Some(query) でフィルタ範囲。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn analysis_tag_frequency(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    name_filter: Option<String>,
    sort: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<TagFreq>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::tag_frequency(&conn, name_filter.as_deref(), &sort, limit, offset)
        .map_err(|e| e.to_string())
}

/// 高/低評価原因タグ。
#[tauri::command]
pub fn analysis_rating_lift(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    direction: String,
    limit: i64,
) -> Result<Vec<LiftRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::rating_lift(&conn, &direction, limit).map_err(|e| e.to_string())
}

/// 特定タグの「ある/ない」レーティング分析。
#[tauri::command]
pub fn analysis_tag_rating(
    db: State<Db>,
    scope: Option<String>,
    apply_exclusion: bool,
    min_rated_count: i64,
    prior_weight: f64,
    tag_id: i64,
) -> Result<TagRatingAnalysis, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::set_scope(&conn, scope.as_deref()).map_err(|e| e.to_string())?;
    analysis::set_params(&conn, apply_exclusion, min_rated_count, prior_weight)
        .map_err(|e| e.to_string())?;
    analysis::tag_rating_analysis(&conn, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_list_excluded(db: State<Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::list_excluded(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_add_excluded(db: State<Db>, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::add_excluded(&conn, name.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn analysis_remove_excluded(db: State<Db>, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    analysis::remove_excluded(&conn, &name).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: `lib.rs` の `invoke_handler` にコマンドを登録**

`src-tauri/src/lib.rs` の `tauri::generate_handler![ ... ]` 内、`commands::fs::write_xmp_rating,` の後に追加する。

```rust
            commands::analysis::analysis_tag_frequency,
            commands::analysis::analysis_rating_lift,
            commands::analysis::analysis_tag_rating,
            commands::analysis::analysis_list_excluded,
            commands::analysis::analysis_add_excluded,
            commands::analysis::analysis_remove_excluded,
```

- [ ] **Step 4: コンパイル確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 成功。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/commands/analysis.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): 分析コマンド（頻度/原因/特定タグ/除外CRUD）を追加・登録"
```

---

## Task 11: フロント型定義と API ラッパ

**Files:**
- Modify: `src/types.ts`
- Create: `src/api/analysis.ts`

- [ ] **Step 1: `src/types.ts` に分析系の型を追加（ファイル末尾に追記）**

```typescript
export interface TagFreq {
  tag_id: number;
  name: string;
  image_count: number;
}

export interface LiftRow {
  tag_id: number;
  name: string;
  rated_count: number;
  raw_avg: number | null;
  adjusted_avg: number | null;
  overall_avg: number | null;
}

export interface RatingBucket {
  rating: number | null;
  cnt: number;
}

export interface TagRatingAnalysis {
  has: RatingBucket[];
  without: RatingBucket[];
  has_avg: number | null;
  without_avg: number | null;
}

export interface AnalysisParams {
  applyExclusion: boolean;
  minRatedCount: number;
  priorWeight: number;
}
```

- [ ] **Step 2: `src/api/analysis.ts` を作成**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { TagFreq, LiftRow, TagRatingAnalysis, AnalysisParams } from "../types";

/** scope が undefined のとき全体、文字列のときフィルタ範囲（クエリ）。 */
export const tagFrequency = (
  scope: string | undefined,
  p: AnalysisParams,
  nameFilter: string | undefined,
  sort: "count" | "name",
  limit: number,
  offset: number,
) =>
  invoke<TagFreq[]>("analysis_tag_frequency", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    nameFilter: nameFilter ?? null,
    sort,
    limit,
    offset,
  });

export const ratingLift = (
  scope: string | undefined,
  p: AnalysisParams,
  direction: "high" | "low",
  limit: number,
) =>
  invoke<LiftRow[]>("analysis_rating_lift", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    direction,
    limit,
  });

export const tagRating = (scope: string | undefined, p: AnalysisParams, tagId: number) =>
  invoke<TagRatingAnalysis>("analysis_tag_rating", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    tagId,
  });

export const listExcluded = () => invoke<string[]>("analysis_list_excluded");
export const addExcluded = (name: string) => invoke<void>("analysis_add_excluded", { name });
export const removeExcluded = (name: string) =>
  invoke<void>("analysis_remove_excluded", { name });
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/types.ts src/api/analysis.ts
git commit -m "feat(api): 分析機能のフロント型定義とAPIラッパを追加"
```

---

## Task 12: 分析ストア `useAnalysisStore`

**Files:**
- Create: `src/store/useAnalysisStore.ts`
- Create: `src/store/useAnalysisStore.test.ts`

- [ ] **Step 1: 失敗するテストを作成**

`src/store/useAnalysisStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/analysis", () => ({
  tagFrequency: vi.fn(async () => [{ tag_id: 1, name: "forest", image_count: 3 }]),
  ratingLift: vi.fn(async () => []),
  tagRating: vi.fn(async () => ({ has: [], without: [], has_avg: null, without_avg: null })),
  listExcluded: vi.fn(async () => ["masterpiece"]),
  addExcluded: vi.fn(async () => {}),
  removeExcluded: vi.fn(async () => {}),
}));

import { useAnalysisStore } from "./useAnalysisStore";
import { useQueryStore } from "./useQueryStore";
import * as api from "../api/analysis";

beforeEach(() => {
  useAnalysisStore.setState({
    open: false,
    tab: "frequency",
    scopeMode: "all",
    applyExclusion: true,
    minRatedCount: 10,
    priorWeight: 10,
    freq: [],
    freqSort: "count",
    cause: [],
    causeDirection: "high",
    selectedTag: null,
    tagAnalysis: null,
    excluded: [],
    nameFilter: "",
  });
  vi.clearAllMocks();
});

describe("useAnalysisStore", () => {
  it("scopeArg() は all のとき undefined、filter のとき現在クエリ", () => {
    useQueryStore.setState({ query: "rating:>=4" });
    expect(useAnalysisStore.getState().scopeArg()).toBeUndefined();
    useAnalysisStore.setState({ scopeMode: "filter" });
    expect(useAnalysisStore.getState().scopeArg()).toBe("rating:>=4");
  });

  it("toggleExclusion は applyExclusion を反転する", () => {
    useAnalysisStore.getState().toggleExclusion();
    expect(useAnalysisStore.getState().applyExclusion).toBe(false);
  });

  it("loadFrequency は API 結果を freq に格納する", async () => {
    await useAnalysisStore.getState().loadFrequency();
    expect(useAnalysisStore.getState().freq).toEqual([{ tag_id: 1, name: "forest", image_count: 3 }]);
    expect(api.tagFrequency).toHaveBeenCalledOnce();
  });

  it("toggleOpen は open を反転する", () => {
    useAnalysisStore.getState().toggleOpen();
    expect(useAnalysisStore.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/store/useAnalysisStore.test.ts`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: `useAnalysisStore.ts` を実装**

```typescript
import { create } from "zustand";
import type { TagFreq, LiftRow, TagRatingAnalysis, AnalysisParams } from "../types";
import * as api from "../api/analysis";
import { useQueryStore } from "./useQueryStore";

type Tab = "frequency" | "cause" | "excluded";
type ScopeMode = "all" | "filter";

interface AnalysisState {
  open: boolean;
  tab: Tab;
  scopeMode: ScopeMode;
  applyExclusion: boolean;
  minRatedCount: number;
  priorWeight: number;
  freq: TagFreq[];
  freqSort: "count" | "name";
  cause: LiftRow[];
  causeDirection: "high" | "low";
  selectedTag: { tagId: number; name: string } | null;
  tagAnalysis: TagRatingAnalysis | null;
  excluded: string[];
  nameFilter: string;
  // derived
  scopeArg: () => string | undefined;
  params: () => AnalysisParams;
  // actions
  toggleOpen: () => void;
  setOpen: (v: boolean) => void;
  setTab: (t: Tab) => void;
  setScopeMode: (m: ScopeMode) => void;
  toggleExclusion: () => void;
  setNameFilter: (s: string) => void;
  setFreqSort: (s: "count" | "name") => void;
  setCauseDirection: (d: "high" | "low") => void;
  setMinRatedCount: (n: number) => void;
  setPriorWeight: (n: number) => void;
  loadFrequency: () => Promise<void>;
  loadCause: () => Promise<void>;
  selectTag: (tagId: number, name: string) => Promise<void>;
  clearSelectedTag: () => void;
  loadExcluded: () => Promise<void>;
  addExcluded: (name: string) => Promise<void>;
  removeExcluded: (name: string) => Promise<void>;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  open: false,
  tab: "frequency",
  scopeMode: "all",
  applyExclusion: true,
  minRatedCount: 10,
  priorWeight: 10,
  freq: [],
  freqSort: "count",
  cause: [],
  causeDirection: "high",
  selectedTag: null,
  tagAnalysis: null,
  excluded: [],
  nameFilter: "",

  scopeArg: () =>
    get().scopeMode === "filter" ? useQueryStore.getState().query : undefined,
  params: () => ({
    applyExclusion: get().applyExclusion,
    minRatedCount: get().minRatedCount,
    priorWeight: get().priorWeight,
  }),

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (v) => set({ open: v }),
  setTab: (t) => set({ tab: t }),
  setScopeMode: (m) => set({ scopeMode: m }),
  toggleExclusion: () => set((s) => ({ applyExclusion: !s.applyExclusion })),
  setNameFilter: (s) => set({ nameFilter: s }),
  setFreqSort: (s) => set({ freqSort: s }),
  setCauseDirection: (d) => set({ causeDirection: d }),
  setMinRatedCount: (n) => set({ minRatedCount: n }),
  setPriorWeight: (n) => set({ priorWeight: n }),

  loadFrequency: async () => {
    const { scopeArg, params, nameFilter, freqSort } = get();
    const freq = await api.tagFrequency(scopeArg(), params(), nameFilter || undefined, freqSort, 500, 0);
    set({ freq });
  },
  loadCause: async () => {
    const { scopeArg, params, causeDirection } = get();
    const cause = await api.ratingLift(scopeArg(), params(), causeDirection, 100);
    set({ cause });
  },
  selectTag: async (tagId, name) => {
    const { scopeArg, params } = get();
    const tagAnalysis = await api.tagRating(scopeArg(), params(), tagId);
    set({ selectedTag: { tagId, name }, tagAnalysis });
  },
  clearSelectedTag: () => set({ selectedTag: null, tagAnalysis: null }),
  loadExcluded: async () => {
    set({ excluded: await api.listExcluded() });
  },
  addExcluded: async (name) => {
    await api.addExcluded(name);
    await get().loadExcluded();
  },
  removeExcluded: async (name) => {
    await api.removeExcluded(name);
    await get().loadExcluded();
  },
}));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/store/useAnalysisStore.test.ts`
Expected: PASS（4テスト）。

- [ ] **Step 5: コミット**

```bash
git add src/store/useAnalysisStore.ts src/store/useAnalysisStore.test.ts
git commit -m "feat(store): 分析ビューの状態を扱う useAnalysisStore を追加"
```

---

## Task 13: 頻度一覧テーブルと特定タグ分析コンポーネント

**Files:**
- Create: `src/components/TagRatingAnalysis.tsx`
- Create: `src/components/TagFrequencyTable.tsx`

- [ ] **Step 1: `TagRatingAnalysis.tsx` を作成**

選択タグの「ある/ない」分布と平均を表示し、戻るボタンで一覧へ。

```tsx
import { useAnalysisStore } from "../store/useAnalysisStore";

function ratingLabel(r: number | null): string {
  return r === null ? "未評価" : `★${r}`;
}

export function TagRatingAnalysis() {
  const selectedTag = useAnalysisStore((s) => s.selectedTag);
  const a = useAnalysisStore((s) => s.tagAnalysis);
  const clear = useAnalysisStore((s) => s.clearSelectedTag);
  if (!selectedTag || !a) return null;

  return (
    <div className="tag-rating-analysis">
      <button type="button" onClick={clear}>← 頻度一覧へ戻る</button>
      <h3>タグ「{selectedTag.name}」のレーティング分析</h3>
      <p>
        平均: ある = {a.has_avg?.toFixed(2) ?? "—"} / ない = {a.without_avg?.toFixed(2) ?? "—"}
      </p>
      <table>
        <thead>
          <tr>
            <th>レーティング</th>
            <th>ある（件数）</th>
            <th>ない（件数）</th>
          </tr>
        </thead>
        <tbody>
          {a.has.map((bucket, i) => (
            <tr key={i}>
              <td>{ratingLabel(bucket.rating)}</td>
              <td>{bucket.cnt}</td>
              <td>{a.without[i]?.cnt ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: `TagFrequencyTable.tsx` を作成**

頻度一覧。名前フィルタ、行クリックで特定タグ分析へドリルダウン。選択中はドリルダウンを表示。

```tsx
import { useEffect } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";
import { TagRatingAnalysis } from "./TagRatingAnalysis";

export function TagFrequencyTable() {
  const freq = useAnalysisStore((s) => s.freq);
  const nameFilter = useAnalysisStore((s) => s.nameFilter);
  const setNameFilter = useAnalysisStore((s) => s.setNameFilter);
  const freqSort = useAnalysisStore((s) => s.freqSort);
  const setFreqSort = useAnalysisStore((s) => s.setFreqSort);
  const loadFrequency = useAnalysisStore((s) => s.loadFrequency);
  const selectTag = useAnalysisStore((s) => s.selectTag);
  const selectedTag = useAnalysisStore((s) => s.selectedTag);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);

  // スコープ/除外/フィルタ/ソート変更時に再取得。
  useEffect(() => {
    void loadFrequency();
  }, [loadFrequency, scopeMode, applyExclusion, nameFilter, freqSort]);

  if (selectedTag) return <TagRatingAnalysis />;

  return (
    <div className="tag-frequency">
      <input
        type="search"
        placeholder="タグ名で絞り込み"
        value={nameFilter}
        onChange={(e) => setNameFilter(e.target.value)}
      />
      <table>
        <thead>
          <tr>
            <th
              onClick={() => setFreqSort("name")}
              style={{ cursor: "pointer" }}
              aria-sort={freqSort === "name" ? "ascending" : "none"}
            >
              タグ{freqSort === "name" ? " ▲" : ""}
            </th>
            <th
              onClick={() => setFreqSort("count")}
              style={{ cursor: "pointer" }}
              aria-sort={freqSort === "count" ? "descending" : "none"}
            >
              出現画像数{freqSort === "count" ? " ▼" : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {freq.map((t) => (
            <tr
              key={t.tag_id}
              onClick={() => void selectTag(t.tag_id, t.name)}
              style={{ cursor: "pointer" }}
            >
              <td>{t.name}</td>
              <td>{t.image_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {freq.length === 0 && <p>該当タグがありません。</p>}
    </div>
  );
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/components/TagFrequencyTable.tsx src/components/TagRatingAnalysis.tsx
git commit -m "feat(ui): 頻度一覧テーブルと特定タグのレーティング分析を追加"
```

---

## Task 14: 原因タグ表と除外リスト編集

**Files:**
- Create: `src/components/RatingCauseTable.tsx`
- Create: `src/components/ExcludedTagsEditor.tsx`

- [ ] **Step 1: `RatingCauseTable.tsx` を作成**

```tsx
import { useEffect } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";

export function RatingCauseTable() {
  const cause = useAnalysisStore((s) => s.cause);
  const direction = useAnalysisStore((s) => s.causeDirection);
  const setDirection = useAnalysisStore((s) => s.setCauseDirection);
  const minRatedCount = useAnalysisStore((s) => s.minRatedCount);
  const priorWeight = useAnalysisStore((s) => s.priorWeight);
  const setMinRatedCount = useAnalysisStore((s) => s.setMinRatedCount);
  const setPriorWeight = useAnalysisStore((s) => s.setPriorWeight);
  const loadCause = useAnalysisStore((s) => s.loadCause);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);

  useEffect(() => {
    void loadCause();
  }, [loadCause, direction, scopeMode, applyExclusion, minRatedCount, priorWeight]);

  return (
    <div className="rating-cause">
      <div>
        <label>
          <input
            type="radio"
            checked={direction === "high"}
            onChange={() => setDirection("high")}
          />
          高評価の原因
        </label>
        <label>
          <input
            type="radio"
            checked={direction === "low"}
            onChange={() => setDirection("low")}
          />
          低評価の原因
        </label>
        <label>
          最小評価済み件数
          <input
            type="number"
            min={1}
            value={minRatedCount}
            onChange={(e) => setMinRatedCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          事前重み m
          <input
            type="number"
            min={0}
            step={1}
            value={priorWeight}
            onChange={(e) => setPriorWeight(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>タグ</th>
            <th>評価済み件数</th>
            <th>生平均</th>
            <th>調整平均</th>
            <th>全体平均との差</th>
          </tr>
        </thead>
        <tbody>
          {cause.map((r) => (
            <tr key={r.tag_id}>
              <td>{r.name}</td>
              <td>{r.rated_count}</td>
              <td>{r.raw_avg?.toFixed(2) ?? "—"}</td>
              <td>{r.adjusted_avg?.toFixed(2) ?? "—"}</td>
              <td>
                {r.adjusted_avg !== null && r.overall_avg !== null
                  ? (r.adjusted_avg - r.overall_avg >= 0 ? "+" : "") +
                    (r.adjusted_avg - r.overall_avg).toFixed(2)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cause.length === 0 && <p>しきい値を満たすタグがありません。</p>}
    </div>
  );
}
```

- [ ] **Step 2: `ExcludedTagsEditor.tsx` を作成**

```tsx
import { useEffect, useState } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";

export function ExcludedTagsEditor() {
  const excluded = useAnalysisStore((s) => s.excluded);
  const loadExcluded = useAnalysisStore((s) => s.loadExcluded);
  const addExcluded = useAnalysisStore((s) => s.addExcluded);
  const removeExcluded = useAnalysisStore((s) => s.removeExcluded);
  const [name, setName] = useState("");

  useEffect(() => {
    void loadExcluded();
  }, [loadExcluded]);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    void addExcluded(n);
    setName("");
  };

  return (
    <div className="excluded-editor">
      <p>分析から除外するタグ（正規化名で保存されます）。</p>
      <div>
        <input
          type="text"
          value={name}
          placeholder="追加するタグ名"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button type="button" onClick={submit}>追加</button>
      </div>
      <ul>
        {excluded.map((n) => (
          <li key={n}>
            {n} <button type="button" onClick={() => void removeExcluded(n)}>削除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/components/RatingCauseTable.tsx src/components/ExcludedTagsEditor.tsx
git commit -m "feat(ui): 高/低原因タグ表と除外リスト編集を追加"
```

---

## Task 15: 分析ビュー容器

**Files:**
- Create: `src/components/AnalysisView.tsx`

- [ ] **Step 1: `AnalysisView.tsx` を作成**

タブ（頻度一覧 / 原因分析 / 除外リスト）、スコープトグル（全体 / フィルタ範囲）、除外無効化トグル、閉じるボタン。メイン内容領域を覆うパネル。

```tsx
import { useAnalysisStore } from "../store/useAnalysisStore";
import { TagFrequencyTable } from "./TagFrequencyTable";
import { RatingCauseTable } from "./RatingCauseTable";
import { ExcludedTagsEditor } from "./ExcludedTagsEditor";

export function AnalysisView() {
  const open = useAnalysisStore((s) => s.open);
  const setOpen = useAnalysisStore((s) => s.setOpen);
  const tab = useAnalysisStore((s) => s.tab);
  const setTab = useAnalysisStore((s) => s.setTab);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const setScopeMode = useAnalysisStore((s) => s.setScopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);
  const toggleExclusion = useAnalysisStore((s) => s.toggleExclusion);

  if (!open) return null;

  return (
    <div className="analysis-view">
      <div className="analysis-toolbar">
        <div className="analysis-tabs">
          <button type="button" aria-pressed={tab === "frequency"} onClick={() => setTab("frequency")}>頻度一覧</button>
          <button type="button" aria-pressed={tab === "cause"} onClick={() => setTab("cause")}>原因分析</button>
          <button type="button" aria-pressed={tab === "excluded"} onClick={() => setTab("excluded")}>除外リスト</button>
        </div>
        <div className="analysis-scope">
          <label>
            <input
              type="radio"
              checked={scopeMode === "all"}
              onChange={() => setScopeMode("all")}
            />
            全体
          </label>
          <label>
            <input
              type="radio"
              checked={scopeMode === "filter"}
              onChange={() => setScopeMode("filter")}
            />
            フィルタ範囲
          </label>
          <label>
            <input
              type="checkbox"
              checked={!applyExclusion}
              onChange={toggleExclusion}
            />
            除外リストを無効化
          </label>
        </div>
        <button type="button" onClick={() => setOpen(false)}>閉じる</button>
      </div>
      <div className="analysis-body">
        {tab === "frequency" && <TagFrequencyTable />}
        {tab === "cause" && <RatingCauseTable />}
        {tab === "excluded" && <ExcludedTagsEditor />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 最小スタイルを `src/App.css` 末尾に追記**

メイン内容領域を覆うオーバーレイにする。

```css
.analysis-view {
  position: fixed;
  inset: 0;
  background: #1e1e1e;
  color: #eee;
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.analysis-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid #444;
}
.analysis-tabs button[aria-pressed="true"] {
  font-weight: bold;
  text-decoration: underline;
}
.analysis-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.analysis-body table {
  border-collapse: collapse;
  width: 100%;
}
.analysis-body th,
.analysis-body td {
  border: 1px solid #444;
  padding: 4px 8px;
  text-align: left;
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/components/AnalysisView.tsx src/App.css
git commit -m "feat(ui): 分析ビュー容器（タブ・スコープ/除外トグル）を追加"
```

---

## Task 16: メニュー統合と App への組み込み

**Files:**
- Modify: `src-tauri/src/menu.rs`
- Modify: `src/App.tsx`

- [ ] **Step 1: メニューに「分析」項目を追加**

`src-tauri/src/menu.rs` の `use tauri::menu::{...}` に `MenuItem` を追加する。

```rust
use tauri::menu::{CheckMenuItem, Menu, MenuItem, SubmenuBuilder};
```

`build` 関数内、`view_submenu` を組む直前に「分析」項目を作る（`show_current_rating` の生成後あたり）。

```rust
    let open_analysis = MenuItem::with_id(app, "open_analysis", "分析", true, None::<&str>)?;
```

`view_submenu` のビルダーに項目を足す（`.item(&show_current_rating)` の後に追加）。

```rust
        .separator()
        .item(&open_analysis)
```

> `open_analysis` は状態同期不要の通常項目なので `ViewMenu` には保持しない。

- [ ] **Step 2: `App.tsx` で `open_analysis` を購読し `AnalysisView` を描画**

`src/App.tsx` の import 群に追加する。

```tsx
import { AnalysisView } from "./components/AnalysisView";
import { useAnalysisStore } from "./store/useAnalysisStore";
```

`menu-action` の `listen` ハンドラ内、`else if (id.startsWith("zoom_"))` の前に分岐を追加する。

```tsx
      } else if (id === "open_analysis") {
        useAnalysisStore.getState().toggleOpen();
```

返却 JSX の `<Toast />` の後に `AnalysisView` を追加する。

```tsx
      <AnalysisView />
```

- [ ] **Step 3: ビルド／型チェック**

Run: `npx tsc --noEmit && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: いずれも成功。

- [ ] **Step 4: 動作確認（手動）**

Run: `npm run tauri dev`
確認:
- メニュー「表示 > 分析」で分析ビューが開く／「閉じる」で閉じる。
- 頻度一覧にタグと出現画像数が出る。行クリックで「ある/ない」分析へ。
- 「全体 / フィルタ範囲」「除外リストを無効化」で結果が変わる。
- 原因分析タブで高/低の切替が効く。除外リストタブで追加/削除ができる。

- [ ] **Step 5: フロント全テスト＋Rust全テスト**

Run: `npm test` および `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: すべて PASS。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/menu.rs src/App.tsx
git commit -m "feat(ui): メニュー「分析」から分析ビューを開けるよう統合"
```

---

## 完了条件

- 全 Rust テスト（`cargo test`）と全フロントテスト（`npm test`）が PASS。
- `cargo build` / `npx tsc --noEmit` が成功。
- スキャン時にタグが紐付き、起動時 backfill で既存画像のタグが生成される。
- メニュー「分析」から頻度一覧・特定タグ分析・原因分析・除外リスト編集が、全体／フィルタ範囲・除外ON/OFFで動作する。
- SQLite を直接開き、`analysis_scope`/`analysis_params` を設定して `tag_frequency` / `tag_rating_lift` 等の View を参照できる。
