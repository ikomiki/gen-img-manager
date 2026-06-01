# 計画1：基盤 + DB + ディレクトリ管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri v2 + React の雛形を立ち上げ、SQLite（rusqlite bundled, FTS5有効）にマイグレーションで `directories` テーブルを作り、記憶対象ディレクトリを追加/一覧/削除できる3ペイン骨格アプリを完成させる。

**Architecture:** 重い処理はRustバックエンドに集約。DBは `Mutex<Connection>` をTauri管理状態として保持し、`db` モジュールの関数は `&Connection` を受け取って単体テスト可能にする。フロントはZustandストア経由で `invoke` コマンドを呼ぶ。

**Tech Stack:** Tauri v2 / Rust / rusqlite(bundled) / React + TypeScript + Vite / Zustand / Vitest / tauri-plugin-dialog

---

## 前提（実行前に確認）

- Rustツールチェーン（`rustc --version` が通る）、Node.js 18+（`node -v`）、Xcode Command Line Tools（`xcode-select -p`）がインストール済みであること。rusqlite の `bundled` 機能はCコンパイラを使う。
- 作業ディレクトリ: `/Users/ikomiki/workspace/gen-img-manager`（既に `git init` 済み、`docs/` と `.gitignore` がある）。

## ファイル構成（このプランで作成/変更）

```
gen-img-manager/
  package.json                        # scaffold生成・依存追加
  vite.config.ts                      # vitest設定を追記
  src/
    types.ts                          # 作成: Directory 型
    api/directories.ts                # 作成: invokeラッパ
    store/useLibraryStore.ts          # 作成: Zustandストア
    store/useLibraryStore.test.ts     # 作成: ストアのテスト
    components/DirectoryPanel.tsx      # 作成: 左ペイン
    components/FilterBar.tsx           # 作成: 上部プレースホルダ
    components/ImageGridPanel.tsx      # 作成: 右ペインプレースホルダ
    App.tsx                           # 変更: 3ペインレイアウト
    App.css                           # 変更: グリッドレイアウト
  src-tauri/
    Cargo.toml                        # 変更: rusqlite等の依存追加
    src/lib.rs                        # 変更: DB初期化・コマンド登録
    src/main.rs                       # 変更: lib::run() 呼出（scaffold既定のまま）
    src/models.rs                     # 作成: Directory 構造体
    src/db/mod.rs                     # 作成: 接続・open
    src/db/migrations.rs              # 作成: マイグレーション実行
    src/db/directories.rs             # 作成: directories CRUD
    src/commands/mod.rs               # 作成
    src/commands/directories.rs       # 作成: Tauriコマンド
```

---

## Task 1: Tauri v2 + React-TS プロジェクトの雛形作成

**Files:**
- Create: プロジェクト雛形一式（`package.json`, `vite.config.ts`, `index.html`, `src/*`, `src-tauri/*`）

- [ ] **Step 1: 一時ディレクトリに雛形を生成**

Run:
```bash
mkdir -p /tmp/gim-scaffold
cd /tmp/gim-scaffold
npm create tauri-app@latest gen-img-manager -- --template react-ts --manager npm --identifier com.technonet.genimgmanager --yes
```
Expected: `/tmp/gim-scaffold/gen-img-manager/` に Tauri v2 + React-TS の雛形が生成される。

- [ ] **Step 2: 雛形をリポジトリへ取り込む（.git と .gitignore は保持）**

Run:
```bash
rsync -a --exclude='.git' --exclude='.gitignore' /tmp/gim-scaffold/gen-img-manager/ /Users/ikomiki/workspace/gen-img-manager/
rm -rf /tmp/gim-scaffold
```
Expected: リポジトリ直下に `package.json`, `src/`, `src-tauri/` が出現。既存の `.gitignore`/`docs/` は維持。

- [ ] **Step 3: 生成された lib クレート名を確認**

Run: `grep -n 'name' /Users/ikomiki/workspace/gen-img-manager/src-tauri/Cargo.toml`
Expected: `[lib] name = "gen_img_manager_lib"` を確認（異なる場合は以降の `gen_img_manager_lib` を実際の名前に読み替える）。`src-tauri/src/main.rs` が `gen_img_manager_lib::run()` を呼ぶことも確認。

