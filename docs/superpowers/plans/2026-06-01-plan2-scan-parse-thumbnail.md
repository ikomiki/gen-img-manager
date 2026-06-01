# 計画2：スキャン・解析・サムネイル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記憶対象ディレクトリ配下の画像（PNG/JPEG/WebP）を走査し、生成メタデータ（A1111 `parameters` / ComfyUI `prompt`・`workflow` / EXIF / XMPサイドカーのレーティング）を解析し、正方形サムネイルを生成して `images` テーブル＋FTS5に格納する。変更検出（path+size+mtime）で再処理を抑制し、ネットワーク切断時もUIを止めない。スキャン進捗をイベントで通知する。

**Architecture:** 解析ロジックは「純粋関数（文字列/JSON→構造化）」と「コンテナ読取（画像ファイル→生メタ＋寸法）」に分離し、純粋関数は実ファイル不要で網羅テストする。スキャンはRust側で実行し、進捗を `event("scan-progress")` でフロントへストリーム。DBハンドルを `Arc<Mutex<Connection>>` 化してバックグラウンドタスクへ渡す。

**Tech Stack:** Rust / rusqlite(bundled, FTS5) / image / webp / png / walkdir / kamadak-exif / quick-xml / serde_json / Tauri v2 event・command / React + Zustand

---

## 前提（実行前に確認）

- 計画1完了済み（`main` にマージ）。`directories` テーブル・CRUD・マイグレーション基盤（`db/migrations.rs` の `MIGRATIONS` 配列、`PRAGMA user_version` 方式）・3コマンド・Zustandストア・3ペインUIが存在する。
- 作業ディレクトリ: `/Users/ikomiki/workspace/gen-img-manager`。
- このマイルストーンは新ブランチ（例 `feature/plan2-scan`）で実装する（main直接実装は禁止）。subagent-driven-development 側でブランチを用意する。
- Cコンパイラ（Xcode CLT）必須（rusqlite/webp の bundled ビルド）。

## ファイル構成（このプランで作成/変更）

```
src-tauri/src/
  db/
    migrations.rs       # 変更: MIGRATIONS に v2（images/indexes/fts/triggers）を追記
    images.rs           # 作成: NewImage と upsert/find_meta_by_path/mark_missing/list_paths/count/delete
    directories.rs      # 変更: set_online / set_last_scanned ヘルパ追加
    mod.rs              # 変更: pub mod images; と Db を Arc<Mutex<Connection>> 化
  parser/
    mod.rs              # 作成: ParsedMetadata と parse(path) オーケストレータ
    a1111.rs            # 作成: parse_a1111（純粋）
    comfyui.rs          # 作成: extract_comfy_text（純粋）
    xmp.rs              # 作成: parse_rating（純粋）+ read_rating_sidecar（ファイル）
    png.rs              # 作成: read_png（寸法＋テキストチャンク）
    raster_exif.rs      # 作成: JPEG/WebP の寸法＋EXIF UserComment 抽出、decode_user_comment（純粋）
  thumbnail.rs          # 作成: generate_thumbnail（正方形クロップ・512・WebP）
  fs_guard.rs           # 作成: is_reachable（タイムアウト付き到達性）
  scanner.rs            # 作成: ScanProgress/ScanSummary と scan_directory コア
  commands/
    mod.rs              # 変更: pub mod scan;
    scan.rs             # 作成: scan_directory/scan_all/rebuild_directory/rebuild_all/count_images コマンド＋進捗イベント
  lib.rs                # 変更: Db初期化を Arc 化、scanモジュール宣言、コマンド登録、Emitter import
  Cargo.toml            # 変更: 依存追加
src/
  types.ts              # 変更: ScanProgress 型追加
  api/scan.ts           # 作成: scanコマンドのinvokeラッパ
  store/useLibraryStore.ts  # 変更: scanning/imageCounts 状態と scan アクション、進捗購読
  components/DirectoryPanel.tsx # 変更: スキャン/全スキャンボタン・進捗・件数表示
```

---

## Task 1: 依存追加とマイグレーション v2（images / index / FTS5 / triggers）

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/db/migrations.rs`（`MIGRATIONS` に1要素追記＋テスト）

- [ ] **Step 1: 依存を追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追記（既存は残す）:
```toml
image = "0.25"
webp = "0.3"
png = "0.17"
walkdir = "2"
kamadak-exif = "0.6"
quick-xml = "0.37"
```
（`cargo build` でバージョン非互換が出たら `cargo add <crate>` で解決可能版に合わせる。`kamadak-exif` はクレート名で、コードでは `use exif;` でインポートする。）

- [ ] **Step 2: v2マイグレーションと失敗するテストを書く**

`src-tauri/src/db/migrations.rs` の `MIGRATIONS` 配列に **2番目の要素** として以下の文字列を追加する（v1 の後ろにカンマ区切りで追記。順序・既存要素は変更しない）:
```rust
    // v2: images, indexes, FTS5, sync triggers
    "CREATE TABLE images (
        id INTEGER PRIMARY KEY,
        directory_id INTEGER NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        created_at INTEGER,
        modified_at INTEGER,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        pixels INTEGER NOT NULL,
        rating INTEGER,
        format TEXT NOT NULL,
        thumb_path TEXT,
        raw_parameters TEXT,
        positive TEXT,
        negative TEXT,
        model TEXT,
        sampler TEXT,
        steps INTEGER,
        seed INTEGER,
        cfg REAL,
        source_tool TEXT NOT NULL DEFAULT 'unknown',
        comfy_workflow TEXT,
        missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_images_directory ON images(directory_id);
    CREATE INDEX idx_images_created ON images(created_at);
    CREATE INDEX idx_images_modified ON images(modified_at);
    CREATE INDEX idx_images_width ON images(width);
    CREATE INDEX idx_images_height ON images(height);
    CREATE INDEX idx_images_pixels ON images(pixels);
    CREATE INDEX idx_images_rating ON images(rating);
    CREATE VIRTUAL TABLE images_fts USING fts5(
        raw_parameters, positive, negative, model, filename,
        content='images', content_rowid='id'
    );
    CREATE TRIGGER images_ai AFTER INSERT ON images BEGIN
        INSERT INTO images_fts(rowid, raw_parameters, positive, negative, model, filename)
        VALUES (new.id, new.raw_parameters, new.positive, new.negative, new.model, new.filename);
    END;
    CREATE TRIGGER images_ad AFTER DELETE ON images BEGIN
        INSERT INTO images_fts(images_fts, rowid, raw_parameters, positive, negative, model, filename)
        VALUES ('delete', old.id, old.raw_parameters, old.positive, old.negative, old.model, old.filename);
    END;
    CREATE TRIGGER images_au AFTER UPDATE ON images BEGIN
        INSERT INTO images_fts(images_fts, rowid, raw_parameters, positive, negative, model, filename)
        VALUES ('delete', old.id, old.raw_parameters, old.positive, old.negative, old.model, old.filename);
        INSERT INTO images_fts(rowid, raw_parameters, positive, negative, model, filename)
        VALUES (new.id, new.raw_parameters, new.positive, new.negative, new.model, new.filename);
    END;",
```

`migrations.rs` の `#[cfg(test)] mod tests` に以下のテストを追加:
```rust
    #[test]
    fn v2_creates_images_and_fts_and_version_is_2() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);
        for name in ["images", "images_fts"] {
            let c: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(c >= 1, "missing object: {name}");
        }
    }

    #[test]
    fn fts_is_kept_in_sync_by_triggers() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let dir_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO images (directory_id, path, filename, size, mtime, width, height, pixels, format, positive)
             VALUES (?1, '/d/a.png', 'a.png', 10, 20, 4, 4, 16, 'png', 'lonely lighthouse at dusk')",
            rusqlite::params![dir_id],
        )
        .unwrap();
        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM images_fts WHERE images_fts MATCH 'lighthouse'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test migrations`
Expected: 既存2件＋新規2件＝4件 PASS。

- [ ] **Step 4: Commit**

```bash
cd /Users/ikomiki/workspace/gen-img-manager
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db/migrations.rs
git commit -m "feat(db): add images table, indexes, fts5 and sync triggers (migration v2)"
```

---

## Task 2: images DB層（NewImage / upsert / 変更検出 / missing / count / delete）

