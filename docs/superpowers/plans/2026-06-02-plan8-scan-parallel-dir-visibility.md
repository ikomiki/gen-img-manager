# メタ並列スキャン・ディレクトリ可視切替・2行表示・削除確認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ディレクトリスキャンのメタ情報読み込みを並列化（NAS over LAN 想定）し、ディレクトリごとの表示/非表示トグル（永続化）・2行表示のステータス行・削除前確認ダイアログを追加する。

**Architecture:** バックエンド（Rust/Tauri）は rayon ワーカープールで「stat→変更検出→parse→サムネ生成」を並列実行し、DB書き込みは単一接続で逐次。変更検出は事前ロードした既存メタの共有マップ参照で行いDBに触らない。可視状態は `directories.visible` 列（v4マイグレーション）に永続化し、クエリは常にサブクエリで非表示ディレクトリを除外する。フロントエンド（React/Zustand）は2行レイアウト・目玉SVGトグル・再利用可能な確認モーダルを追加する。純粋ロジック（`decide`/`should_emit`/`dirStatusLine`/整形関数）を切り出して vitest / cargo test でテストする。

**Tech Stack:** Tauri 2, Rust, rusqlite, rayon（新規追加）, React 19, Zustand 5, TypeScript（strict）, Vitest。

**実装/検証コマンド:**
- Rust 単体: `cargo test -p gen-img-manager` （`src-tauri/` で実行）
- フロント単体: `npx vitest run <path>`
- 型チェック: `npx tsc -p tsconfig.json`
- ビルド: `npm run build`

**前提知識（既存コードの事実）:**
- `images.directory_id` は `ON DELETE CASCADE`。ディレクトリ削除でDB上の画像メタ＋FTS＋（後述の通り）サムネパス参照も連動削除されるが、ディスク上の元画像は消えない。
- マイグレーションは `src-tauri/src/db/migrations.rs` の `MIGRATIONS: &[&str]` に**追記のみ**。配列 index+1 がバージョン。現在 v3。
- `settings` テーブル（`db/settings.rs` の `get`/`set`）は app_data_dir 配下の DB にあり OS/ユーザーごとに自動分離。
- スキャンは `commands/scan.rs::run_scan_ids` が単一接続ロックを保持して `scanner::scan_directory` を順に呼ぶ。`scan-progress`/`scan-done` イベントで進捗/完了を通知。

---

## File Structure

**バックエンド（Rust, `src-tauri/src/`）:**
- `db/migrations.rs` — v4 マイグレーション（`directories.visible`）追加。Modify。
- `models.rs` — `Directory` 構造体に `visible` 追加。Modify。
- `db/directories.rs` — SELECT 列追加・`set_visible` 追加。Modify。
- `db/image_query.rs` — `query_images`/`count_query` に可視フィルタ追加。Modify。
- `db/images.rs` — `list_meta_in_directory`（変更検出＋missing検出用の事前ロード）追加。Modify。
- `commands/directories.rs` — `set_directory_visible` コマンド追加。Modify。
- `commands/scan.rs` — `run_scan_ids` が `scan_concurrency` 設定を読み、`scan_directory` に並列度を渡す。Modify。
- `scanner.rs` — `decide`/`should_emit`/`process_one`/`FileOutcome` を導入し `scan_directory` を rayon 並列に書き換え。**既存 `mod tests` の `scan_directory` 呼び出しを新シグネチャに更新**。Modify。
- `lib.rs` — `set_directory_visible` を `invoke_handler` に登録。Modify。
- `Cargo.toml` — `rayon` を依存に追加。Modify。（テスト用テンポラリは既存テスト同様 `std::env::temp_dir()` を使うため `tempfile` は不要。）

**フロントエンド（TS/React, `src/`）:**
- `types.ts` — `Directory` に `visible` 追加。Modify。
- `api/directories.ts` — `setDirectoryVisible` 追加。Modify。
- `store/useLibraryStore.ts` — `setDirectoryVisible` アクション追加。Modify。
- `util/dirStatus.ts` — 2行目ステータス整形の純粋関数。Create。
- `util/dirStatus.test.ts` — 上のテスト。Create。
- `components/ConfirmDialog.tsx` — 再利用可能な確認モーダル。Create。
- `components/DirectoryPanel.tsx` — 2行レイアウト・目玉トグル・削除確認の組み込み。Modify。
- `App.css` — ディレクトリ行2行化・目玉ボタン・危険色ボタン等のCSS。Modify。

---

## Task 1: v4 マイグレーション（directories.visible）

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

**Model:** 安価なモデルで可（機械的）。

- [ ] **Step 1: 既存テストの期待バージョンを 3→4 に更新（失敗を作る前準備）**

`src-tauri/src/db/migrations.rs` の `#[cfg(test)] mod tests` 内、`assert_eq!(v, 3)` が4箇所ある。すべて `assert_eq!(v, 4)` に変更する（テスト名 `v3_creates_history_and_settings_and_version_is_3` はそのままでよい）。

- [ ] **Step 2: v4 マイグレーションの新規テストを追加（失敗するテスト）**

`mod tests` の末尾（`}` の直前）に追加:

```rust
    #[test]
    fn v4_adds_visible_column_default_1() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 4);
        conn.execute(
            "INSERT INTO directories (path, label, recursive) VALUES ('/d', 'd', 1)",
            [],
        )
        .unwrap();
        let visible: i64 = conn
            .query_row("SELECT visible FROM directories WHERE path = '/d'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(visible, 1, "new directories must default to visible");
    }
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager db::migrations`
Expected: FAIL（`v == 4` の不一致、または `no such column: visible`）。

- [ ] **Step 4: v4 マイグレーションを追加**