- [ ] **Step 4: 依存をインストールしてビルドが通ることを確認**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager
npm install
npm run tauri build -- --no-bundle
```
Expected: フロントのビルドとRustのコンパイルが成功（初回はRust依存のダウンロードで数分かかる）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 + React-TS project"
```

---

## Task 2: Rust依存追加と DB接続・マイグレーション実行（TDD）

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/migrations.rs`
- Test: `src-tauri/src/db/migrations.rs`（同ファイル内 `#[cfg(test)]`）

- [ ] **Step 1: Cargo.toml に rusqlite を追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追記（既存の `tauri`/`serde`/`serde_json` はそのまま）:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```
（`cargo` がバージョン非互換を訴える場合は、`cargo add rusqlite --features bundled` で解決可能なバージョンに合わせる。）

- [ ] **Step 2: マイグレーション実行関数と失敗するテストを書く**

`src-tauri/src/db/migrations.rs` を作成:
```rust
use rusqlite::Connection;

/// 配列の index+1 がスキーマバージョン。追記のみ・並び替え禁止。
const MIGRATIONS: &[&str] = &[
    // v1: directories
    "CREATE TABLE directories (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        is_online INTEGER NOT NULL DEFAULT 1,
        last_scanned_at INTEGER,
        recursive INTEGER NOT NULL DEFAULT 1
    );",
];

/// 未適用のマイグレーションを順に適用し PRAGMA user_version を更新する。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            conn.execute_batch(&format!(
                "BEGIN; {sql} PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_directories_table_and_sets_version() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();

        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='directories'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn run_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
    }
}
```

- [ ] **Step 3: db モジュールと接続関数を作る**

`src-tauri/src/db/mod.rs` を作成:
```rust
pub mod directories;
pub mod migrations;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// Tauri管理状態として保持するDBハンドル。
pub struct Db(pub Mutex<Connection>);

/// DBを開き、PRAGMAを設定し、マイグレーションを適用する。
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::run(&conn)?;
    Ok(conn)
}
```
（`directories` モジュールは Task 3 で作成する。先に `pub mod directories;` を書くとコンパイルが通らないため、このStepでは `pub mod directories;` 行を一旦コメントアウトしておき、Task 3 Step 1 で有効化する。）

- [ ] **Step 4: lib.rs に db モジュールを宣言**

`src-tauri/src/lib.rs` の先頭付近（既存の `run` 関数の上）に追記:
```rust
mod db;
mod models;
```
（`models` は Task 3 で作成。まだ存在しないため、このStepでは `mod models;` をコメントアウトし Task 3 で有効化する。）

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test migrations`
Expected: `creates_directories_table_and_sets_version` と `run_is_idempotent` が PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db src-tauri/src/lib.rs
git commit -m "feat(db): add sqlite connection and migration runner with directories table"
```

---

## Task 3: Directory モデルと directories CRUD（TDD）

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/db/directories.rs`
- Test: `src-tauri/src/db/directories.rs`（同ファイル内 `#[cfg(test)]`）

- [ ] **Step 1: モジュール宣言を有効化**

`src-tauri/src/lib.rs` の `mod models;` のコメントを外す。
`src-tauri/src/db/mod.rs` の `pub mod directories;` のコメントを外す。

- [ ] **Step 2: Directory モデルを作成**

`src-tauri/src/models.rs` を作成:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Directory {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub is_online: bool,
    pub last_scanned_at: Option<i64>,
    pub recursive: bool,
}
```

- [ ] **Step 3: CRUD関数と失敗するテストを書く**

`src-tauri/src/db/directories.rs` を作成:
```rust
use crate::models::Directory;
use rusqlite::{params, Connection};