**Files:**
- Create: `src-tauri/src/db/images.rs`
- Modify: `src-tauri/src/db/mod.rs`（`pub mod images;` 追加）

- [ ] **Step 1: モジュール宣言を追加**

`src-tauri/src/db/mod.rs` の `pub mod directories;` の隣に追記:
```rust
pub mod images;
```

- [ ] **Step 2: images DB層と失敗するテストを書く**

`src-tauri/src/db/images.rs` を作成:
```rust
use rusqlite::{params, Connection};

/// images へ挿入/更新する1件分のデータ。pixels は width*height で算出する。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewImage {
    pub directory_id: i64,
    pub path: String,
    pub filename: String,
    pub size: i64,
    pub mtime: i64,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub width: i64,
    pub height: i64,
    pub rating: Option<i64>,
    pub format: String,
    pub thumb_path: Option<String>,
    pub raw_parameters: Option<String>,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
    pub source_tool: String,
    pub comfy_workflow: Option<String>,
}

/// path 一意制約で UPSERT し、行 id を返す。再登録時は missing=0 に戻す。
pub fn upsert(conn: &Connection, img: &NewImage) -> rusqlite::Result<i64> {
    conn.query_row(
        "INSERT INTO images (
            directory_id, path, filename, size, mtime, created_at, modified_at,
            width, height, pixels, rating, format, thumb_path,
            raw_parameters, positive, negative, model, sampler, steps, seed, cfg,
            source_tool, comfy_workflow, missing
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, 0
        )
        ON CONFLICT(path) DO UPDATE SET
            directory_id=excluded.directory_id, filename=excluded.filename,
            size=excluded.size, mtime=excluded.mtime,
            created_at=excluded.created_at, modified_at=excluded.modified_at,
            width=excluded.width, height=excluded.height, pixels=excluded.pixels,
            rating=excluded.rating, format=excluded.format, thumb_path=excluded.thumb_path,
            raw_parameters=excluded.raw_parameters, positive=excluded.positive,
            negative=excluded.negative, model=excluded.model, sampler=excluded.sampler,
            steps=excluded.steps, seed=excluded.seed, cfg=excluded.cfg,
            source_tool=excluded.source_tool, comfy_workflow=excluded.comfy_workflow,
            missing=0
        RETURNING id",
        params![
            img.directory_id, img.path, img.filename, img.size, img.mtime,
            img.created_at, img.modified_at,
            img.width, img.height, img.width * img.height, img.rating, img.format, img.thumb_path,
            img.raw_parameters, img.positive, img.negative, img.model, img.sampler,
            img.steps, img.seed, img.cfg, img.source_tool, img.comfy_workflow,
        ],
        |r| r.get(0),
    )
}

/// 変更検出用。path から (id, size, mtime) を返す。無ければ None。
pub fn find_meta_by_path(
    conn: &Connection,
    path: &str,
) -> rusqlite::Result<Option<(i64, i64, i64)>> {
    let mut stmt =
        conn.prepare("SELECT id, size, mtime FROM images WHERE path = ?1")?;
    let mut rows = stmt.query(params![path])?;
    match rows.next()? {
        Some(r) => Ok(Some((r.get(0)?, r.get(1)?, r.get(2)?))),
        None => Ok(None),
    }
}

/// ディレクトリ配下の (id, path) 一覧。missing 検出に使う。
pub fn list_paths_in_directory(
    conn: &Connection,
    directory_id: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, path FROM images WHERE directory_id = ?1")?;
    let rows = stmt.query_map(params![directory_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn mark_missing(conn: &Connection, id: i64, missing: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE images SET missing = ?2 WHERE id = ?1",
        params![id, missing as i64],
    )?;
    Ok(())
}

pub fn count_in_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT count(*) FROM images WHERE directory_id = ?1 AND missing = 0",
        params![directory_id],
        |r| r.get(0),
    )
}

pub fn delete_by_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM images WHERE directory_id = ?1", params![directory_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

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

    fn sample(path: &str) -> NewImage {
        NewImage {
            directory_id: 1,
            path: path.to_string(),
            filename: "a.png".to_string(),
            size: 100,
            mtime: 200,
            width: 4,
            height: 2,
            format: "png".to_string(),
            source_tool: "unknown".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn upsert_inserts_and_computes_pixels() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        let pixels: i64 = c
            .query_row("SELECT pixels FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(pixels, 8);
    }

    #[test]
    fn upsert_on_same_path_updates_not_duplicates() {
        let c = conn();
        let id1 = upsert(&c, &sample("/d/a.png")).unwrap();
        let mut changed = sample("/d/a.png");
        changed.size = 999;
        let id2 = upsert(&c, &changed).unwrap();
        assert_eq!(id1, id2);
        let count: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let size: i64 = c
            .query_row("SELECT size FROM images WHERE id = ?1", params![id2], |r| r.get(0))
            .unwrap();
        assert_eq!(size, 999);
    }

    #[test]
    fn find_meta_by_path_roundtrip() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        assert_eq!(find_meta_by_path(&c, "/d/a.png").unwrap(), Some((id, 100, 200)));
        assert_eq!(find_meta_by_path(&c, "/d/none.png").unwrap(), None);
    }

    #[test]
    fn mark_missing_excludes_from_count() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        assert_eq!(count_in_directory(&c, 1).unwrap(), 1);
        mark_missing(&c, id, true).unwrap();
        assert_eq!(count_in_directory(&c, 1).unwrap(), 0);
    }

    #[test]
    fn delete_by_directory_removes_rows() {
        let c = conn();
        upsert(&c, &sample("/d/a.png")).unwrap();
        upsert(&c, &sample("/d/b.png")).unwrap();
        delete_by_directory(&c, 1).unwrap();
        let count: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test db::images`
Expected: 5件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/images.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add images upsert, change-detection lookup, missing/count/delete"
```

---

## Task 3: A1111 `parameters` 正規化（純粋関数）

**Files:**
- Create: `src-tauri/src/parser/a1111.rs`
- Create: `src-tauri/src/parser/mod.rs`（このタスクでは `pub mod a1111;` のみ）
- Modify: `src-tauri/src/lib.rs`（`mod parser;` 追加）

- [ ] **Step 1: parserモジュールを宣言**

`src-tauri/src/lib.rs` のモジュール宣言群（`mod db;` 等の並び）に追記:
```rust
mod parser;
```
`src-tauri/src/parser/mod.rs` を作成（最小）:
```rust
pub mod a1111;
```

- [ ] **Step 2: A1111正規化と失敗するテストを書く**

`src-tauri/src/parser/a1111.rs` を作成:
```rust
/// A1111 (AUTOMATIC1111 / WebUI) の `parameters` テキストから抽出した構造化フィールド。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct A1111Fields {
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
}