`MIGRATIONS` 配列の v3 要素の後（閉じ `];` の直前）に、末尾カンマ付きで追記:

```rust
    // v4: directories.visible（目玉トグルの表示/非表示状態。既存は全て可視=1）
    "ALTER TABLE directories ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;",
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager db::migrations`
Expected: PASS（全マイグレーションテスト + 新規 v4 テスト）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): add v4 migration for directories.visible column"
```

---

## Task 2: Directory モデル・directories.rs に visible を反映

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db/directories.rs`

**Model:** 安価なモデルで可（機械的）。

- [ ] **Step 1: 失敗するテストを追加（set_visible と list/get が visible を返す）**

`src-tauri/src/db/directories.rs` の `mod tests` の末尾に追加:

```rust
    #[test]
    fn new_directory_is_visible_by_default() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        assert!(d.visible, "new directory should be visible");
    }

    #[test]
    fn set_visible_persists() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        set_visible(&c, d.id, false).unwrap();
        assert!(!get(&c, d.id).unwrap().visible);
        set_visible(&c, d.id, true).unwrap();
        assert!(get(&c, d.id).unwrap().visible);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager db::directories`
Expected: FAIL（`visible` フィールド未定義 / `set_visible` 未定義でコンパイルエラー）。

- [ ] **Step 3: Directory 構造体に visible を追加**

`src-tauri/src/models.rs` の `Directory` に `recursive` の後ろへ追加:

```rust
    pub recursive: bool,
    pub visible: bool,
}
```

- [ ] **Step 4: directories.rs の SELECT・row_to_dir・set_visible を更新**

`src-tauri/src/db/directories.rs` を以下の通り変更する。

`get` の SQL:
```rust
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible
         FROM directories WHERE id = ?1",
```

`list` の SQL:
```rust
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible
         FROM directories ORDER BY label COLLATE NOCASE",
```

`row_to_dir` に列インデックス6を追加:
```rust
fn row_to_dir(r: &rusqlite::Row) -> rusqlite::Result<Directory> {
    Ok(Directory {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        is_online: r.get::<_, i64>(3)? != 0,
        last_scanned_at: r.get(4)?,
        recursive: r.get::<_, i64>(5)? != 0,
        visible: r.get::<_, i64>(6)? != 0,
    })
}
```

`set_last_scanned` の後ろに `set_visible` を追加:
```rust
pub fn set_visible(conn: &Connection, id: i64, visible: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE directories SET visible = ?2 WHERE id = ?1",
        params![id, visible as i64],
    )?;
    Ok(())
}
```

（`add` の INSERT は変更不要。`visible` は DEFAULT 1 で入る。）

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager db::directories`
Expected: PASS。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/models.rs src-tauri/src/db/directories.rs
git commit -m "feat(db): add visible field to Directory and set_visible"
```

---

## Task 3: クエリの可視フィルタ（image_query）

**Files:**
- Modify: `src-tauri/src/db/image_query.rs`

**Model:** 安価なモデルで可（機械的）。

- [ ] **Step 1: 失敗するテストを追加（非表示ディレクトリは一覧・件数から除外）**

`src-tauri/src/db/image_query.rs` の `mod tests` の末尾（最後の `}` の直前）に追加:

```rust
    #[test]
    fn invisible_directory_excluded_from_query_and_count() {
        let c = conn();
        seed(&c);
        // 全件見える状態。
        assert_eq!(count_query(&c, "").unwrap(), 3);
        // ディレクトリ1を非表示にすると、その配下は除外される。
        c.execute("UPDATE directories SET visible = 0 WHERE id = 1", []).unwrap();
        assert_eq!(count_query(&c, "").unwrap(), 0);
        let rows = query_images(&c, "", SortKey::Filename, SortDir::Asc, 100, 0).unwrap();
        assert_eq!(rows.len(), 0);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager db::image_query`
Expected: FAIL（非表示にしても 3 件のまま返る）。

- [ ] **Step 3: query_images / count_query に可視フィルタを追加**

`query_images` の `sql` を以下に変更（`WHERE` 句を括弧で包み、可視サブクエリを AND 連結）:

```rust
    let sql = format!(
        "SELECT {cols} FROM images WHERE ({where_sql}) \
         AND directory_id IN (SELECT id FROM directories WHERE visible = 1) \
         ORDER BY {sortcol} {sortdir}, id {sortdir} LIMIT ? OFFSET ?",
        cols = SELECT_COLS,
        where_sql = cf.where_sql,
        sortcol = sort.column(),
        sortdir = dir.sql(),
    );
```

`count_query` の `sql` を以下に変更:

```rust
    let sql = format!(
        "SELECT count(*) FROM images WHERE ({}) \
         AND directory_id IN (SELECT id FROM directories WHERE visible = 1)",
        cf.where_sql
    );
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager db::image_query`
Expected: PASS（新規テスト + 既存テスト全て。既存テストは directory.visible が DEFAULT 1 のため影響なし）。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/db/image_query.rs
git commit -m "feat(query): exclude invisible directories from image query and count"
```

---

## Task 4: 可視トグルのコマンド・API・ストア・型

**Files:**
- Modify: `src-tauri/src/commands/directories.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Modify: `src/api/directories.ts`
- Modify: `src/store/useLibraryStore.ts`

**Model:** 標準モデル（複数ファイル・フロント/バック横断の結線）。

- [ ] **Step 1: Tauri コマンド set_directory_visible を追加**

`src-tauri/src/commands/directories.rs` の末尾に追加:

```rust
#[tauri::command]
pub fn set_directory_visible(db: State<Db>, id: i64, visible: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::set_visible(&conn, id, visible).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: コマンドを invoke_handler に登録**

`src-tauri/src/lib.rs` の `commands::directories::remove_directory,` の直後に追加:

```rust
            commands::directories::remove_directory,
            commands::directories::set_directory_visible,