pub fn add(conn: &Connection, path: &str, label: &str, recursive: bool) -> rusqlite::Result<Directory> {
    conn.execute(
        "INSERT INTO directories (path, label, is_online, last_scanned_at, recursive)
         VALUES (?1, ?2, 1, NULL, ?3)",
        params![path, label, recursive as i64],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Directory> {
    conn.query_row(
        "SELECT id, path, label, is_online, last_scanned_at, recursive
         FROM directories WHERE id = ?1",
        params![id],
        row_to_dir,
    )
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Directory>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, label, is_online, last_scanned_at, recursive
         FROM directories ORDER BY label COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_dir)?;
    rows.collect()
}

pub fn remove(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM directories WHERE id = ?1", params![id])?;
    Ok(())
}

fn row_to_dir(r: &rusqlite::Row) -> rusqlite::Result<Directory> {
    Ok(Directory {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        is_online: r.get::<_, i64>(3)? != 0,
        last_scanned_at: r.get(4)?,
        recursive: r.get::<_, i64>(5)? != 0,
    })
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
    fn add_then_list_returns_one() {
        let c = conn();
        let d = add(&c, "/Volumes/NAS/sd", "sd", true).unwrap();
        assert_eq!(d.path, "/Volumes/NAS/sd");
        assert_eq!(d.label, "sd");
        assert!(d.is_online);
        assert!(d.recursive);

        let all = list(&c).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, d.id);
    }

    #[test]
    fn remove_deletes_row() {
        let c = conn();
        let d = add(&c, "/a", "a", false).unwrap();
        remove(&c, d.id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_path_is_error() {
        let c = conn();
        add(&c, "/a", "a", true).unwrap();
        assert!(add(&c, "/a", "a", true).is_err());
    }
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test directories`
Expected: `add_then_list_returns_one` / `remove_deletes_row` / `duplicate_path_is_error` が PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/db/directories.rs src-tauri/src/db/mod.rs src-tauri/src/lib.rs
git commit -m "feat(db): add Directory model and directories CRUD"
```

---

## Task 4: Tauriコマンドと状態登録

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/directories.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`（dialogプラグイン）

- [ ] **Step 1: dialogプラグインを追加**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager
npx tauri add dialog
```
Expected: `src-tauri/Cargo.toml` に `tauri-plugin-dialog` が追加され、`package.json` に `@tauri-apps/plugin-dialog` が追加され、`src-tauri/capabilities/default.json` に dialog 権限が付与される。

- [ ] **Step 2: コマンドを作成**

`src-tauri/src/commands/mod.rs` を作成:
```rust
pub mod directories;
```

`src-tauri/src/commands/directories.rs` を作成:
```rust
use crate::db::Db;
use crate::models::Directory;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn add_directory(db: State<Db>, path: String, recursive: bool) -> Result<Directory, String> {
    let label = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.clone());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::add(&conn, &path, &label, recursive).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_directories(db: State<Db>) -> Result<Vec<Directory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_directory(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::directories::remove(&conn, id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: lib.rs でDB初期化・コマンド登録**

`src-tauri/src/lib.rs` を編集。冒頭のモジュール宣言に `mod commands;` を追加し、`run` 関数を次の形にする（既存の `tauri_plugin_dialog::init()` 行は Step 1 で追加済みのものを活かす）:
```rust
mod commands;
mod db;
mod models;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("library.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::directories::add_directory,
            commands::directories::list_directories,
            commands::directories::remove_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: コンパイル確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build`
Expected: エラーなくビルド成功。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities src-tauri/src/commands src-tauri/src/lib.rs package.json package-lock.json
git commit -m "feat(commands): add directory add/list/remove tauri commands and db state"
```

---

## Task 5: フロント型・APIラッパ・Zustandストア（TDD）

**Files:**
- Create: `src/types.ts`
- Create: `src/api/directories.ts`
- Create: `src/store/useLibraryStore.ts`
- Test: `src/store/useLibraryStore.test.ts`
- Modify: `vite.config.ts`, `package.json`

- [ ] **Step 1: テスト依存とZustandを追加**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager
npm install zustand
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Vitest設定とテストスクリプトを追加**

`vite.config.ts` の先頭に追記し、`defineConfig` に `test` を加える:
```ts
/// <reference types="vitest" />
```
`defineConfig({ ... })` のオブジェクト内に追加:
```ts
  test: {
    environment: "jsdom",
    globals: true,
  },
```
`package.json` の `"scripts"` に追記:
```json
    "test": "vitest run"
```

- [ ] **Step 3: 型とAPIラッパを作成**

`src/types.ts`:
```ts
export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
}
```

`src/api/directories.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { Directory } from "../types";

export const listDirectories = () => invoke<Directory[]>("list_directories");

export const addDirectory = (path: string, recursive: boolean) =>
  invoke<Directory>("add_directory", { path, recursive });

export const removeDirectory = (id: number) =>
  invoke<void>("remove_directory", { id });
```

- [ ] **Step 4: 失敗するストアテストを書く**

`src/store/useLibraryStore.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLibraryStore } from "./useLibraryStore";
import * as api from "../api/directories";

vi.mock("../api/directories");

const dir = (id: number, label: string): import("../types").Directory => ({
  id, path: `/p/${label}`, label, is_online: true, last_scanned_at: null, recursive: true,
});

beforeEach(() => {
  useLibraryStore.setState({ directories: [] });
  vi.resetAllMocks();
});

describe("useLibraryStore", () => {
  it("loadDirectories populates state", async () => {
    vi.mocked(api.listDirectories).mockResolvedValue([dir(1, "a")]);
    await useLibraryStore.getState().loadDirectories();
    expect(useLibraryStore.getState().directories).toHaveLength(1);
  });

  it("addDirectory appends the returned directory", async () => {
    vi.mocked(api.addDirectory).mockResolvedValue(dir(2, "b"));
    await useLibraryStore.getState().addDirectory("/p/b", true);
    expect(useLibraryStore.getState().directories[0].id).toBe(2);
  });

  it("removeDirectory drops by id", async () => {
    useLibraryStore.setState({ directories: [dir(1, "a")] });
    vi.mocked(api.removeDirectory).mockResolvedValue(undefined as unknown as void);
    await useLibraryStore.getState().removeDirectory(1);
    expect(useLibraryStore.getState().directories).toHaveLength(0);
  });
});
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test`
Expected: FAIL（`useLibraryStore` が未定義のためインポートエラー）。

- [ ] **Step 6: ストアを実装**

`src/store/useLibraryStore.ts`:
```ts
import { create } from "zustand";
import type { Directory } from "../types";
import * as api from "../api/directories";

interface LibraryState {
  directories: Directory[];
  loadDirectories: () => Promise<void>;
  addDirectory: (path: string, recursive: boolean) => Promise<void>;
  removeDirectory: (id: number) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  directories: [],
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
}));
```

- [ ] **Step 7: テストが通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test`
Expected: 3件すべて PASS。

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/api/directories.ts src/store package.json package-lock.json vite.config.ts
git commit -m "feat(frontend): add directory types, api wrappers, and zustand store with tests"
```

---

## Task 6: 3ペインレイアウトと DirectoryPanel

**Files:**
- Create: `src/components/DirectoryPanel.tsx`
- Create: `src/components/FilterBar.tsx`
- Create: `src/components/ImageGridPanel.tsx`
- Modify: `src/App.tsx`, `src/App.css`

- [ ] **Step 1: プレースホルダ2つを作成**

`src/components/FilterBar.tsx`:
```tsx
export function FilterBar() {
  return (
    <div className="filter-bar">
      <input className="filter-input" placeholder="フィルタ（計画3で実装）" disabled />
    </div>
  );
}
```

`src/components/ImageGridPanel.tsx`:
```tsx
export function ImageGridPanel() {
  return (
    <div className="image-grid">
      <p className="placeholder-note">画像一覧はここに表示されます（計画3で実装）</p>
    </div>
  );
}
```

- [ ] **Step 2: DirectoryPanel を作成**

`src/components/DirectoryPanel.tsx`:
```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../store/useLibraryStore";

export function DirectoryPanel() {
  const directories = useLibraryStore((s) => s.directories);
  const addDirectory = useLibraryStore((s) => s.addDirectory);
  const removeDirectory = useLibraryStore((s) => s.removeDirectory);

  const handleAdd = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await addDirectory(selected, true);
    }
  };

  return (
    <aside className="directory-panel">
      <div className="panel-header">
        <h2>ディレクトリ</h2>
        <button onClick={handleAdd}>＋ 追加</button>
      </div>
      <ul className="directory-list">
        {directories.map((d) => (
          <li key={d.id} className="directory-item">
            <span className="dir-label" title={d.path}>
              {d.label}
            </span>
            {!d.is_online && <span className="offline-badge">⦿offline</span>}
            <button className="remove-btn" onClick={() => removeDirectory(d.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 3: App.tsx を3ペインに置き換え**

`src/App.tsx` の中身を全置換:
```tsx
import { useEffect } from "react";
import { useLibraryStore } from "./store/useLibraryStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);

  useEffect(() => {
    loadDirectories();
  }, [loadDirectories]);

  return (
    <div className="app-shell">
      <header className="filter-bar-slot">
        <FilterBar />
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

- [ ] **Step 4: App.css をレイアウトに置き換え**

`src/App.css` の中身を全置換:
```css
:root {
  font-family: system-ui, sans-serif;
}

.app-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "filter filter"
    "dirs   grid";
  height: 100vh;
  margin: 0;
}

.filter-bar-slot {
  grid-area: filter;
  border-bottom: 1px solid #ddd;
  padding: 8px;
}

.filter-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
}

.directory-panel {
  grid-area: dirs;
  overflow-y: auto;
  border-right: 1px solid #ddd;
  padding: 8px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.directory-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.directory-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.dir-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-badge {
  color: #e0457b;
  font-size: 11px;
}

.image-grid-slot {
  grid-area: grid;
  overflow-y: auto;
}

.placeholder-note {
  padding: 16px;
  color: #888;
}
```
（scaffold既定の `src/App.css` に他のスタイルがあっても、上記で全置換してよい。`src/main.tsx` が `App.css` ではなく独自CSSを読む場合は不要なものを削除。）

- [ ] **Step 5: ビルド（型チェック）が通ることを確認**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build`
Expected: TypeScriptのビルドが成功。

- [ ] **Step 6: Commit**

```bash
git add src/components src/App.tsx src/App.css
git commit -m "feat(frontend): 3-pane shell with directory panel (add/remove)"
```

---

## Task 7: 結合・手動スモークテスト・永続化確認

**Files:** なし（動作確認のみ）

- [ ] **Step 1: 開発モードで起動**

Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run tauri dev`
Expected: アプリウィンドウが開き、上部にフィルタ欄（無効）、左にディレクトリ一覧（空）、右にプレースホルダが表示される。

- [ ] **Step 2: ディレクトリ追加の確認**

操作: 左ペインの「＋ 追加」をクリック → フォルダ選択ダイアログで任意のフォルダ（例: `~/Pictures`）を選ぶ。
Expected: 選んだフォルダのベース名が左ペインに追加表示される。

- [ ] **Step 3: 削除の確認**

操作: 追加した項目の「×」をクリック。
Expected: 一覧から消える。

- [ ] **Step 4: 永続化の確認**

操作: 1つ追加した状態でアプリを終了し、再度 `npm run tauri dev` で起動。
Expected: 追加したディレクトリが一覧に復元される（SQLiteに保存されている）。確認後、DBの場所は macOS で `~/Library/Application Support/com.technonet.genimgmanager/library.db`。

- [ ] **Step 5: 全テストの最終確認**

Run:
```bash
cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test
cd /Users/ikomiki/workspace/gen-img-manager && npm test
```
Expected: Rust 5テスト・フロント3テストすべて PASS。

- [ ] **Step 6: マイルストーン完了コミット**

```bash
git add -A
git commit -m "chore: milestone 1 complete - foundation, db, directory management"
```

---

## このプランで満たす設計書の項目（自己レビュー）

- §2 アーキテクチャ: Tauri+React雛形、Rustバックエンド構成、`Mutex<Connection>` 管理状態、Zustand ✔（Task 1,4,5）
- §3 データモデル: `directories` テーブル・マイグレーション基盤（`PRAGMA user_version`）✔（Task 2,3）。`images`/FTS/その他テーブルは計画2以降。
- §6 UI: 左=ディレクトリ／右=一覧プレースホルダ／上=フィルタ欄プレースホルダの3ペイン骨格、オフライン印表示 ✔（Task 6）
- §8 クロスプラットフォーム: パス文字列をそのまま保存（`/Volumes`・UNC対応の素地）、識別子設定 ✔（Task 1,4）
- §10 エラー処理: コマンドは `Result<_, String>` で失敗を握る ✔（Task 4）

**計画2以降に持ち越す項目（このプランの範囲外）:** images/FTS5テーブル、scanner/parser/thumbnailer、fs-guardの到達性チェック（`is_online` の実更新は計画2）、クエリ構文、サムネグリッド、ビューア、スライドショー。