/// A1111 の geninfo 文字列を解析する。
/// 形式:
///   <positive prompt (複数行可)>
///   Negative prompt: <negative>
///   Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123, Model: v1-5, ...
pub fn parse_a1111(raw: &str) -> A1111Fields {
    let raw = raw.trim();
    let mut fields = A1111Fields::default();

    // 末尾行がパラメータ行（"Steps:" を含む key: value の並び）なら切り出す。
    let (body, params_line) = match raw.rfind('\n') {
        Some(idx) if raw[idx + 1..].contains("Steps:") => {
            (raw[..idx].trim_end(), &raw[idx + 1..])
        }
        // 改行が無く1行のみでも、Steps: を含むならパラメータ行扱い。
        None if raw.contains("Steps:") => ("", raw),
        _ => (raw, ""),
    };

    // body を positive / negative に分割。
    if !body.is_empty() {
        if let Some(npos) = body.find("Negative prompt:") {
            let pos = body[..npos].trim();
            let neg = body[npos + "Negative prompt:".len()..].trim();
            if !pos.is_empty() {
                fields.positive = Some(pos.to_string());
            }
            if !neg.is_empty() {
                fields.negative = Some(neg.to_string());
            }
        } else {
            fields.positive = Some(body.trim().to_string());
        }
    }

    // パラメータ行を ", " 区切りの key: value に分解。
    for token in params_line.split(", ") {
        if let Some((key, value)) = token.split_once(": ") {
            let value = value.trim();
            match key.trim() {
                "Steps" => fields.steps = value.parse().ok(),
                "Sampler" => fields.sampler = Some(value.to_string()),
                "CFG scale" => fields.cfg = value.parse().ok(),
                "Seed" => fields.seed = value.parse().ok(),
                "Model" => fields.model = Some(value.to_string()),
                _ => {}
            }
        }
    }

    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_example() {
        let raw = "masterpiece, 1girl, forest\n\
                   Negative prompt: blurry, lowres\n\
                   Steps: 28, Sampler: DPM++ 2M, CFG scale: 7.5, Seed: 12345, Size: 512x768, Model: sdxl_base";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("masterpiece, 1girl, forest"));
        assert_eq!(f.negative.as_deref(), Some("blurry, lowres"));
        assert_eq!(f.steps, Some(28));
        assert_eq!(f.sampler.as_deref(), Some("DPM++ 2M"));
        assert_eq!(f.cfg, Some(7.5));
        assert_eq!(f.seed, Some(12345));
        assert_eq!(f.model.as_deref(), Some("sdxl_base"));
    }

    #[test]
    fn handles_missing_negative_prompt() {
        let raw = "a cat\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Model: m";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("a cat"));
        assert_eq!(f.negative, None);
        assert_eq!(f.steps, Some(20));
    }

    #[test]
    fn handles_plain_prompt_without_params() {
        let f = parse_a1111("just a prompt with no settings");
        assert_eq!(f.positive.as_deref(), Some("just a prompt with no settings"));
        assert_eq!(f.steps, None);
        assert_eq!(f.sampler, None);
    }

    #[test]
    fn multiline_positive_prompt() {
        let raw = "line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9";
        let f = parse_a1111(raw);
        assert_eq!(f.positive.as_deref(), Some("line one\nline two"));
        assert_eq!(f.negative.as_deref(), Some("bad"));
        assert_eq!(f.seed, Some(9));
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser::a1111`
Expected: 4件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/a1111.rs src-tauri/src/parser/mod.rs src-tauri/src/lib.rs
git commit -m "feat(parser): add A1111 parameters normalizer"
```

---

## Task 4: ComfyUI テキスト抽出（純粋関数）

**Files:**
- Create: `src-tauri/src/parser/comfyui.rs`
- Modify: `src-tauri/src/parser/mod.rs`（`pub mod comfyui;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/parser/mod.rs` に追記:
```rust
pub mod comfyui;
```

- [ ] **Step 2: ComfyUI抽出と失敗するテストを書く**

`src-tauri/src/parser/comfyui.rs` を作成:
```rust
use serde_json::Value;

/// ComfyUI の `prompt` JSON（API形式: node_id -> {class_type, inputs}）から
/// 検索対象テキストを抽出した結果。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ComfyFields {
    /// CLIPTextEncode 系ノードの text を結合したもの（検索用）。
    pub positive: Option<String>,
}

/// ComfyUI の prompt JSON 文字列からテキストエンコードノードの文字列を収集する。
/// 正負の区別は ComfyUI のグラフ構造依存で信頼できないため、すべて結合して
/// 全文検索の対象（positive）にする（ベストエフォート）。
pub fn extract_comfy_text(prompt_json: &str) -> ComfyFields {
    let mut fields = ComfyFields::default();
    let root: Value = match serde_json::from_str(prompt_json) {
        Ok(v) => v,
        Err(_) => return fields,
    };
    let Some(obj) = root.as_object() else {
        return fields;
    };

    let mut texts: Vec<String> = Vec::new();
    for node in obj.values() {
        let class_type = node.get("class_type").and_then(|v| v.as_str()).unwrap_or("");
        if class_type.contains("CLIPTextEncode") {
            if let Some(t) = node
                .get("inputs")
                .and_then(|i| i.get("text"))
                .and_then(|t| t.as_str())
            {
                let t = t.trim();
                if !t.is_empty() {
                    texts.push(t.to_string());
                }
            }
        }
    }

    if !texts.is_empty() {
        fields.positive = Some(texts.join("\n"));
    }
    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_clip_text_encode_nodes() {
        let json = r#"{
            "3": {"class_type": "KSampler", "inputs": {"seed": 1}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "beautiful sunset over ocean"}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry, watermark"}}
        }"#;
        let f = extract_comfy_text(json);
        let pos = f.positive.unwrap();
        assert!(pos.contains("beautiful sunset over ocean"));
        assert!(pos.contains("blurry, watermark"));
    }

    #[test]
    fn handles_no_text_nodes() {
        let json = r#"{"3": {"class_type": "KSampler", "inputs": {"seed": 1}}}"#;
        assert_eq!(extract_comfy_text(json), ComfyFields::default());
    }

    #[test]
    fn invalid_json_returns_default() {
        assert_eq!(extract_comfy_text("not json"), ComfyFields::default());
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser::comfyui`
Expected: 3件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/comfyui.rs src-tauri/src/parser/mod.rs
git commit -m "feat(parser): add ComfyUI CLIPTextEncode text extractor"
```

---

## Task 5: XMPサイドカーのレーティング解析

**Files:**
- Create: `src-tauri/src/parser/xmp.rs`
- Modify: `src-tauri/src/parser/mod.rs`（`pub mod xmp;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/parser/mod.rs` に追記:
```rust
pub mod xmp;
```

- [ ] **Step 2: XMPレーティング解析と失敗するテストを書く**

`src-tauri/src/parser/xmp.rs` を作成:
```rust
use quick_xml::events::Event;
use quick_xml::Reader;
use std::path::{Path, PathBuf};

/// XMP文字列から xmp:Rating を抽出する（0..=5 にクランプ）。
/// 属性 `xmp:Rating="4"`（rdf:Description属性）と要素 `<xmp:Rating>4</xmp:Rating>` の両方に対応。
pub fn parse_rating(xml: &str) -> Option<i64> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut in_rating_element = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.name().as_ref() == b"xmp:Rating" {
                    in_rating_element = true;
                }
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == b"xmp:Rating" {
                        if let Ok(v) = attr.unescape_value() {
                            if let Some(r) = v.trim().parse::<i64>().ok() {
                                return Some(r.clamp(0, 5));
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) if in_rating_element => {
                if let Ok(s) = t.unescape() {
                    if let Ok(r) = s.trim().parse::<i64>() {
                        return Some(r.clamp(0, 5));
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"xmp:Rating" {
                    in_rating_element = false;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    None
}

/// 画像パスに対応するサイドカー .xmp を探して読み、レーティングを返す。
/// `image.png.xmp` を優先し、無ければ `image.xmp` を試す。
pub fn read_rating_sidecar(image_path: &Path) -> Option<i64> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // image.ext.xmp
    let mut with_suffix = image_path.as_os_str().to_os_string();
    with_suffix.push(".xmp");
    candidates.push(PathBuf::from(with_suffix));
    // image.xmp
    candidates.push(image_path.with_extension("xmp"));

    for cand in candidates {
        if let Ok(xml) = std::fs::read_to_string(&cand) {
            if let Some(r) = parse_rating(&xml) {
                return Some(r);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rating_as_element() {
        let xml = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
              <rdf:Description><xmp:Rating>4</xmp:Rating></rdf:Description>
            </rdf:RDF></x:xmpmeta>"#;
        assert_eq!(parse_rating(xml), Some(4));
    }

    #[test]
    fn reads_rating_as_attribute() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"/>"#;
        assert_eq!(parse_rating(xml), Some(5));
    }

    #[test]
    fn clamps_out_of_range() {
        let xml = r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="9"/>"#;
        assert_eq!(parse_rating(xml), Some(5));
    }

    #[test]
    fn no_rating_returns_none() {
        assert_eq!(parse_rating("<x>nothing</x>"), None);
    }

    #[test]
    fn sidecar_with_suffix_is_read() {
        let dir = std::env::temp_dir().join(format!("gim_xmp_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"not a real png").unwrap();
        std::fs::write(
            dir.join("pic.png.xmp"),
            r#"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="3"/>"#,
        )
        .unwrap();
        assert_eq!(read_rating_sidecar(&img), Some(3));
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser::xmp`
Expected: 5件 PASS。（quick-xml のAPIがバージョン差で異なる場合: `reader.config_mut().trim_text(true)` が古い版では `reader.trim_text(true)`。コンパイルエラー時に合わせる。）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/xmp.rs src-tauri/src/parser/mod.rs
git commit -m "feat(parser): add XMP sidecar rating parser"
```

---

## Task 6: PNG読取（寸法＋テキストチャンク）

**Files:**
- Create: `src-tauri/src/parser/png.rs`
- Modify: `src-tauri/src/parser/mod.rs`（`pub mod png;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/parser/mod.rs` に追記:
```rust
pub mod png;
```

- [ ] **Step 2: PNG読取と失敗するテストを書く**

`src-tauri/src/parser/png.rs` を作成:
```rust
use std::collections::HashMap;
use std::path::Path;

/// PNGから取り出した寸法とテキストチャンク（keyword -> text）。
#[derive(Debug, Clone, PartialEq)]
pub struct PngData {
    pub width: u32,
    pub height: u32,
    pub texts: HashMap<String, String>,
}

/// PNGの IHDR と（IDAT前の）tEXt/zTXt/iTXt チャンクを読む。
/// A1111 の `parameters`、ComfyUI の `prompt`/`workflow` は IDAT 前に書かれるため取得できる。
pub fn read_png(path: &Path) -> Result<PngData, png::DecodingError> {
    let file = std::fs::File::open(path)?;
    let decoder = png::Decoder::new(file);
    let reader = decoder.read_info()?;
    let info = reader.info();

    let mut texts = HashMap::new();
    for c in &info.uncompressed_latin1_text {
        texts.insert(c.keyword.clone(), c.text.clone());
    }
    for c in &info.compressed_latin1_text {
        if let Ok(t) = c.get_text() {
            texts.insert(c.keyword.clone(), t);
        }
    }
    for c in &info.utf8_text {
        if let Ok(t) = c.get_text() {
            texts.insert(c.keyword.clone(), t);
        }
    }

    Ok(PngData {
        width: info.width,
        height: info.height,
        texts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    /// 2x2 RGBA の PNG を tEXt チャンク付きで temp に書き出す。
    fn write_png_with_text(path: &Path, keyword: &str, text: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        let mut encoder = png::Encoder::new(w, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .add_text_chunk(keyword.to_string(), text.to_string())
            .unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0u8; 16]).unwrap();
    }

    #[test]
    fn reads_dimensions_and_parameters_text() {
        let dir = std::env::temp_dir().join(format!("gim_png_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.png");
        write_png_with_text(&p, "parameters", "masterpiece\nSteps: 20, Seed: 5");

        let data = read_png(&p).unwrap();
        assert_eq!((data.width, data.height), (2, 2));
        assert_eq!(
            data.texts.get("parameters").map(|s| s.as_str()),
            Some("masterpiece\nSteps: 20, Seed: 5")
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser::png`
Expected: 1件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/png.rs src-tauri/src/parser/mod.rs
git commit -m "feat(parser): read PNG dimensions and text chunks"
```

---

## Task 7: JPEG/WebP読取（寸法＋EXIF UserComment）

**Files:**
- Create: `src-tauri/src/parser/raster_exif.rs`
- Modify: `src-tauri/src/parser/mod.rs`（`pub mod raster_exif;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/parser/mod.rs` に追記:
```rust
pub mod raster_exif;
```

- [ ] **Step 2: 読取とデコード、失敗するテストを書く**

`src-tauri/src/parser/raster_exif.rs` を作成:
```rust
use std::path::Path;

/// JPEG/WebP の寸法とEXIF UserComment（A1111 paramsが入ることが多い）。
#[derive(Debug, Clone, PartialEq)]
pub struct RasterData {
    pub width: u32,
    pub height: u32,
    pub user_comment: Option<String>,
}

/// EXIF UserComment の先頭8バイトの文字コード指定を解釈して文字列化する。
/// "ASCII\0\0\0" / "UNICODE\0"(UTF-16BE) / それ以外はUTF-8とみなす。
pub fn decode_user_comment(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 8 {
        let s = String::from_utf8_lossy(bytes).trim().to_string();
        return if s.is_empty() { None } else { Some(s) };
    }
    let (header, body) = bytes.split_at(8);
    let text = match header {
        b"ASCII\0\0\0" => String::from_utf8_lossy(body).to_string(),
        b"UNICODE\0" => {
            let u16s: Vec<u16> = body
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        }
        _ => String::from_utf8_lossy(bytes).to_string(),
    };
    let text = text.trim_matches(char::from(0)).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// JPEG/WebP ファイルを読み、寸法とUserCommentを返す。
pub fn read_raster(path: &Path) -> Result<RasterData, image::ImageError> {
    let (width, height) = image::ImageReader::open(path)?
        .with_guessed_format()?
        .into_dimensions()?;

    let user_comment = read_user_comment(path);

    Ok(RasterData {
        width,
        height,
        user_comment,
    })
}

fn read_user_comment(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut reader)
        .ok()?;
    let field = exif.get_field(exif::Tag::UserComment, exif::In::PRIMARY)?;
    if let exif::Value::Undefined(ref bytes, _) = field.value {
        decode_user_comment(bytes)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ascii_user_comment() {
        let mut bytes = b"ASCII\0\0\0".to_vec();
        bytes.extend_from_slice(b"masterpiece\nSteps: 20");
        assert_eq!(
            decode_user_comment(&bytes).as_deref(),
            Some("masterpiece\nSteps: 20")
        );
    }

    #[test]
    fn decodes_unicode_user_comment() {
        let mut bytes = b"UNICODE\0".to_vec();
        for u in "hi".encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        assert_eq!(decode_user_comment(&bytes).as_deref(), Some("hi"));
    }

    #[test]
    fn empty_comment_is_none() {
        let bytes = b"ASCII\0\0\0".to_vec();
        assert_eq!(decode_user_comment(&bytes), None);
    }

    #[test]
    fn reads_jpeg_dimensions() {
        // image クレートで小さなJPEGを書き出して寸法を読み戻す。
        let dir = std::env::temp_dir().join(format!("gim_jpg_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.jpg");
        let img = image::RgbImage::new(7, 3);
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(&p, image::ImageFormat::Jpeg)
            .unwrap();

        let data = read_raster(&p).unwrap();
        assert_eq!((data.width, data.height), (7, 3));
        // EXIFを書いていないので UserComment は None。
        assert_eq!(data.user_comment, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser::raster_exif`
Expected: 4件 PASS。（`exif::Value`/`Tag`/`In` のパスがバージョン差で異なる場合はコンパイルエラーに合わせて調整。`kamadak-exif` のクレート名インポートは `exif`。）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/raster_exif.rs src-tauri/src/parser/mod.rs
git commit -m "feat(parser): read JPEG/WebP dimensions and decode EXIF UserComment"
```

---

## Task 8: parserオーケストレータ（拡張子で振り分け→ParsedMetadata）

**Files:**
- Modify: `src-tauri/src/parser/mod.rs`（`ParsedMetadata` と `parse(path)` を実装）

- [ ] **Step 1: ParsedMetadata と parse の失敗するテストを書く**

`src-tauri/src/parser/mod.rs` を次の内容に更新（先頭の `pub mod ...;` 群は維持し、その下に追記）:
```rust
pub mod a1111;
pub mod comfyui;
pub mod png;
pub mod raster_exif;
pub mod xmp;

use std::path::Path;

/// 1画像から抽出した（埋め込み）メタデータ。レーティングはXMPサイドカー由来のため含めない。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedMetadata {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub raw_parameters: Option<String>,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
    pub source_tool: String,
    pub comfy_workflow: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unsupported extension")]
    Unsupported,
    #[error("png: {0}")]
    Png(#[from] ::png::DecodingError), // `::png` = 外部クレート（`parser::png` サブモジュールと区別）
    #[error("image: {0}")]
    Image(#[from] image::ImageError),
}

/// 拡張子で振り分けて画像を解析する。
pub fn parse(path: &Path) -> Result<ParsedMetadata, ParseError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "png" => parse_png(path),
        "jpg" | "jpeg" | "webp" => parse_raster(path, &ext),
        _ => Err(ParseError::Unsupported),
    }
}

fn parse_png(path: &Path) -> Result<ParsedMetadata, ParseError> {
    let data = png::read_png(path)?;
    let mut meta = ParsedMetadata {
        width: data.width,
        height: data.height,
        format: "png".to_string(),
        source_tool: "unknown".to_string(),
        ..Default::default()
    };

    if let Some(params) = data.texts.get("parameters") {
        // A1111
        meta.source_tool = "a1111".to_string();
        meta.raw_parameters = Some(params.clone());
        let f = a1111::parse_a1111(params);
        meta.positive = f.positive;
        meta.negative = f.negative;
        meta.model = f.model;
        meta.sampler = f.sampler;
        meta.steps = f.steps;
        meta.seed = f.seed;
        meta.cfg = f.cfg;
    } else if let Some(prompt) = data.texts.get("prompt") {
        // ComfyUI
        meta.source_tool = "comfyui".to_string();
        meta.raw_parameters = Some(prompt.clone());
        meta.positive = comfyui::extract_comfy_text(prompt).positive;
        meta.comfy_workflow = data.texts.get("workflow").cloned();
    }

    Ok(meta)
}

fn parse_raster(path: &Path, ext: &str) -> Result<ParsedMetadata, ParseError> {
    let data = raster_exif::read_raster(path)?;
    let format = if ext == "jpg" { "jpeg".to_string() } else { ext.to_string() };
    let mut meta = ParsedMetadata {
        width: data.width,
        height: data.height,
        format,
        source_tool: "unknown".to_string(),
        ..Default::default()
    };

    if let Some(uc) = data.user_comment {
        // WebUIのJPEG/WebP出力はUserCommentにA1111 paramsを入れる。
        meta.source_tool = "a1111".to_string();
        meta.raw_parameters = Some(uc.clone());
        let f = a1111::parse_a1111(&uc);
        meta.positive = f.positive;
        meta.negative = f.negative;
        meta.model = f.model;
        meta.sampler = f.sampler;
        meta.steps = f.steps;
        meta.seed = f.seed;
        meta.cfg = f.cfg;
    }

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    fn write_png_with_text(path: &Path, keyword: &str, text: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        // `::png` = 外部クレート（このモジュールの `pub mod png;` サブモジュールではない）
        let mut encoder = ::png::Encoder::new(w, 2, 2);
        encoder.set_color(::png::ColorType::Rgba);
        encoder.set_depth(::png::BitDepth::Eight);
        encoder.add_text_chunk(keyword.to_string(), text.to_string()).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0u8; 16]).unwrap();
    }

    #[test]
    fn parses_a1111_png_end_to_end() {
        let dir = std::env::temp_dir().join(format!("gim_parse_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.png");
        write_png_with_text(&p, "parameters", "a dog\nSteps: 12, Seed: 7, Model: m1");

        let meta = parse(&p).unwrap();
        assert_eq!(meta.format, "png");
        assert_eq!(meta.source_tool, "a1111");
        assert_eq!(meta.positive.as_deref(), Some("a dog"));
        assert_eq!(meta.steps, Some(12));
        assert_eq!(meta.model.as_deref(), Some("m1"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unsupported_extension_errors() {
        assert!(matches!(parse(Path::new("/x/y.gif")), Err(ParseError::Unsupported)));
    }
}
```

**注意（名前衝突の回避）:** `parser/mod.rs` は `pub mod png;`（サブモジュール `parser::png`）を持つため、同モジュール内で識別子 `png` はサブモジュールを指す。外部の `png` **クレート**の型（`DecodingError`/`Encoder` 等）を参照する箇所は、上記コードのように先頭 `::` を付けた絶対パス `::png::...` を用いること。`parser/png.rs` の内部（サブモジュールを持たない）では `png::Decoder` がそのままクレートを指すので変更不要。

- [ ] **Step 2: thiserror 依存を追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追記:
```toml
thiserror = "1"
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test parser`
Expected: parser配下の全テスト（a1111 4 / comfyui 3 / xmp 5 / png 1 / raster_exif 4 / mod 2）が PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/parser/mod.rs src-tauri/src/parser/png.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(parser): add orchestrator dispatching png/jpeg/webp into ParsedMetadata"
```

---

## Task 9: サムネイラ（正方形・中央クロップ・512・WebP）

**Files:**
- Create: `src-tauri/src/thumbnail.rs`
- Modify: `src-tauri/src/lib.rs`（`mod thumbnail;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/lib.rs` のモジュール宣言群に追記:
```rust
mod thumbnail;
```

- [ ] **Step 2: サムネイラと失敗するテストを書く**

`src-tauri/src/thumbnail.rs` を作成:
```rust
use image::GenericImageView;
use std::path::{Path, PathBuf};

const THUMB_SIZE: u32 = 512;
const THUMB_QUALITY: f32 = 80.0;

#[derive(Debug, thiserror::Error)]
pub enum ThumbError {
    #[error("image: {0}")]
    Image(#[from] image::ImageError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("webp encode failed: {0}")]
    Webp(String),
}

/// 画像パスから安定なサムネイルファイル名（FNV-1a 64bit hex + .webp）を作る。
fn thumb_filename(src: &Path) -> String {
    let s = src.to_string_lossy();
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}.webp")
}

/// 中央クロップで正方形にし、512pxへ縮小、WebP(品質80)で `thumb_dir` に保存する。
/// 保存先パスを返す。
pub fn generate_thumbnail(src: &Path, thumb_dir: &Path) -> Result<PathBuf, ThumbError> {
    let img = image::ImageReader::open(src)?
        .with_guessed_format()?
        .decode()?;
    let (w, h) = img.dimensions();
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = (h - side) / 2;
    let square = img.crop_imm(x, y, side, side);
    let thumb = square.resize_exact(THUMB_SIZE, THUMB_SIZE, image::imageops::FilterType::Lanczos3);

    let encoder = webp::Encoder::from_image(&thumb).map_err(|e| ThumbError::Webp(e.to_string()))?;
    let data = encoder.encode(THUMB_QUALITY);

    std::fs::create_dir_all(thumb_dir)?;
    let out = thumb_dir.join(thumb_filename(src));
    std::fs::write(&out, &*data)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufWriter;

    fn write_png(path: &Path, w: u32, h: u32) {
        let file = std::fs::File::create(path).unwrap();
        let bw = BufWriter::new(file);
        let mut encoder = png::Encoder::new(bw, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let buf = vec![0u8; (w * h * 4) as usize];
        writer.write_image_data(&buf).unwrap();
    }

    #[test]
    fn generates_square_512_webp() {
        let dir = std::env::temp_dir().join(format!("gim_thumb_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wide.png");
        write_png(&src, 100, 40); // 横長

        let thumb_dir = dir.join("thumbs");
        let out = generate_thumbnail(&src, &thumb_dir).unwrap();
        assert!(out.exists());
        assert_eq!(out.extension().unwrap(), "webp");

        // 生成物を読み戻して 512x512 正方形を確認。
        let (tw, th) = image::ImageReader::open(&out)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!((tw, th), (512, 512));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filename_is_stable_for_same_path() {
        assert_eq!(thumb_filename(Path::new("/a/b.png")), thumb_filename(Path::new("/a/b.png")));
        assert_ne!(thumb_filename(Path::new("/a/b.png")), thumb_filename(Path::new("/a/c.png")));
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test thumbnail`
Expected: 2件 PASS。（`webp::Encoder::from_image` の戻り値型がバージョン差で異なる場合はコンパイルエラーに合わせて `map_err` を調整。image 0.25 のWebPデコードは `image-webp` 経由で読める。）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/thumbnail.rs src-tauri/src/lib.rs
git commit -m "feat(thumbnail): generate square 512px webp thumbnails with stable cache names"
```

---

## Task 10: ディレクトリのスキャン状態ヘルパと fs_guard（到達性）

**Files:**
- Modify: `src-tauri/src/db/directories.rs`（`set_online` / `set_last_scanned` 追加）
- Create: `src-tauri/src/fs_guard.rs`
- Modify: `src-tauri/src/lib.rs`（`mod fs_guard;` 追加）

- [ ] **Step 1: ディレクトリのスキャン状態更新ヘルパを追加（テスト付き）**

`src-tauri/src/db/directories.rs` の末尾（`#[cfg(test)]` の直前）に追加:
```rust
pub fn set_online(conn: &Connection, id: i64, online: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET is_online = ?2 WHERE id = ?1",
        params![id, online as i64],
    )?;
    Ok(())
}

pub fn set_last_scanned(conn: &Connection, id: i64, ts: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET last_scanned_at = ?2 WHERE id = ?1",
        params![id, ts],
    )?;
    Ok(())
}
```
`#[cfg(test)] mod tests` 内に追加:
```rust
    #[test]
    fn set_online_and_last_scanned_persist() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        set_online(&c, d.id, false).unwrap();
        set_last_scanned(&c, d.id, 1717000000).unwrap();
        let got = get(&c, d.id).unwrap();
        assert!(!got.is_online);
        assert_eq!(got.last_scanned_at, Some(1717000000));
    }
```

- [ ] **Step 2: fs_guard を作成（テスト付き）**

`src-tauri/src/lib.rs` のモジュール宣言群に追記:
```rust
mod fs_guard;
```
`src-tauri/src/fs_guard.rs` を作成:
```rust
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// パスの到達性を「タイムアウト付き」で確認する。
/// 切断されたネットワークドライブで `exists()` がハングしてもUIを止めないため、
/// 別スレッドで判定し、期限内に応答が無ければ到達不可とみなす。
pub fn is_reachable(path: &Path, timeout: Duration) -> bool {
    let p = path.to_path_buf();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(p.exists());
    });
    matches!(rx.recv_timeout(timeout), Ok(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_dir_is_reachable() {
        let dir = std::env::temp_dir();
        assert!(is_reachable(&dir, Duration::from_secs(2)));
    }

    #[test]
    fn nonexistent_path_is_not_reachable() {
        let p = std::env::temp_dir().join("definitely_not_here_gim_xyz");
        assert!(!is_reachable(&p, Duration::from_secs(2)));
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test directories::tests::set_online_and_last_scanned_persist fs_guard`
Expected: 3件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/directories.rs src-tauri/src/fs_guard.rs src-tauri/src/lib.rs
git commit -m "feat(scan): add directory scan-state helpers and reachability guard"
```

---

## Task 11: スキャナコア（走査・変更検出・解析・サムネ・missing）

**Files:**
- Create: `src-tauri/src/scanner.rs`
- Modify: `src-tauri/src/lib.rs`（`mod scanner;` 追加）

- [ ] **Step 1: モジュール宣言**

`src-tauri/src/lib.rs` のモジュール宣言群に追記:
```rust
mod scanner;
```

- [ ] **Step 2: スキャナと失敗するテストを書く**

`src-tauri/src/scanner.rs` を作成:
```rust
use crate::db::{directories, images};
use crate::models::Directory;
use crate::{fs_guard, parser, thumbnail};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

const REACH_TIMEOUT: Duration = Duration::from_secs(3);
const EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// 進捗イベントのペイロード。
#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub directory_id: i64,
    pub processed: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScanSummary {
    pub reachable: bool,
    pub added_or_updated: usize,
    pub skipped: usize,
    pub missing: usize,
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 1ディレクトリをスキャンする。`on_progress` は1ファイルごとに呼ばれる。
/// 到達不可なら is_online=0 にして early return（解析しない）。
pub fn scan_directory<F: FnMut(ScanProgress)>(
    conn: &Connection,
    dir: &Directory,
    thumb_dir: &Path,
    now: i64,
    mut on_progress: F,
) -> rusqlite::Result<ScanSummary> {
    let root = Path::new(&dir.path);
    if !fs_guard::is_reachable(root, REACH_TIMEOUT) {
        directories::set_online(conn, dir.id, false)?;
        return Ok(ScanSummary { reachable: false, ..Default::default() });
    }

    // 対象ファイル列挙。
    let walker = walkdir::WalkDir::new(root).max_depth(if dir.recursive { usize::MAX } else { 1 });
    let files: Vec<std::path::PathBuf> = walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_image(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect();
    let total = files.len();

    let mut summary = ScanSummary { reachable: true, ..Default::default() };
    let mut seen: HashSet<String> = HashSet::new();

    for (i, file) in files.iter().enumerate() {
        let path_str = file.to_string_lossy().to_string();
        seen.insert(path_str.clone());

        let meta = match std::fs::metadata(file) {
            Ok(m) => m,
            Err(_) => continue, // 1ファイルの失敗で全体を止めない
        };
        let size = meta.len() as i64;
        let mtime = mtime_secs(&meta);

        // 変更検出: path+size+mtime 一致ならスキップ（再処理抑制）。
        if let Ok(Some((id, prev_size, prev_mtime))) =
            images::find_meta_by_path(conn, &path_str)
        {
            if prev_size == size && prev_mtime == mtime {
                images::mark_missing(conn, id, false)?;
                summary.skipped += 1;
                on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str.clone() });
                continue;
            }
        }

        // 解析（失敗しても全体は継続。寸法だけ不明な場合はスキップ）。
        let parsed = match parser::parse(file) {
            Ok(p) => p,
            Err(_) => {
                on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str.clone() });
                continue;
            }
        };

        // サムネ生成（失敗してもメタは登録）。
        let thumb_path = thumbnail::generate_thumbnail(file, thumb_dir)
            .ok()
            .map(|p| p.to_string_lossy().to_string());

        // XMPサイドカーのレーティング。
        let rating = parser::xmp::read_rating_sidecar(file);

        let filename = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let new_img = images::NewImage {
            directory_id: dir.id,
            path: path_str.clone(),
            filename,
            size,
            mtime,
            created_at: Some(mtime),
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
        };
        images::upsert(conn, &new_img)?;
        summary.added_or_updated += 1;

        on_progress(ScanProgress { directory_id: dir.id, processed: i + 1, total, current: path_str });
    }

    // missing検出: DB上にあるが今回見つからなかったものに印を付ける（削除はしない）。
    for (id, db_path) in images::list_paths_in_directory(conn, dir.id)? {
        if !seen.contains(&db_path) {
            images::mark_missing(conn, id, true)?;
            summary.missing += 1;
        }
    }

    directories::set_online(conn, dir.id, true)?;
    directories::set_last_scanned(conn, dir.id, now)?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use std::io::BufWriter;

    fn write_png_with_params(path: &Path, params: &str) {
        let file = std::fs::File::create(path).unwrap();
        let w = BufWriter::new(file);
        let mut encoder = png::Encoder::new(w, 4, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.add_text_chunk("parameters".into(), params.into()).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&vec![0u8; 4 * 2 * 4]).unwrap();
    }

    fn setup() -> (Connection, std::path::PathBuf, Directory) {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        let base = std::env::temp_dir().join(format!("gim_scan_{}_{}", std::process::id(), now_nonce()));
        std::fs::create_dir_all(&base).unwrap();
        let dir = directories::add(&c, base.to_str().unwrap(), "scan", true).unwrap();
        (c, base, dir)
    }

    fn now_nonce() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn scans_inserts_and_change_detection_skips() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(&base.join("a.png"), "a cat\nSteps: 10, Seed: 1");
        write_png_with_params(&base.join("b.png"), "a dog\nSteps: 12, Seed: 2");

        let s1 = scan_directory(&c, &dir, &thumb_dir, 1000, |_| {}).unwrap();
        assert!(s1.reachable);
        assert_eq!(s1.added_or_updated, 2);
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 2);

        // 2回目: 変更なし → 全てスキップ。
        let s2 = scan_directory(&c, &dir, &thumb_dir, 1001, |_| {}).unwrap();
        assert_eq!(s2.added_or_updated, 0);
        assert_eq!(s2.skipped, 2);

        // 検索（FTS）が効く。
        let hits: i64 = c
            .query_row("SELECT count(*) FROM images_fts WHERE images_fts MATCH 'cat'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hits, 1);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn deleted_file_is_marked_missing() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        let a = base.join("a.png");
        write_png_with_params(&a, "x\nSteps: 1, Seed: 1");
        scan_directory(&c, &dir, &thumb_dir, 1000, |_| {}).unwrap();
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 1);

        std::fs::remove_file(&a).unwrap();
        let s = scan_directory(&c, &dir, &thumb_dir, 1001, |_| {}).unwrap();
        assert_eq!(s.missing, 1);
        // missing は count から除外（行は残る）。
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 0);
        let rows: i64 = c.query_row("SELECT count(*) FROM images", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unreachable_directory_sets_offline() {
        let c = Connection::open_in_memory().unwrap();
        migrations::run(&c).unwrap();
        let dir = directories::add(&c, "/no/such/path/gim_unreachable", "x", true).unwrap();
        let s = scan_directory(&c, &dir, Path::new("/tmp/thumbs"), 1000, |_| {}).unwrap();
        assert!(!s.reachable);
        assert!(!directories::get(&c, dir.id).unwrap().is_online);
    }
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test scanner`
Expected: 3件 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scanner.rs src-tauri/src/lib.rs
git commit -m "feat(scan): scanner core with change detection, parse, thumbnail, missing"
```

---

## Task 12: Db を Arc 化 + scanコマンド + 進捗イベント

**Files:**
- Modify: `src-tauri/src/db/mod.rs`（`Db(Arc<Mutex<Connection>>)`）
- Modify: `src-tauri/src/lib.rs`（Db初期化、`Emitter`、scanモジュール・コマンド登録）
- Modify: `src-tauri/src/commands/mod.rs`（`pub mod scan;`）
- Create: `src-tauri/src/commands/scan.rs`

- [ ] **Step 1: Db を Arc 化**

`src-tauri/src/db/mod.rs` の `Db` 定義を変更:
```rust
use std::sync::{Arc, Mutex};

/// Tauri管理状態として保持するDBハンドル。
pub struct Db(pub Arc<Mutex<Connection>>);
```
（`use std::sync::Mutex;` の行を上記に置換。既存の `db.0.lock()` 呼び出しは `Arc<Mutex<_>>` でもそのまま動作する。）

`src-tauri/src/lib.rs` の `setup` でのDb生成を変更:
```rust
            app.manage(db::Db(std::sync::Arc::new(std::sync::Mutex::new(conn))));
```
（`use std::sync::Mutex;` を使っていた場合は `std::sync::{Arc, Mutex}` に。）

- [ ] **Step 2: scanコマンドモジュールを登録**

`src-tauri/src/commands/mod.rs` に追記:
```rust
pub mod scan;
```
`src-tauri/src/lib.rs` の冒頭 `use tauri::Manager;` の隣に追記:
```rust
use tauri::Emitter;
```
`invoke_handler!` に5コマンドを追加（既存3つは残す）:
```rust
            commands::scan::scan_directory,
            commands::scan::scan_all,
            commands::scan::rebuild_directory,
            commands::scan::rebuild_all,
            commands::scan::count_images,
```

- [ ] **Step 3: scanコマンドを実装**

`src-tauri/src/commands/scan.rs` を作成:
```rust
use crate::db::{directories, images, Db};
use crate::scanner;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

fn thumb_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("thumbnails"))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 1ディレクトリをバックグラウンドでスキャンし、進捗を `scan-progress`、完了を `scan-done` で通知する。
#[tauri::command]
pub fn scan_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        run_scan_ids(&app, conn_arc, &td, &[id]);
    });
    Ok(())
}

/// 全ディレクトリをバックグラウンドでスキャンする。
#[tauri::command]
pub fn scan_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap();
            directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect()
        };
        run_scan_ids(&app, conn_arc, &td, &ids);
    });
    Ok(())
}

/// 指定ディレクトリの画像を削除してから再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_directory(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        {
            let conn = conn_arc.lock().unwrap();
            let _ = images::delete_by_directory(&conn, id);
        }
        run_scan_ids(&app, conn_arc, &td, &[id]);
    });
    Ok(())
}

/// 全ディレクトリの画像を削除してから全再スキャン（再構築）。
#[tauri::command]
pub fn rebuild_all(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn_arc: Arc<Mutex<_>> = db.0.clone();
    let td = thumb_dir(&app)?;
    tauri::async_runtime::spawn(async move {
        let ids: Vec<i64> = {
            let conn = conn_arc.lock().unwrap();
            let ids: Vec<i64> = directories::list(&conn).unwrap_or_default().into_iter().map(|d| d.id).collect();
            for id in &ids {
                let _ = images::delete_by_directory(&conn, *id);
            }
            ids
        };
        run_scan_ids(&app, conn_arc, &td, &ids);
    });
    Ok(())
}

/// ディレクトリ内の（missing除く）画像件数を返す。
#[tauri::command]
pub fn count_images(db: State<Db>, id: i64) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    images::count_in_directory(&conn, id).map_err(|e| e.to_string())
}

/// 指定IDのディレクトリ群を順にスキャンし、進捗/完了イベントを発火する。
fn run_scan_ids(app: &AppHandle, conn_arc: Arc<Mutex<rusqlite::Connection>>, thumb_dir: &std::path::Path, ids: &[i64]) {
    let now = now_secs();
    for &id in ids {
        let conn = conn_arc.lock().unwrap();
        let dir = match directories::get(&conn, id) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let app_for_cb = app.clone();
        let _ = scanner::scan_directory(&conn, &dir, thumb_dir, now, |p| {
            let _ = app_for_cb.emit("scan-progress", &p);
        });
        drop(conn);
        let _ = app.emit("scan-done", id);
    }
}
```

- [ ] **Step 4: コンパイルと既存テストの確認**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build && cargo test
```
Expected: ビルド成功。これまでの全テスト（migrations/images/parser/thumbnail/directories/fs_guard/scanner）が PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/mod.rs src-tauri/src/lib.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/scan.rs
git commit -m "feat(commands): add scan/rebuild commands with progress events (Arc db handle)"
```

---

## Task 13: フロント — スキャン操作・進捗・件数表示

**Files:**
- Modify: `src/types.ts`（`ScanProgress` 型）
- Create: `src/api/scan.ts`
- Modify: `src/store/useLibraryStore.ts`（scanning/imageCounts と scanアクション、進捗購読）
- Test: `src/store/useLibraryStore.test.ts`（追加テスト）
- Modify: `src/components/DirectoryPanel.tsx`（スキャン/全スキャンボタン・進捗・件数）

- [ ] **Step 1: 型とAPIラッパを追加**

`src/types.ts` に追記:
```ts
export interface ScanProgress {
  directory_id: number;
  processed: number;
  total: number;
  current: string;
}
```

`src/api/scan.ts` を作成:
```ts
import { invoke } from "@tauri-apps/api/core";

export const scanDirectory = (id: number) => invoke<void>("scan_directory", { id });
export const scanAll = () => invoke<void>("scan_all");
export const rebuildDirectory = (id: number) => invoke<void>("rebuild_directory", { id });
export const rebuildAll = () => invoke<void>("rebuild_all");
export const countImages = (id: number) => invoke<number>("count_images", { id });
```

- [ ] **Step 2: ストアに失敗するテストを書く**

`src/store/useLibraryStore.test.ts` の `describe` 内に追加:
```ts
  it("setScanProgress and clearScanProgress update scanning map", () => {
    useLibraryStore.getState().setScanProgress({
      directory_id: 1,
      processed: 3,
      total: 10,
      current: "/p/a.png",
    });
    expect(useLibraryStore.getState().scanning[1]?.processed).toBe(3);
    useLibraryStore.getState().clearScanProgress(1);
    expect(useLibraryStore.getState().scanning[1]).toBeUndefined();
  });

  it("setImageCount stores the count by directory id", () => {
    useLibraryStore.getState().setImageCount(2, 42);
    expect(useLibraryStore.getState().imageCounts[2]).toBe(42);
  });
```
（ファイル冒頭の `beforeEach` に `scanning`/`imageCounts` のリセットを追加しておく:）
```ts
beforeEach(() => {
  useLibraryStore.setState({ directories: [], scanning: {}, imageCounts: {} });
  vi.resetAllMocks();
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test`
Expected: FAIL（`setScanProgress` 等が未定義）。

- [ ] **Step 4: ストアを拡張**

`src/store/useLibraryStore.ts` を更新（既存の directories 周りは維持し、state とアクションを追加）:
```ts
import { create } from "zustand";
import type { Directory, ScanProgress } from "../types";
import * as api from "../api/directories";

interface LibraryState {
  directories: Directory[];
  scanning: Record<number, ScanProgress | undefined>;
  imageCounts: Record<number, number>;
  loadDirectories: () => Promise<void>;
  addDirectory: (path: string, recursive: boolean) => Promise<void>;
  removeDirectory: (id: number) => Promise<void>;
  setScanProgress: (p: ScanProgress) => void;
  clearScanProgress: (id: number) => void;
  setImageCount: (id: number, count: number) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  directories: [],
  scanning: {},
  imageCounts: {},
  loadDirectories: async () => {
    set({ directories: await api.listDirectories() });
  },
  addDirectory: async (path, recursive) => {
    const created = await api.addDirectory(path, recursive);
    set({ directories: [...get().directories, created] });
  },
  removeDirectory: async (id) => {
    await api.removeDirectory(id);
    set({ directories: get().directories.filter((d) => d.id !== id) });
  },
  setScanProgress: (p) => set({ scanning: { ...get().scanning, [p.directory_id]: p } }),
  clearScanProgress: (id) => {
    const next = { ...get().scanning };
    delete next[id];
    set({ scanning: next });
  },
  setImageCount: (id, count) => set({ imageCounts: { ...get().imageCounts, [id]: count } }),
}));
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test`
Expected: 既存5件＋新規2件＝7件 PASS。

- [ ] **Step 6: DirectoryPanel にスキャンUIと進捗購読を実装**

`src/components/DirectoryPanel.tsx` を更新:
```tsx
import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "../store/useLibraryStore";
import type { ScanProgress } from "../types";
import * as scanApi from "../api/scan";

export function DirectoryPanel() {
  const directories = useLibraryStore((s) => s.directories);
  const addDirectory = useLibraryStore((s) => s.addDirectory);
  const removeDirectory = useLibraryStore((s) => s.removeDirectory);
  const scanning = useLibraryStore((s) => s.scanning);
  const imageCounts = useLibraryStore((s) => s.imageCounts);
  const setScanProgress = useLibraryStore((s) => s.setScanProgress);
  const clearScanProgress = useLibraryStore((s) => s.clearScanProgress);
  const setImageCount = useLibraryStore((s) => s.setImageCount);

  // バックエンドの進捗/完了イベントを購読。
  useEffect(() => {
    const unlistenProgress = listen<ScanProgress>("scan-progress", (e) => {
      setScanProgress(e.payload);
    });
    const unlistenDone = listen<number>("scan-done", async (e) => {
      const id = e.payload;
      clearScanProgress(id);
      try {
        setImageCount(id, await scanApi.countImages(id));
      } catch (err) {
        console.error("count_images failed:", err);
      }
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [setScanProgress, clearScanProgress, setImageCount]);

  const handleAdd = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await addDirectory(selected, true);
      }
    } catch (e) {
      console.error("ディレクトリの追加に失敗しました:", e);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeDirectory(id);
    } catch (e) {
      console.error("ディレクトリの削除に失敗しました:", e);
    }
  };

  const handleScan = async (id: number) => {
    try {
      await scanApi.scanDirectory(id);
    } catch (e) {
      console.error("スキャンの開始に失敗しました:", e);
    }
  };

  const handleScanAll = async () => {
    try {
      await scanApi.scanAll();
    } catch (e) {
      console.error("全スキャンの開始に失敗しました:", e);
    }
  };

  return (
    <aside className="directory-panel">
      <div className="panel-header">
        <h2>ディレクトリ</h2>
        <button onClick={handleAdd}>＋ 追加</button>
      </div>
      <button className="scan-all-btn" onClick={handleScanAll}>
        全スキャン
      </button>
      <ul className="directory-list">
        {directories.map((d) => {
          const prog = scanning[d.id];
          return (
            <li key={d.id} className="directory-item">
              <span className="dir-label" title={d.path}>
                {d.label}
              </span>
              {!d.is_online && <span className="offline-badge">⦿offline</span>}
              {prog ? (
                <span className="scan-progress">
                  {prog.processed}/{prog.total}
                </span>
              ) : (
                <span className="image-count">{imageCounts[d.id] ?? ""}</span>
              )}
              <button className="scan-btn" onClick={() => handleScan(d.id)}>
                ⟳
              </button>
              <button className="remove-btn" onClick={() => handleRemove(d.id)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 7: ビルドとテストの最終確認**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager && npm run build && npm test
```
Expected: ビルド成功、フロント7件 PASS。

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/api/scan.ts src/store/useLibraryStore.ts src/store/useLibraryStore.test.ts src/components/DirectoryPanel.tsx
git commit -m "feat(frontend): scan/rebuild controls, live progress and image counts"
```

---

## Task 14: 結合・手動スモークテスト

**Files:** なし（検証のみ）

- [ ] **Step 1: 全自動テスト**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test
cd /Users/ikomiki/workspace/gen-img-manager && npm test
```
Expected: Rust 側全テスト・フロント7件すべて PASS。

- [ ] **Step 2: 開発モードで起動**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run tauri dev`

- [ ] **Step 3: 実画像でスキャン確認**

操作: SD/ComfyUIで生成したPNGを含むフォルダ（無ければ任意の画像フォルダ）を追加 → 「⟳」スキャン。
Expected: 進捗 `処理数/総数` が更新され、完了後に件数が表示される。サムネイルが `~/Library/Application Support/com.technonet.genimgmanager/thumbnails/` に生成される。

- [ ] **Step 4: 再スキャン（変更検出）の確認**

操作: 同じディレクトリをもう一度スキャン。
Expected: 2回目は高速（既存ファイルはスキップ）。ファイルを1つ削除して再スキャンすると、その分の件数が減る（missing印）。

- [ ] **Step 5: 切断耐性の確認（任意）**

操作: 存在しないネットワークパス（例 `/Volumes/NoSuchShare`）を追加してスキャン。
Expected: アプリは固まらず、該当ディレクトリが `⦿offline` 表示になる。

- [ ] **Step 6: マイルストーン完了コミット**

```bash
cd /Users/ikomiki/workspace/gen-img-manager
git commit --allow-empty -m "chore: milestone 2 complete - scan, parse, thumbnail pipeline"
```

---

## このプランで満たす設計書の項目（自己レビュー）

- §1 対応フォーマット（PNG/JPEG/WebP）✔（Task 6,7,8）
- §3 データモデル: `images`／`images_fts`(FTS5 external-content)／トリガ同期／各種INDEX／`pixels`列／`comfy_workflow`原文／`rating`(NULL可) ✔（Task 1,2）
- §4 スキャンパイプライン: fs-guard到達性→walkdir列挙→(path+size+mtime)変更検出→解析→サムネ→UPSERT＋FTS同期→進捗イベント→missing印（誤削除しない）✔（Task 10,11,12）。手動＋（このマイルストーンでは手動トリガ）。起動時差分は計画3でアプリ起動フローに組込む。
- §4 parser: PNG(tEXt/iTXt/zTXt)・JPEG/WebP(EXIF UserComment)・XMPサイドカー(rating)・A1111正規化・ComfyUI抽出（ベストエフォート）✔（Task 3-8）
- §4 再構築: ディレクトリ単位／全件 ✔（Task 12 rebuild_directory/rebuild_all）
- §4 耐障害性: 1ファイル失敗で全体を止めない／到達不可は即offline ✔（Task 11）
- §10 エラー処理: 解析・サムネ失敗を項目単位で握り継続 ✔（Task 11）

**計画3以降に持ち越す項目（このプランの範囲外）:** クエリ構文パーサ／フィルタ欄・詳細ダイアログ／ソート／正方形サムネのレスポンシブ仮想グリッド表示／ヒストリ／ビューア／スライドショー。サムネイルの**表示**は計画3（このプランは生成・キャッシュまで）。スキャン中のDBロックは単一接続を全スキャンで保持する簡易方式であり、UI同時クエリが増える計画3で読み取り専用接続の分離等を検討する（既知の改善ポイント）。

## 既知の注意点・実装時のリスク

- **クレートAPIのバージョン差**: `quick-xml`（`config_mut().trim_text` vs `trim_text`）、`kamadak-exif`（`exif::Value`/`Tag`/`In` のパス）、`webp`（`Encoder::from_image` の戻り値型）、`image` 0.25（WebPエンコード不可のためサムネは`webp`クレートで生成）。コンパイルエラーが出たら実バージョンのAPIに合わせる。各タスクのテストがガードになる。
- **`png` クレートの二重利用**: `parser/png.rs`（自モジュール名 `png`）とクレート `png` の名前衝突。Task 8 の注記どおり再エクスポート（`png_crate`）で回避する。
- **ComfyUIの正負区別**: グラフ構造依存で信頼できないため、テキストはすべて結合して全文検索対象にする（設計書のベストエフォート方針どおり）。
- **トレイリングiTXt**: `read_info` はIDAT前のテキストチャンクを取得する。A1111/ComfyUIはIDAT前に書くため実用上問題ないが、IDAT後にのみiTXtを置く稀なファイルは取りこぼす（既知の限界）。