```

- [ ] **Step 3: Rust をビルドしてコンパイルを確認**

Run: `cargo build -p gen-img-manager`（`src-tauri/` で実行）
Expected: 成功（警告のみ可）。

- [ ] **Step 4: TS の Directory 型に visible を追加**

`src/types.ts` の `Directory` を変更:

```ts
export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
  visible: boolean;
}
```

- [ ] **Step 5: API ラッパーを追加**

`src/api/directories.ts` の末尾に追加:

```ts
export const setDirectoryVisible = (id: number, visible: boolean) =>
  invoke<void>("set_directory_visible", { id, visible });
```

- [ ] **Step 6: ストアにアクションを追加**

`src/store/useLibraryStore.ts` の `LibraryState` インターフェースに、`removeDirectory` の後へ追加:

```ts
  removeDirectory: (id: number) => Promise<void>;
  setDirectoryVisible: (id: number, visible: boolean) => Promise<void>;
```

実装本体に、`removeDirectory` の後へ追加:

```ts
  setDirectoryVisible: async (id, visible) => {
    await api.setDirectoryVisible(id, visible);
    set({
      directories: get().directories.map((d) =>
        d.id === id ? { ...d, visible } : d,
      ),
    });
  },
```

- [ ] **Step 7: 型チェック**

Run: `npx tsc -p tsconfig.json`
Expected: エラーなし。

> 注: 既存の `useLibraryStore.test.ts` がモック `Directory` を生成している場合、`visible` 必須化で型エラーになる可能性がある。エラーが出たらモックに `visible: true` を補う。

- [ ] **Step 8: コミット**

```bash
git add src-tauri/src/commands/directories.rs src-tauri/src/lib.rs src/types.ts src/api/directories.ts src/store/useLibraryStore.ts
git commit -m "feat: wire set_directory_visible command through api and store"
```

---

## Task 5: 並列スキャンの純粋関数（decide / should_emit）

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/scanner.rs`

**Model:** 安価なモデルで可（純粋関数 + テスト）。

- [ ] **Step 1: rayon 依存を追加**

`src-tauri/Cargo.toml` の `[dependencies]` 末尾（`thiserror = "1"` の後）に追加:

```toml
rayon = "1"
```

（テスト用テンポラリは既存 `mod tests` と同じく `std::env::temp_dir()` を使うため `tempfile` は追加しない。）

- [ ] **Step 2: scanner.rs の既存 `mod tests` に純粋関数のテストを追加（失敗するテスト）**

`src-tauri/src/scanner.rs` には既に `#[cfg(test)] mod tests`（`use super::*;` 済み）がある。その**末尾の閉じ `}` の直前**に以下のテストを追記する（新しいモジュールは作らない）:

```rust
    #[test]
    fn decide_skip_when_unchanged() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(
            decide(100, 200, Some(&prev)),
            Decision::Skip { id: 7, was_missing: false }
        );
    }

    #[test]
    fn decide_skip_reports_was_missing() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: true };
        assert_eq!(
            decide(100, 200, Some(&prev)),
            Decision::Skip { id: 7, was_missing: true }
        );
    }

    #[test]
    fn decide_needs_parse_when_size_changed() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(decide(101, 200, Some(&prev)), Decision::NeedsParse);
    }

    #[test]
    fn decide_needs_parse_when_mtime_changed() {
        let prev = PrevMeta { id: 7, size: 100, mtime: 200, missing: false };
        assert_eq!(decide(100, 201, Some(&prev)), Decision::NeedsParse);
    }

    #[test]
    fn decide_needs_parse_when_new() {
        assert_eq!(decide(100, 200, None), Decision::NeedsParse);
    }

    #[test]
    fn should_emit_on_interval_and_final() {
        assert!(should_emit(25, 1000, 25));
        assert!(should_emit(50, 1000, 25));
        assert!(!should_emit(24, 1000, 25));
        assert!(should_emit(1000, 1000, 25)); // 最終件は必ず
        assert!(should_emit(0, 0, 25)); // 0件: processed==total==0
    }
```

（上記は既存 `mod tests` 内に追記するため、囲みの `mod ... {` / `}` は付けない。）

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager scanner::tests`
Expected: FAIL（`PrevMeta`/`Decision`/`decide`/`should_emit` 未定義のコンパイルエラー）。

- [ ] **Step 4: 純粋関数と型を scanner.rs に実装**

`src-tauri/src/scanner.rs` の冒頭付近（`use` 群の後、既存の定数や関数の前）に追加:

```rust
/// 進捗 emit を間引く間隔（件）。
pub const EMIT_INTERVAL: usize = 25;
/// 並列スキャンの既定同時実行数（settings の scan_concurrency で上書き）。
pub const DEFAULT_CONCURRENCY: usize = 8;

/// 事前ロードした既存画像メタ（変更検出用）。
#[derive(Debug, Clone, PartialEq)]
pub struct PrevMeta {
    pub id: i64,
    pub size: i64,
    pub mtime: i64,
    pub missing: bool,
}

/// 1ファイルの処理方針。
#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// 未変更。parse/サムネ不要。was_missing が真なら missing フラグ解除が必要。
    Skip { id: i64, was_missing: bool },
    /// 新規または変更。parse + サムネ生成が必要。
    NeedsParse,
}

/// stat 結果（size, mtime）と既存メタから処理方針を決める。
pub fn decide(size: i64, mtime: i64, prev: Option<&PrevMeta>) -> Decision {
    match prev {
        Some(p) if p.size == size && p.mtime == mtime => {
            Decision::Skip { id: p.id, was_missing: p.missing }
        }
        _ => Decision::NeedsParse,
    }
}

/// 進捗 emit すべきか（一定間隔ごと、かつ最終件は必ず）。
pub fn should_emit(processed: usize, total: usize, interval: usize) -> bool {
    processed == total || (interval > 0 && processed % interval == 0)
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager scanner::tests`
Expected: PASS（既存テスト + 追加した decide/should_emit テスト）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/src/scanner.rs
git commit -m "feat(scanner): add rayon dep and pure decide/should_emit helpers"
```

---

## Task 6: 既存メタの事前ロード（images::list_meta_in_directory）

**Files:**
- Modify: `src-tauri/src/db/images.rs`

**Model:** 安価なモデルで可（機械的）。

- [ ] **Step 1: 失敗するテストを追加**

`src-tauri/src/db/images.rs` の `mod tests` の末尾に追加:

```rust
    #[test]
    fn list_meta_in_directory_returns_all_fields() {
        let c = conn();
        let id = upsert(&c, &sample("/d/a.png")).unwrap();
        mark_missing(&c, id, true).unwrap();
        let metas = list_meta_in_directory(&c, 1).unwrap();
        assert_eq!(metas.len(), 1);
        let (path, got_id, size, mtime, missing) = &metas[0];
        assert_eq!(path, "/d/a.png");
        assert_eq!(*got_id, id);
        assert_eq!(*size, 100);
        assert_eq!(*mtime, 200);
        assert!(*missing);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager db::images`
Expected: FAIL（`list_meta_in_directory` 未定義）。

- [ ] **Step 3: list_meta_in_directory を実装**

`src-tauri/src/db/images.rs` の `list_paths_in_directory` の後ろに追加:

```rust
/// ディレクトリ配下の (path, id, size, mtime, missing) 一覧。
/// 変更検出（事前ロードマップ）と missing 検出の両方に使う。
pub fn list_meta_in_directory(
    conn: &Connection,
    directory_id: i64,
) -> rusqlite::Result<Vec<(String, i64, i64, i64, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT path, id, size, mtime, missing FROM images WHERE directory_id = ?1",
    )?;
    let rows = stmt.query_map(params![directory_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)? != 0,
        ))
    })?;
    rows.collect()
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager db::images`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/db/images.rs
git commit -m "feat(db): add list_meta_in_directory for scan preload"
```

---

## Task 7: scanner.rs の並列化と scan.rs の並列度受け渡し

**Files:**
- Modify: `src-tauri/src/scanner.rs`
- Modify: `src-tauri/src/commands/scan.rs`

**Model:** 標準〜高性能モデル（並列・所有権・統合テスト。最重要タスク）。

このタスクは「逐次の `for` ループ」を「rayon 並列の parse + 逐次 DB 書き込み」に置き換える。`scan_directory` のシグネチャに `concurrency: usize` を追加し、進捗コールバックを `FnMut` から `Fn + Sync`（複数スレッドから呼ばれるため）に変更する。唯一の呼び出し元 `run_scan_ids` も同時に更新してコンパイルを保つ。

**重要（既存テスト）:** `src-tauri/src/scanner.rs` には既に `mod tests` があり、`setup()`（`std::env::temp_dir()` ベースのテンポラリ作成）と `write_png_with_params(path, params)` ヘルパ、そして 3 つのテストが `scan_directory(&c, &dir, &thumb_dir, 1000, |_| {})` を**旧シグネチャ**で呼んでいる。これらは新シグネチャ（`concurrency` 追加）で**必ずコンパイルエラーになる**ため、本タスクで更新する。新しいテストも既存ヘルパを再利用する（`tempfile` は使わない）。

- [ ] **Step 1: 既存 `mod tests` に並列スキャンの新規テストを追加（失敗するテスト）**

`src-tauri/src/scanner.rs` の `mod tests` の末尾の閉じ `}` の直前に、既存ヘルパ（`setup`, `write_png_with_params`）を使うテストを追加する:

```rust
    #[test]
    fn parallel_scan_handles_many_files_and_skips_on_rescan() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        for i in 0..30 {
            write_png_with_params(&base.join(format!("f{i}.png")), &format!("p{i}\nSteps: 1, Seed: {i}"));
        }
        // 並列度8で初回スキャン: 30件追加。
        let s1 = scan_directory(&c, &dir, &thumb_dir, 1000, 8, |_| {}).unwrap();
        assert_eq!(s1.added_or_updated, 30);
        assert_eq!(images::count_in_directory(&c, dir.id).unwrap(), 30);
        // 再スキャン: 全件スキップ。
        let s2 = scan_directory(&c, &dir, &thumb_dir, 1001, 8, |_| {}).unwrap();
        assert_eq!(s2.added_or_updated, 0);
        assert_eq!(s2.skipped, 30);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn progress_callback_reaches_final_total() {
        let (c, base, dir) = setup();
        let thumb_dir = base.join("thumbs");
        write_png_with_params(&base.join("a.png"), "x\nSteps: 1, Seed: 1");
        write_png_with_params(&base.join("b.png"), "y\nSteps: 1, Seed: 2");

        let max_processed = std::sync::atomic::AtomicUsize::new(0);
        scan_directory(&c, &dir, &thumb_dir, 1000, 4, |p| {
            assert_eq!(p.total, 2);
            max_processed.fetch_max(p.processed, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(max_processed.load(std::sync::atomic::Ordering::Relaxed), 2);

        std::fs::remove_dir_all(&base).ok();
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cargo test -p gen-img-manager scanner::tests`
Expected: FAIL（新旧テストとも `scan_directory` の引数不一致でコンパイルエラー。まだ並列化前のシグネチャのため）。

- [ ] **Step 3: scanner.rs の use とヘルパ（process_one / FileOutcome）を追加**

`src-tauri/src/scanner.rs` の `use` 群に追加（既存の `use` の近く）:

```rust
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
```

`process_one` と結果型を、`scan_directory` の直前に追加:

```rust
/// 1ファイル分の並列処理の結果。DB 書き込みは呼び出し側（writer）で逐次行う。
enum FileOutcome {
    /// 未変更。was_missing が真なら missing フラグ解除のみ必要。
    Unchanged { id: i64, was_missing: bool },
    /// 新規/変更。parse + サムネ済み。
    Upsert(Box<images::NewImage>),
    /// stat / parse 失敗（集計しない＝現状踏襲）。
    Failed,
}

/// 1ファイルを処理する（DB には触れない）。stat→変更検出→（必要なら）parse+サムネ。
fn process_one(
    file: &Path,
    path_str: &str,
    prev_map: &std::collections::HashMap<String, PrevMeta>,
    thumb_dir: &Path,
) -> FileOutcome {
    let meta = match std::fs::metadata(file) {
        Ok(m) => m,
        Err(_) => return FileOutcome::Failed,
    };
    let size = meta.len() as i64;
    let mtime = mtime_secs(&meta);
    let created = created_secs(&meta, mtime);

    match decide(size, mtime, prev_map.get(path_str)) {
        Decision::Skip { id, was_missing } => FileOutcome::Unchanged { id, was_missing },
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
            FileOutcome::Upsert(Box::new(images::NewImage {
                directory_id: 0, // 呼び出し側で dir.id を設定する
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
            }))
        }
    }
}
```

> 注: `process_one` は `dir.id` を受け取らず `directory_id: 0` を入れる。並列クロージャ内で `dir` を借用するとライフタイム/Send の取り回しが増えるため、`directory_id` は writer ループで `img.directory_id = dir.id` を代入してから upsert する（次ステップ参照）。

- [ ] **Step 4: scan_directory 本体を並列版に書き換え**

`scan_directory` 関数全体（シグネチャ〜 `Ok(summary)`）を以下に置き換える:

```rust
pub fn scan_directory<F: Fn(ScanProgress) + Sync>(
    conn: &Connection,
    dir: &Directory,
    thumb_dir: &Path,
    now: i64,
    concurrency: usize,
    on_progress: F,
) -> rusqlite::Result<ScanSummary> {
    let root = Path::new(&dir.path);
    if !fs_guard::is_reachable(root, REACH_TIMEOUT) {
        directories::set_online(conn, dir.id, false)?;
        return Ok(ScanSummary { reachable: false, ..Default::default() });
    }

    // 対象ファイル列挙（thumb_dir 配下は除外）。
    let walker = walkdir::WalkDir::new(root).max_depth(if dir.recursive { usize::MAX } else { 1 });
    let files: Vec<std::path::PathBuf> = walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if !e.file_type().is_file() || !is_image(e.path()) {
                return false;
            }
            !e.path().starts_with(thumb_dir)
        })
        .map(|e| e.path().to_path_buf())
        .collect();
    let total = files.len();

    // 既存メタを一度だけ事前ロード（変更検出 + missing 検出に共用、DBアクセスは1回）。
    let existing = images::list_meta_in_directory(conn, dir.id)?;
    let prev_map: std::collections::HashMap<String, PrevMeta> = existing
        .iter()
        .map(|(path, id, size, mtime, missing)| {
            (
                path.clone(),
                PrevMeta { id: *id, size: *size, mtime: *mtime, missing: *missing },
            )
        })
        .collect();

    // 並列フェーズ: stat→decide→parse+サムネ。DBには触れない。
    let counter = AtomicUsize::new(0);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(concurrency.max(1))
        .build()
        .expect("failed to build rayon pool");
    let outcomes: Vec<FileOutcome> = pool.install(|| {
        files
            .par_iter()
            .map(|file| {
                let path_str = file.to_string_lossy().to_string();
                let outcome = process_one(file, &path_str, &prev_map, thumb_dir);
                let processed = counter.fetch_add(1, Ordering::Relaxed) + 1;
                if should_emit(processed, total, EMIT_INTERVAL) {
                    on_progress(ScanProgress {
                        directory_id: dir.id,
                        processed,
                        total,
                        current: path_str,
                    });
                }
                outcome
            })
            .collect()
    });
    // 最終進捗を必ず1回（0件でも UI を進める。current は空）。
    on_progress(ScanProgress { directory_id: dir.id, processed: total, total, current: String::new() });

    // 書き込みフェーズ（逐次・単一接続）。
    let mut summary = ScanSummary { reachable: true, ..Default::default() };
    for outcome in outcomes {
        match outcome {
            FileOutcome::Unchanged { id, was_missing } => {
                if was_missing {
                    images::mark_missing(conn, id, false)?;
                }
                summary.skipped += 1;
            }
            FileOutcome::Upsert(mut img) => {
                img.directory_id = dir.id;
                images::upsert(conn, &img)?;
                summary.added_or_updated += 1;
            }
            FileOutcome::Failed => {}
        }
    }

    // missing 検出: 列挙されなかった既存パスに印を付ける（事前ロード済み existing を再利用）。
    let seen: std::collections::HashSet<String> =
        files.iter().map(|f| f.to_string_lossy().to_string()).collect();
    for (db_path, id, _size, _mtime, _missing) in &existing {
        if !seen.contains(db_path) {
            images::mark_missing(conn, *id, true)?;
            summary.missing += 1;
        }
    }

    directories::set_online(conn, dir.id, true)?;
    directories::set_last_scanned(conn, dir.id, now)?;
    Ok(summary)
}
```

- [ ] **Step 5: commands/scan.rs の run_scan_ids を更新（並列度を読み、渡す）**

`src-tauri/src/commands/scan.rs` の `run_scan_ids` を以下に変更する。`let now = now_secs();` の直後に並列度の読み取りを追加し、`scan_directory` 呼び出しに `concurrency` 引数と `move` を加える:

```rust
    let now = now_secs();
    // 並列度（settings.scan_concurrency。未設定/不正なら既定値）。スキャン全体で1回読む。
    let concurrency = {
        let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::settings::get(&conn, "scan_concurrency")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|n| *n >= 1)
            .unwrap_or(scanner::DEFAULT_CONCURRENCY)
    };
    for &id in ids {
        let scan_ok = {
            let conn = conn_arc.lock().unwrap_or_else(|e| e.into_inner());
            match directories::get(&conn, id) {
                Ok(dir) => {
                    let app_cb = app.clone();
                    scanner::scan_directory(&conn, &dir, thumb_dir, now, concurrency, move |p| {
                        let _ = app_cb.emit("scan-progress", &p);
                    })
                    .is_ok()
                }
                Err(_) => false,
            }
        };
        let success = scan_ok && !failed_pre.contains(&id);
        let _ = app.emit("scan-done", ScanDone { directory_id: id, success });
    }
```

- [ ] **Step 5b: 既存 `mod tests` の旧シグネチャ呼び出しを更新**

`src-tauri/src/scanner.rs` の `mod tests` 内にある既存3テストの `scan_directory` 呼び出しに `concurrency` 引数（任意の値、例 `4`）を追加する:
- `scans_inserts_and_change_detection_skips`: 2箇所 `scan_directory(&c, &dir, &thumb_dir, 1000, |_| {})` → `scan_directory(&c, &dir, &thumb_dir, 1000, 4, |_| {})`、`..., 1001, |_| {}` → `..., 1001, 4, |_| {}`
- `deleted_file_is_marked_missing`: 2箇所 同様に `1000` / `1001` の呼び出しへ `4` を挿入
- `unreachable_directory_sets_offline`: `scan_directory(&c, &dir, Path::new("/tmp/thumbs"), 1000, |_| {})` → `..., 1000, 4, |_| {}`

- [ ] **Step 6: テストを実行して成功を確認**

Run: `cargo test -p gen-img-manager scanner::tests`
Expected: PASS（既存3テスト + 並列の新規2テスト + 純粋関数テスト）。

- [ ] **Step 7: 全 Rust テスト・ビルドを確認**

Run: `cargo test -p gen-img-manager` then `cargo build -p gen-img-manager`
Expected: 全テスト PASS、ビルド成功。

- [ ] **Step 8: コミット**

```bash
git add src-tauri/src/scanner.rs src-tauri/src/commands/scan.rs
git commit -m "feat(scanner): parallelize metadata scan with rayon, serial DB writes"
```

---

## Task 8: 2行ステータスの整形（純粋関数）

**Files:**
- Create: `src/util/dirStatus.ts`
- Create: `src/util/dirStatus.test.ts`

**Model:** 安価なモデルで可（純粋関数 + テスト）。

- [ ] **Step 1: 失敗するテストを作成**

`src/util/dirStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCount, formatScanTimestamp, dirStatusLine } from "./dirStatus";

describe("formatCount", () => {
  it("adds thousands separators and 枚 suffix", () => {
    expect(formatCount(1234)).toBe("1,234枚");
    expect(formatCount(0)).toBe("0枚");
  });
});

describe("formatScanTimestamp", () => {
  it("formats as YYYY-MM-DD HH:MM (zero-padded)", () => {
    // タイムゾーン非依存に形だけ検証する。
    expect(formatScanTimestamp(1717000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("dirStatusLine", () => {
  it("shows scan progress when scanning (highest priority)", () => {
    expect(
      dirStatusLine({
        scanning: { processed: 1234, total: 4560 },
        isOnline: false,
        count: 10,
        lastScannedAt: 1717000000,
      }),
    ).toBe("スキャン中 1,234 / 4,560");
  });

  it("shows offline when not scanning and offline", () => {
    expect(
      dirStatusLine({ isOnline: false, count: 10, lastScannedAt: 1717000000 }),
    ).toBe("オフライン");
  });

  it("shows 未スキャン when online but never scanned", () => {
    expect(
      dirStatusLine({ isOnline: true, count: undefined, lastScannedAt: null }),
    ).toBe("未スキャン");
  });

  it("shows count and last scanned when online and scanned", () => {
    const line = dirStatusLine({ isOnline: true, count: 1234, lastScannedAt: 1717000000 });
    expect(line).toMatch(/^1,234枚 · 最終 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("treats missing count as 0 when online and scanned", () => {
    const line = dirStatusLine({ isOnline: true, count: undefined, lastScannedAt: 1717000000 });
    expect(line.startsWith("0枚 · 最終 ")).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/util/dirStatus.test.ts`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: dirStatus.ts を実装**

`src/util/dirStatus.ts`:

```ts
/** 件数を「1,234枚」のように整形する。 */
export function formatCount(n: number): string {
  return `${n.toLocaleString()}枚`;
}

/** Unix 秒を「YYYY-MM-DD HH:MM」（ローカルタイム）に整形する。 */
export function formatScanTimestamp(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface DirStatusInput {
  /** スキャン中の進捗。スキャン中でなければ省略。 */
  scanning?: { processed: number; total: number };
  isOnline: boolean;
  /** ディレクトリの実件数（未ロードなら undefined）。 */
  count: number | undefined;
  /** 最終スキャン時刻（Unix秒）。未スキャンなら null。 */
  lastScannedAt: number | null;
}

/**
 * ディレクトリ行の2行目テキストを決める。優先順位:
 * スキャン中 > オフライン > 未スキャン > 件数+最終スキャン日時。
 */
export function dirStatusLine(s: DirStatusInput): string {
  if (s.scanning) {
    return `スキャン中 ${s.scanning.processed.toLocaleString()} / ${s.scanning.total.toLocaleString()}`;
  }
  if (!s.isOnline) return "オフライン";
  if (s.lastScannedAt == null) return "未スキャン";
  return `${formatCount(s.count ?? 0)} · 最終 ${formatScanTimestamp(s.lastScannedAt)}`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/util/dirStatus.test.ts`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add src/util/dirStatus.ts src/util/dirStatus.test.ts
git commit -m "feat(ui): add pure dirStatusLine formatter for 2-line directory rows"
```

---

## Task 9: DirectoryPanel の2行レイアウトと目玉トグル

**Files:**
- Modify: `src/components/DirectoryPanel.tsx`
- Modify: `src/App.css`

**Model:** 標準モデル（コンポーネント統合）。

> 注: このコードベースにコンポーネントの描画テスト基盤（React Testing Library）は無く、既存コンポーネントもユニットテストを持たない。検証は型チェック + ビルド + 手動確認で行う。ロジックは Task 8 の純粋関数に切り出し済み。

- [ ] **Step 1: DirectoryPanel に目玉アイコンと2行レイアウトを実装**

`src/components/DirectoryPanel.tsx` を以下の方針で変更する。

(a) インポートに `useState` と `dirStatusLine` を追加し、ストアの `setDirectoryVisible` を取得する:

```tsx
import { useEffect, useState } from "react";
```
```tsx
  const setImageCount = useLibraryStore((s) => s.setImageCount);
  const setDirectoryVisible = useLibraryStore((s) => s.setDirectoryVisible);
  const runQuery = useQueryStore((s) => s.runQuery);
```
ファイル先頭の他の import 群の近くに:
```tsx
import { dirStatusLine } from "../util/dirStatus";
```

(b) コンポーネント関数の外（`SORT_LABELS` のような位置、`export function DirectoryPanel` の前）に目玉SVGを定義:

```tsx
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
```

(c) 可視トグルのハンドラを、`handleScanAll` の後に追加:

```tsx
  const handleToggleVisible = async (id: number, current: boolean) => {
    try {
      await setDirectoryVisible(id, !current);
      void runQuery();
    } catch (e) {
      console.error("表示切り替えに失敗しました:", e);
    }
  };
```

(d) `directories.map` の `<li>` 全体を2行レイアウトに置き換える:

```tsx
        {directories.map((d) => {
          const prog = scanning[d.id];
          const status = dirStatusLine({
            scanning: prog ? { processed: prog.processed, total: prog.total } : undefined,
            isOnline: d.is_online,
            count: imageCounts[d.id],
            lastScannedAt: d.last_scanned_at,
          });
          return (
            <li key={d.id} className={`directory-item${d.visible ? "" : " hidden-dir"}`}>
              <button
                className="eye-btn"
                onClick={() => handleToggleVisible(d.id, d.visible)}
                aria-pressed={d.visible}
                aria-label={d.visible ? "表示中（クリックで非表示にする）" : "非表示中（クリックで表示する）"}
                title={d.visible ? "表示中（クリックで非表示にする）" : "非表示中（クリックで表示する）"}
              >
                {d.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <div className="dir-main">
                <div className="dir-row1">
                  <span className="dir-label" title={d.path}>
                    {d.label}
                  </span>
                  <button className="scan-btn" aria-label="スキャン" onClick={() => handleScan(d.id)}>
                    ⟳
                  </button>
                  <button className="remove-btn" aria-label="削除" onClick={() => handleRemove(d.id)}>
                    ×
                  </button>
                </div>
                <div className="dir-row2">{status}</div>
              </div>
            </li>
          );
        })}
```

> 注: 旧来の `offline-badge` / `image-count` / `scan-progress` の `<span>` は削除する（状態は2行目の `status` に集約）。`handleRemove` は Task 10 で確認ダイアログ化するため、このタスクでは既存のままにしておく。

- [ ] **Step 2: App.css にディレクトリ行2行化のスタイルを追加/変更**

`src/App.css` の `.directory-item` を以下に変更し、続く `.dir-label` の後に新規ルールを追加する:

```css
.directory-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.directory-item.hidden-dir {
  opacity: 0.5;
}

.eye-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: #555;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.dir-main {
  flex: 1;
  min-width: 0;
}

.dir-row1 {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dir-row2 {
  font-size: 11px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

（既存の `.dir-label` ルールはそのまま。`.offline-badge` ルールは未使用になるが残置可。）

- [ ] **Step 3: 型チェックとビルドを確認**

Run: `npx tsc -p tsconfig.json` then `npm run build`
Expected: エラーなし、ビルド成功。

- [ ] **Step 4: コミット**

```bash
git add src/components/DirectoryPanel.tsx src/App.css
git commit -m "feat(ui): 2-line directory rows with eye visibility toggle"
```

---

## Task 10: 確認ダイアログ（ConfirmDialog）コンポーネント

**Files:**
- Create: `src/components/ConfirmDialog.tsx`
- Modify: `src/App.css`

**Model:** 標準モデル（コンポーネント）。

- [ ] **Step 1: ConfirmDialog を実装**

`src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from "react";

interface Props {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 実行中はボタンを無効化する（二度押し防止）。 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 再利用可能な確認モーダル。破壊的操作向けに:
 * - 初期フォーカスはキャンセル
 * - Esc でキャンセル（Enter による即実行はしない）
 * - 確認ボタンは危険色（danger-btn）
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "キャンセル",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3>{title}</h3>
        <div className="confirm-body">{body}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className="danger-btn" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App.css に危険色ボタン等のスタイルを追加**

`src/App.css` の末尾に追加:

```css
.confirm-dialog .confirm-body {
  margin: 8px 0 4px;
  line-height: 1.6;
}

.confirm-dialog .confirm-body code {
  background: #eee;
  padding: 1px 4px;
  border-radius: 3px;
}

.danger-btn {
  background: #c0392b;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
}

.danger-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 3: 型チェックとビルドを確認**

Run: `npx tsc -p tsconfig.json` then `npm run build`
Expected: エラーなし、ビルド成功。

- [ ] **Step 4: コミット**

```bash
git add src/components/ConfirmDialog.tsx src/App.css
git commit -m "feat(ui): add reusable ConfirmDialog component"
```

---

## Task 11: 削除確認ダイアログを DirectoryPanel に組み込む

**Files:**
- Modify: `src/components/DirectoryPanel.tsx`

**Model:** 標準モデル（統合）。

- [ ] **Step 1: ConfirmDialog をインポートし、削除フローを確認ダイアログ経由に変更**

`src/components/DirectoryPanel.tsx` を変更する。

(a) インポートに追加:
```tsx
import { ConfirmDialog } from "./ConfirmDialog";
import type { Directory } from "../types";
```

(b) コンポーネント内の state を追加（`const [/* 既存 */]` 群の近く。既存に `useState` の import は Task 9 で追加済み）:
```tsx
  const [pendingDelete, setPendingDelete] = useState<Directory | null>(null);
  const [deleting, setDeleting] = useState(false);
```

(c) 既存の `handleRemove` を、即削除ではなく確認ダイアログを開く形に置き換える:
```tsx
  const handleRemove = (d: Directory) => {
    setPendingDelete(d);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeDirectory(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      console.error("ディレクトリの削除に失敗しました:", e);
    } finally {
      setDeleting(false);
    }
  };
```

(d) 削除ボタンの `onClick` を、id ではなくディレクトリオブジェクトを渡す形に変更:
```tsx
                  <button className="remove-btn" aria-label="削除" onClick={() => handleRemove(d)}>
                    ×
                  </button>
```

(e) `</aside>` の直前（`</ul>` の後）に確認ダイアログを描画:
```tsx
      </ul>
      {pendingDelete && (
        <ConfirmDialog
          title="ディレクトリを削除しますか?"
          confirmLabel="削除する"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          body={
            <>
              <p>
                <code>{pendingDelete.label}</code>（{pendingDelete.path}）をライブラリから削除します。
              </p>
              <p>
                このディレクトリの画像メタデータ・サムネイルがデータベースから削除されます。
                <strong>ディスク上の元画像ファイルは削除されません。</strong>
              </p>
            </>
          }
        />
      )}
    </aside>
```

- [ ] **Step 2: 型チェックとビルドを確認**

Run: `npx tsc -p tsconfig.json` then `npm run build`
Expected: エラーなし、ビルド成功。

- [ ] **Step 3: コミット**

```bash
git add src/components/DirectoryPanel.tsx
git commit -m "feat(ui): confirm before deleting a directory"
```

---

## Task 12: 全体検証

**Files:** なし（検証のみ）

**Model:** 標準モデル。

- [ ] **Step 1: フロント全テスト**

Run: `npm test`
Expected: 全テスト PASS（既存 + `dirStatus` 追加分）。

- [ ] **Step 2: Rust 全テスト**

Run: `cargo test -p gen-img-manager`（`src-tauri/` で実行）
Expected: 全テスト PASS。

- [ ] **Step 3: 型チェック + 本番ビルド**

Run: `npx tsc -p tsconfig.json` then `npm run build`
Expected: エラーなし、ビルド成功。

- [ ] **Step 4: 手動確認チェックリスト（開発ビルドで）**

- 大量画像ディレクトリのスキャンが体感速くなり、`X/Y` 進捗が（粗くbut）単調増加で更新される
- 再スキャンで未変更ファイルが即スキップされる（追加0・スキップN）
- 目玉アイコンをクリックすると行が淡色化し、一覧と件数からそのディレクトリが除外/復帰する（即反映）
- ディレクトリ行が2行表示になり、2行目に「件数+最終日時 / オフライン / スキャン中 X/Y / 未スキャン」が状況に応じて出る
- 削除「×」で確認ダイアログが出る。Esc / キャンセル / 背景クリックで閉じ、削除されない。「削除する」で実際に削除される

---

## Self-Review（計画作成者によるスペック突き合わせ）

**スペック網羅:**
1. メタ並列化（NAS想定） → Task 5・6・7（rayon ワーカープール、事前ロード、逐次DB書き込み、進捗間引き、scan_concurrency 設定）✅
2. ディレクトリごとの目玉トグル（永続化） → Task 1〜4（v4 列・モデル・クエリ除外・コマンド/API/ストア）+ Task 9（UI）✅
3. 2行表示（2行目に offline/処理状況を小さく） → Task 8（純粋整形）+ Task 9（レイアウト/CSS）✅
4. 削除確認ダイアログ → Task 10（ConfirmDialog）+ Task 11（組み込み）✅

**型整合:** `Directory.visible`（Rust/TS）、`set_directory_visible`/`setDirectoryVisible`、`list_meta_in_directory` の戻り値タプル、`scan_directory(.., concurrency, on_progress: Fn+Sync)`、`dirStatusLine` の入力キー（`scanning`/`isOnline`/`count`/`lastScannedAt`）— タスク間で一致を確認済み。

**プレースホルダ:** なし（各ステップに実コードを記載）。
