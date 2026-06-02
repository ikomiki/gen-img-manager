# 計画4：画像ビューア Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧のサムネをダブルクリック/Enterするとメインウィンドウ内オーバーレイで原画像を一枚絵表示し、←/→/Space/Esc で操作、ズーム4モード（全体フィット/等倍/Fill/任意倍率）、メタデータ（プロンプト等）パネル、ネイティブ「表示」メニュー連携を提供する。

**Architecture:** ビューアはメインウィンドウ内のReactオーバーレイ（C案ハイブリッド）。ナビゲーションは `useQueryStore.results` ＋ `useViewerStore` のインデックスで行う。原画像は Tauri asset protocol＋`convertFileSrc` で表示するため、画像ディレクトリをasset scopeに許可する。全メタデータは `get_image_detail` コマンドで取得。ズームはビューア内のキーボード/ボタンで完結し、ネイティブ「表示」メニューは同じアクションをイベントで発火＋チェック状態を同期する。

**Tech Stack:** Rust / rusqlite / Tauri v2 (asset protocol, menu, events) / React + TypeScript / Zustand

---

## 前提（実行前に確認）

- 計画1〜3完了済み（`main` にマージ）。既存:
  - DB: `images`（列: id, directory_id, path, filename, size, mtime, created_at, modified_at, width, height, pixels, rating, format, thumb_path, raw_parameters, positive, negative, model, sampler, steps, seed, cfg, source_tool, comfy_workflow, missing）、`db::image_query`（`ImageRow`/`query_images`/`count_query`/`SELECT_COLS`/`row_to_image`）、`db::Db(Arc<Mutex<Connection>>)`、`db::directories::list`。
  - コマンド: `src-tauri/src/commands/query.rs`（query_images/count_query）、`commands/prefs.rs`、`commands/directories.rs`（`add_directory(db,path,recursive)`）、`commands/scan.rs`。登録は `src-tauri/src/lib.rs` の `invoke_handler!`。
  - `lib.rs` の `setup`: app_data_dir取得→create_dir_all→`db::open`→`app.manage(Db)`→thumbnailsディレクトリ作成＋`app.asset_protocol_scope().allow_directory(&thumb_dir, true)`。`tauri` features に `protocol-asset` 済み。`use tauri::Manager;`。`tauri_plugin_dialog`。
  - フロント: `src/types.ts`（Directory/ScanProgress/ScanDone/ImageRow/SortKey/SortDir）、`src/store/useQueryStore.ts`（results 等）、`src/store/useLibraryStore.ts`、`src/components/{ImageGridPanel,FilterBar,FilterDialog,DirectoryPanel}.tsx`、`src/App.tsx`、`src/App.css`、Vitest設定。`convertFileSrc` を thumbnails 表示で使用中。`@tauri-apps/api/event` の `listen` 使用実績あり（DirectoryPanel）。
- 作業ディレクトリ: `/Users/ikomiki/workspace/gen-img-manager`。新ブランチ（例 `feature/plan4-viewer`）で実装（main直接実装禁止）。

## ファイル構成（このプランで作成/変更）

```
src-tauri/src/
  db/image_query.rs    # 変更: ImageDetail と get_detail を追加
  commands/query.rs    # 変更: get_image_detail コマンド
  commands/directories.rs # 変更: add_directory に AppHandle を足し asset scope 許可
  menu.rs              # 作成: ネイティブ「表示」メニュー構築＋ハンドル保持＋同期
  lib.rs               # 変更: setup で画像ディレクトリを asset scope 許可、メニュー設定、on_menu_event、コマンド登録
src/
  types.ts             # 変更: ImageDetail / ZoomMode 型
  api/images.ts        # 変更: getImageDetail ラッパ
  store/useViewerStore.ts      # 作成: ビューア状態（open/close/next/prev/zoom/selection）
  store/useViewerStore.test.ts # 作成: テスト
  components/ImageViewer.tsx    # 作成: オーバーレイ・ズーム・キーボード操作
  components/MetadataPanel.tsx  # 作成: メタデータ表示＋コピー
  components/ImageGridPanel.tsx # 変更: 選択＋ダブルクリック/Enterでビューア起動、<ImageViewer/> 描画
  App.tsx              # 変更: メニューイベント購読、ズーム/ファイル名のメニュー同期
  App.css              # 変更: ビューア/メタパネル/選択ハイライトのスタイル
```

---

## Task 1: ImageDetail と get_detail（DB層）

**Files:**
- Modify: `src-tauri/src/db/image_query.rs`

- [ ] **Step 1: ImageDetail と get_detail を追加（テスト付き）**

`src-tauri/src/db/image_query.rs` の末尾（`#[cfg(test)]` の前）に追加:
```rust
/// ビューアのメタデータパネル用の全フィールド。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageDetail {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub width: i64,
    pub height: i64,
    pub pixels: i64,
    pub size: i64,
    pub rating: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub format: String,
    pub source_tool: String,
    pub raw_parameters: Option<String>,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub model: Option<String>,
    pub sampler: Option<String>,
    pub steps: Option<i64>,
    pub seed: Option<i64>,
    pub cfg: Option<f64>,
    pub comfy_workflow: Option<String>,
}

const DETAIL_COLS: &str = "id, path, filename, width, height, pixels, size, rating, \
    created_at, modified_at, format, source_tool, raw_parameters, positive, negative, \
    model, sampler, steps, seed, cfg, comfy_workflow";

fn row_to_detail(r: &rusqlite::Row) -> rusqlite::Result<ImageDetail> {
    Ok(ImageDetail {
        id: r.get(0)?,
        path: r.get(1)?,
        filename: r.get(2)?,
        width: r.get(3)?,
        height: r.get(4)?,
        pixels: r.get(5)?,
        size: r.get(6)?,
        rating: r.get(7)?,
        created_at: r.get(8)?,
        modified_at: r.get(9)?,
        format: r.get(10)?,
        source_tool: r.get(11)?,
        raw_parameters: r.get(12)?,
        positive: r.get(13)?,
        negative: r.get(14)?,
        model: r.get(15)?,
        sampler: r.get(16)?,
        steps: r.get(17)?,
        seed: r.get(18)?,
        cfg: r.get(19)?,
        comfy_workflow: r.get(20)?,
    })
}

/// 1画像の全メタデータを取得する。無ければ None。
pub fn get_detail(conn: &Connection, id: i64) -> rusqlite::Result<Option<ImageDetail>> {
    let sql = format!("SELECT {DETAIL_COLS} FROM images WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(r) => Ok(Some(row_to_detail(r)?)),
        None => Ok(None),
    }
}
```

`#[cfg(test)] mod tests` 内に追加（既存の `conn()`/`img()`/`seed()` ヘルパを使う）:
```rust
    #[test]
    fn get_detail_returns_full_fields() {
        let c = conn();
        seed(&c);
        let id = crate::db::images::upsert(
            &c,
            &NewImage {
                directory_id: 1,
                path: "/d/full.png".into(),
                filename: "full.png".into(),
                size: 42,
                mtime: 1,
                width: 640,
                height: 480,
                rating: Some(4),
                format: "png".into(),
                positive: Some("a fox".into()),
                negative: Some("blurry".into()),
                model: Some("sdxl".into()),
                sampler: Some("Euler".into()),
                steps: Some(30),
                seed: Some(99),
                cfg: Some(7.0),
                raw_parameters: Some("a fox\nNegative prompt: blurry".into()),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let d = get_detail(&c, id).unwrap().unwrap();
        assert_eq!(d.filename, "full.png");
        assert_eq!(d.width, 640);
        assert_eq!(d.pixels, 640 * 480);
        assert_eq!(d.size, 42);
        assert_eq!(d.rating, Some(4));
        assert_eq!(d.positive.as_deref(), Some("a fox"));
        assert_eq!(d.negative.as_deref(), Some("blurry"));
        assert_eq!(d.model.as_deref(), Some("sdxl"));
        assert_eq!(d.steps, Some(30));
        assert_eq!(d.cfg, Some(7.0));
    }

    #[test]
    fn get_detail_missing_id_is_none() {
        let c = conn();
        assert_eq!(get_detail(&c, 999).unwrap(), None);
    }
```

- [ ] **Step 2:** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test db::image_query` → 既存7件＋新規2件 PASS。

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/db/image_query.rs
git commit -m "feat(db): add ImageDetail and get_detail for viewer metadata"
```

---

## Task 2: get_image_detail コマンド

**Files:**
- Modify: `src-tauri/src/commands/query.rs`
- Modify: `src-tauri/src/lib.rs`（登録）

- [ ] **Step 1:** `src-tauri/src/commands/query.rs` に追記（既存の use に `ImageDetail` を足す）:
```rust
use crate::db::image_query::{self, ImageDetail, ImageRow};
```
（既存の `use crate::db::image_query::{self, ImageRow};` を上記に置換。）
ファイル末尾に追加:
```rust
/// 1画像の全メタデータを取得する。
#[tauri::command]
pub fn get_image_detail(db: State<Db>, id: i64) -> Result<Option<ImageDetail>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    image_query::get_detail(&conn, id).map_err(|e| e.to_string())
}
```

- [ ] **Step 2:** `src-tauri/src/lib.rs` の `invoke_handler!` に追加（既存は残す）:
```rust
            commands::query::get_image_detail,
```

- [ ] **Step 3:** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build && cargo test` → 成功・全PASS。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/commands/query.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add get_image_detail command"
```

---

## Task 3: 画像ディレクトリの asset scope 許可

**Files:**
- Modify: `src-tauri/src/lib.rs`（setup で全ディレクトリを許可）
- Modify: `src-tauri/src/commands/directories.rs`（add_directory に AppHandle を足し、追加時に許可）

- [ ] **Step 1: add_directory で新規ディレクトリを asset scope に許可**

`src-tauri/src/commands/directories.rs` の `add_directory` を変更（AppHandle 引数を追加し、登録後にスコープ許可）:
```rust
use crate::db::Db;
use crate::models::Directory;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn add_directory(
    app: AppHandle,
    db: State<Db>,
    path: String,
    recursive: bool,
) -> Result<Directory, String> {
    let label = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.clone());
    let dir = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::directories::add(&conn, &path, &label, recursive).map_err(|e| e.to_string())?
    };
    // 追加ディレクトリ配下の原画像を asset protocol で表示できるよう許可する。
    let _ = app.asset_protocol_scope().allow_directory(Path::new(&path), recursive);
    Ok(dir)
}
```
（`list_directories`/`remove_directory` は変更しない。`allow_directory` のエラーは致命的でないため `let _ =` で握る。シグネチャがTauriバージョンで異なる場合は調整。）

- [ ] **Step 2: setup で既存の全ディレクトリを許可**

`src-tauri/src/lib.rs` の `setup` クロージャ内、DB初期化と thumbnails 許可の後に追加:
```rust
            // 既存の記憶対象ディレクトリ配下の原画像も asset protocol で表示できるよう許可する。
            {
                let conn = app.state::<db::Db>();
                let conn = conn.0.lock().unwrap();
                if let Ok(dirs) = db::directories::list(&conn) {
                    for d in dirs {
                        let _ = app
                            .asset_protocol_scope()
                            .allow_directory(std::path::Path::new(&d.path), d.recursive);
                    }
                }
            }
```
（`app.state::<db::Db>()` で managed state を取得。`use tauri::Manager;` は既にある。ロックは短時間で解放。）

- [ ] **Step 3:** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build && cargo test` → 成功・全PASS。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/commands/directories.rs src-tauri/src/lib.rs
git commit -m "feat(assets): allow image directories in asset scope for full-image viewing"
```

---

## Task 4: フロント型と getImageDetail ラッパ

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api/images.ts`

- [ ] **Step 1:** `src/types.ts` に追記:
```ts
export interface ImageDetail {
  id: number;
  path: string;
  filename: string;
  width: number;
  height: number;
  pixels: number;
  size: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  format: string;
  source_tool: string;
  raw_parameters: string | null;
  positive: string | null;
  negative: string | null;
  model: string | null;
  sampler: string | null;
  steps: number | null;
  seed: number | null;
  cfg: number | null;
  comfy_workflow: string | null;
}

export type ZoomMode = "fit" | "actual" | "fill" | "custom";
```

- [ ] **Step 2:** `src/api/images.ts` に追記（既存 import に ImageDetail を足す）:
```ts
import type { ImageRow, ImageDetail, SortKey, SortDir } from "../types";
```
（既存の `import type { ImageRow, SortKey, SortDir } from "../types";` を上記に置換。）
末尾に追加:
```ts
export const getImageDetail = (id: number) =>
  invoke<ImageDetail | null>("get_image_detail", { id });
```

- [ ] **Step 3:** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功。

- [ ] **Step 4: Commit**
```bash
git add src/types.ts src/api/images.ts
git commit -m "feat(frontend): add ImageDetail/ZoomMode types and getImageDetail wrapper"
```

---

## Task 5: useViewerStore（TDD）

**Files:**
- Create: `src/store/useViewerStore.ts`
- Test: `src/store/useViewerStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く** `src/store/useViewerStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useViewerStore } from "./useViewerStore";
import { useQueryStore } from "./useQueryStore";
import type { ImageRow } from "../types";

const row = (id: number): ImageRow => ({
  id, path: `/d/${id}.png`, filename: `${id}.png`, thumb_path: null,
  width: 10, height: 10, pixels: 100, rating: null,
  created_at: null, modified_at: null, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({ results: [row(1), row(2), row(3)] });
  useViewerStore.setState({ isOpen: false, index: 0, selectedIndex: 0, zoomMode: "fit", scale: 1 });
});

describe("useViewerStore", () => {
  it("open sets isOpen and index", () => {
    useViewerStore.getState().open(1);
    expect(useViewerStore.getState().isOpen).toBe(true);
    expect(useViewerStore.getState().index).toBe(1);
  });

  it("next/prev clamp within results bounds", () => {
    useViewerStore.getState().open(0);
    useViewerStore.getState().next();
    expect(useViewerStore.getState().index).toBe(1);
    useViewerStore.getState().prev();
    expect(useViewerStore.getState().index).toBe(0);
    useViewerStore.getState().prev(); // 先頭で止まる
    expect(useViewerStore.getState().index).toBe(0);
  });

  it("next stops at last index", () => {
    useViewerStore.getState().open(2);
    useViewerStore.getState().next();
    expect(useViewerStore.getState().index).toBe(2);
  });

  it("close resets isOpen", () => {
    useViewerStore.getState().open(0);
    useViewerStore.getState().close();
    expect(useViewerStore.getState().isOpen).toBe(false);
  });

  it("setZoomMode changes mode and resets scale", () => {
    useViewerStore.getState().zoomBy(2); // custom, scale 2
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    useViewerStore.getState().setZoomMode("fit");
    expect(useViewerStore.getState().zoomMode).toBe("fit");
    expect(useViewerStore.getState().scale).toBe(1);
  });

  it("zoomBy sets custom mode and multiplies scale (clamped)", () => {
    useViewerStore.getState().setZoomMode("fit");
    useViewerStore.getState().zoomBy(2);
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    expect(useViewerStore.getState().scale).toBe(2);
  });
});
```

- [ ] **Step 2: 失敗確認** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test` → FAIL（未定義）。

- [ ] **Step 3: ストアを実装** `src/store/useViewerStore.ts`:
```ts
import { create } from "zustand";
import type { ZoomMode } from "../types";
import { useQueryStore } from "./useQueryStore";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface ViewerState {
  isOpen: boolean;
  index: number;
  selectedIndex: number;
  zoomMode: ZoomMode;
  scale: number;
  open: (index: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  select: (index: number) => void;
  setZoomMode: (m: ZoomMode) => void;
  zoomBy: (factor: number) => void;
}

function resultsLength(): number {
  return useQueryStore.getState().results.length;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  isOpen: false,
  index: 0,
  selectedIndex: 0,
  zoomMode: "fit",
  scale: 1,
  open: (index) =>
    set({ isOpen: true, index, selectedIndex: index, zoomMode: "fit", scale: 1 }),
  close: () => set({ isOpen: false }),
  next: () => {
    const last = resultsLength() - 1;
    set({ index: Math.min(get().index + 1, Math.max(last, 0)), zoomMode: get().zoomMode, scale: get().zoomMode === "custom" ? 1 : get().scale });
  },
  prev: () => {
    set({ index: Math.max(get().index - 1, 0), scale: get().zoomMode === "custom" ? 1 : get().scale });
  },
  select: (index) => set({ selectedIndex: index }),
  setZoomMode: (m) => set({ zoomMode: m, scale: 1 }),
  zoomBy: (factor) =>
    set({
      zoomMode: "custom",
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor)),
    }),
}));
```

- [ ] **Step 4: テスト** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm test` → 既存14＋新規6＝20件 PASS。

- [ ] **Step 5: Commit**
```bash
git add src/store/useViewerStore.ts src/store/useViewerStore.test.ts
git commit -m "feat(frontend): add viewer store (open/close/nav/zoom/selection)"
```

---

## Task 6: MetadataPanel

**Files:**
- Create: `src/components/MetadataPanel.tsx`

- [ ] **Step 1: MetadataPanel を実装** `src/components/MetadataPanel.tsx`:
```tsx
import type { ImageDetail } from "../types";

interface Props {
  detail: ImageDetail | null;
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

export function MetadataPanel({ detail }: Props) {
  if (!detail) {
    return <div className="meta-panel" />;
  }

  const copyPrompt = async () => {
    const text = detail.raw_parameters ?? detail.positive ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("クリップボードへのコピーに失敗しました:", e);
    }
  };

  return (
    <div className="meta-panel">
      <h3 className="meta-filename" title={detail.path}>
        {detail.filename}
      </h3>
      <Row label="サイズ" value={`${detail.width} × ${detail.height}`} />
      <Row label="ツール" value={detail.source_tool} />
      <Row label="モデル" value={detail.model} />
      <Row label="サンプラー" value={detail.sampler} />
      <Row label="Steps" value={detail.steps} />
      <Row label="CFG" value={detail.cfg} />
      <Row label="Seed" value={detail.seed} />
      <Row label="レーティング" value={detail.rating !== null ? `★${detail.rating}` : null} />

      {detail.positive && (
        <div className="meta-block">
          <div className="meta-block-head">
            <span className="meta-label">Prompt</span>
            <button onClick={() => void copyPrompt()}>コピー</button>
          </div>
          <pre className="meta-text">{detail.positive}</pre>
        </div>
      )}
      {detail.negative && (
        <div className="meta-block">
          <span className="meta-label">Negative</span>
          <pre className="meta-text">{detail.negative}</pre>
        </div>
      )}
      {!detail.positive && detail.raw_parameters && (
        <div className="meta-block">
          <div className="meta-block-head">
            <span className="meta-label">Parameters</span>
            <button onClick={() => void copyPrompt()}>コピー</button>
          </div>
          <pre className="meta-text">{detail.raw_parameters}</pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功（MetadataPanel は ImageViewer から使うので未使用警告が出る場合は次タスクで解消）。`npm test` 既存PASS。

- [ ] **Step 3: Commit**
```bash
git add src/components/MetadataPanel.tsx
git commit -m "feat(frontend): add metadata panel with prompt copy"
```

---

## Task 7: ImageViewer（オーバーレイ・ズーム・キーボード操作）

**Files:**
- Create: `src/components/ImageViewer.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: ImageViewer を実装** `src/components/ImageViewer.tsx`:
```tsx
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { getImageDetail } from "../api/images";
import type { ImageDetail, ZoomMode } from "../types";
import { MetadataPanel } from "./MetadataPanel";

const ZOOM_LABELS: Record<ZoomMode, string> = {
  fit: "全体フィット",
  actual: "等倍",
  fill: "Fill",
  custom: "任意倍率",
};

export function ImageViewer() {
  const isOpen = useViewerStore((s) => s.isOpen);
  const index = useViewerStore((s) => s.index);
  const zoomMode = useViewerStore((s) => s.zoomMode);
  const scale = useViewerStore((s) => s.scale);
  const close = useViewerStore((s) => s.close);
  const next = useViewerStore((s) => s.next);
  const prev = useViewerStore((s) => s.prev);
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const zoomBy = useViewerStore((s) => s.zoomBy);

  const results = useQueryStore((s) => s.results);
  const image = results[index];

  const [detail, setDetail] = useState<ImageDetail | null>(null);

  // 現在画像のメタデータを取得。
  useEffect(() => {
    if (!isOpen || !image) return;
    let active = true;
    setDetail(null);
    getImageDetail(image.id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => console.error("メタデータ取得に失敗しました:", e));
    return () => {
      active = false;
    };
  }, [isOpen, image]);

  // キーボード操作。
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowRight":
        case " ":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
          prev();
          break;
        case "+":
        case "=":
          zoomBy(1.25);
          break;
        case "-":
          zoomBy(0.8);
          break;
        case "1":
          setZoomMode("fit");
          break;
        case "2":
          setZoomMode("actual");
          break;
        case "3":
          setZoomMode("fill");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close, next, prev, zoomBy, setZoomMode]);

  if (!isOpen || !image) return null;

  const src = convertFileSrc(image.path);
  const imgClass = `viewer-img viewer-${zoomMode}`;
  const imgStyle =
    zoomMode === "custom" ? { transform: `scale(${scale})` } : undefined;

  return (
    <div className="viewer-overlay">
      <div className="viewer-main">
        <div className="viewer-toolbar">
          <button onClick={close} aria-label="閉じる">
            ✕
          </button>
          <span className="viewer-pos">
            {index + 1} / {results.length}
          </span>
          <div className="viewer-zoom">
            {(Object.keys(ZOOM_LABELS) as ZoomMode[]).map((m) => (
              <button
                key={m}
                className={zoomMode === m ? "active" : ""}
                onClick={() => setZoomMode(m)}
              >
                {ZOOM_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="viewer-stage">
          <button className="viewer-nav prev" onClick={prev} aria-label="前へ">
            ‹
          </button>
          <img className={imgClass} style={imgStyle} src={src} alt={image.filename} />
          <button className="viewer-nav next" onClick={next} aria-label="次へ">
            ›
          </button>
        </div>
      </div>
      <MetadataPanel detail={detail} />
    </div>
  );
}
```

- [ ] **Step 2:** `src/App.css` の末尾に追記:
```css
/* ビューア */
.viewer-overlay {
  position: fixed;
  inset: 0;
  background: #000;
  display: flex;
  z-index: 20;
}
.viewer-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: #1a1a1a;
  color: #eee;
}
.viewer-pos {
  font-size: 12px;
  color: #aaa;
}
.viewer-zoom {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.viewer-zoom button.active {
  background: #3a6ea5;
  color: #fff;
}
.viewer-stage {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.viewer-img {
  display: block;
}
.viewer-img.viewer-fit {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.viewer-img.viewer-actual {
  /* 原寸。viewer-stage が overflow:auto でスクロール */
}
.viewer-img.viewer-fill {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.viewer-img.viewer-custom {
  transform-origin: center center;
}
.viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  border: none;
  font-size: 32px;
  width: 48px;
  height: 64px;
  cursor: pointer;
  z-index: 1;
}
.viewer-nav.prev {
  left: 0;
}
.viewer-nav.next {
  right: 0;
}
.meta-panel {
  width: 320px;
  background: #161616;
  color: #ddd;
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
}
.meta-filename {
  font-size: 13px;
  word-break: break-all;
  margin: 0 0 8px;
}
.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
}
.meta-label {
  color: #888;
}
.meta-value {
  text-align: right;
  word-break: break-all;
}
.meta-block {
  margin-top: 10px;
}
.meta-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.meta-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  background: #0d0d0d;
  padding: 6px;
  border-radius: 4px;
  max-height: 240px;
  overflow-y: auto;
  margin: 4px 0 0;
}
```

- [ ] **Step 3:** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功。`npm test` 既存PASS。

- [ ] **Step 4: Commit**
```bash
git add src/components/ImageViewer.tsx src/App.css
git commit -m "feat(frontend): image viewer overlay with zoom modes and keyboard nav"
```

---

## Task 8: グリッドからのビューア起動（選択・ダブルクリック・Enter）

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: グリッドに選択とビューア起動を追加**

`src/components/ImageGridPanel.tsx` を編集する。Read してから次の変更を行う:
- import 追加:
```tsx
import { useViewerStore } from "../store/useViewerStore";
import { ImageViewer } from "./ImageViewer";
```
- コンポーネント内でビューア/選択アクションを取得:
```tsx
  const selectedIndex = useViewerStore((s) => s.selectedIndex);
  const selectImage = useViewerStore((s) => s.select);
  const openViewer = useViewerStore((s) => s.open);
```
- ルートの `.image-grid` div に `tabIndex={0}` と `onKeyDown` を追加し、Enterで選択中をビューア起動:
```tsx
    <div
      className="image-grid"
      ref={parentRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && results[selectedIndex]) {
          e.preventDefault();
          openViewer(selectedIndex);
        }
      }}
    >
```
  （`width===0`・空結果の早期returnの div には付けなくてよい。本体の return の div に付ける。）
- 各セルに「グローバルインデックス」を渡し、クリックで選択・ダブルクリックで起動、選択中をハイライト。`items.map((img) => ...)` を index 付きに変更:
```tsx
              {items.map((img, col) => {
                const globalIndex = start + col;
                return (
                  <div
                    key={img.id}
                    className={
                      globalIndex === selectedIndex ? "thumb-cell selected" : "thumb-cell"
                    }
                    onClick={() => selectImage(globalIndex)}
                    onDoubleClick={() => openViewer(globalIndex)}
                  >
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
                );
              })}
```
- 本体 return の `.image-grid` の閉じ `</div>` の直前（仮想化コンテナの後）に `<ImageViewer />` を描画:
```tsx
      </div>
      <ImageViewer />
    </div>
```
（`<ImageViewer />` は `isOpen=false` のとき null を返すので常時マウントで問題ない。）

`src/App.css` の末尾に選択ハイライトを追加:
```css
.thumb-cell.selected .thumb-square {
  outline: 2px solid #3a6ea5;
  outline-offset: 1px;
}
```

- [ ] **Step 2:** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build` → 成功。`npm test` 既存PASS。

- [ ] **Step 3: Commit**
```bash
git add src/components/ImageGridPanel.tsx src/App.css
git commit -m "feat(frontend): grid selection, double-click/Enter to open viewer"
```

---

## Task 9: ネイティブ「表示」メニュー（Rust）

**Files:**
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/lib.rs`（メニュー構築・on_menu_event・同期コマンド登録）

> **注（重要・リスク）:** Tauri v2 のメニューAPI（`tauri::menu::{MenuBuilder, SubmenuBuilder, CheckMenuItemBuilder, MenuItemBuilder}`、`app.set_menu`、`app.on_menu_event`、`CheckMenuItem::set_checked`）はマイナーバージョンで差異がある。下記はTauri 2.x想定のコード。コンパイルエラー時は当バージョンのメニューAPIに合わせて調整し、報告に明記すること。メニューが組めない場合でも、ビューアはキーボード/ツールバーで完結して動作する（メニューは追加トリガ）。

- [ ] **Step 1: menu.rs を作成**

`src-tauri/src/menu.rs`:
```rust
use tauri::menu::{CheckMenuItem, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Wry};

/// 「表示」メニューのチェック項目ハンドルを保持し、フロントの状態と同期する。
pub struct ViewMenu {
    pub zoom_fit: CheckMenuItem<Wry>,
    pub zoom_actual: CheckMenuItem<Wry>,
    pub zoom_fill: CheckMenuItem<Wry>,
    pub zoom_custom: CheckMenuItem<Wry>,
    pub show_filename: CheckMenuItem<Wry>,
}

/// アプリメニューを構築し、ViewMenu（チェック項目ハンドル）を返す。
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ViewMenu)> {
    let zoom_fit = CheckMenuItem::with_id(app, "zoom_fit", "全体フィット", true, true, None::<&str>)?;
    let zoom_actual = CheckMenuItem::with_id(app, "zoom_actual", "等倍", true, false, None::<&str>)?;
    let zoom_fill = CheckMenuItem::with_id(app, "zoom_fill", "Fill", true, false, None::<&str>)?;
    let zoom_custom = CheckMenuItem::with_id(app, "zoom_custom", "任意倍率", true, false, None::<&str>)?;
    let show_filename =
        CheckMenuItem::with_id(app, "toggle_filename", "ファイル名を表示", true, true, None::<&str>)?;

    let zoom_submenu = SubmenuBuilder::new(app, "ズーム")
        .item(&zoom_fit)
        .item(&zoom_actual)
        .item(&zoom_fill)
        .item(&zoom_custom)
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_submenu)
        .separator()
        .item(&show_filename)
        .build()?;

    let menu = MenuBuilder::new(app).item(&view_submenu).build()?;

    Ok((
        menu,
        ViewMenu {
            zoom_fit,
            zoom_actual,
            zoom_fill,
            zoom_custom,
            show_filename,
        },
    ))
}

impl ViewMenu {
    /// フロントのズームモードに合わせてチェックを排他更新する。
    pub fn sync_zoom(&self, mode: &str) {
        let _ = self.zoom_fit.set_checked(mode == "fit");
        let _ = self.zoom_actual.set_checked(mode == "actual");
        let _ = self.zoom_fill.set_checked(mode == "fill");
        let _ = self.zoom_custom.set_checked(mode == "custom");
    }

    pub fn sync_filename(&self, on: bool) {
        let _ = self.show_filename.set_checked(on);
    }
}
```

- [ ] **Step 2: lib.rs にメニュー設定・イベント・同期コマンド**

`src-tauri/src/lib.rs` を編集:
- モジュール宣言に `mod menu;` を追加。
- `use tauri::{Emitter, Manager};`（Emitter が無ければ追加）。
- `setup` クロージャ内（asset scope 許可の後）でメニューを構築・設定・managed state 化:
```rust
            let (app_menu, view_menu) = menu::build(app.handle())?;
            app.set_menu(app_menu)?;
            app.manage(view_menu);
```
- `tauri::Builder` に `on_menu_event` を追加（`.setup(...)` の後あたり）:
```rust
        .on_menu_event(|app, event| {
            // メニュークリックをフロントへ転送（フロントが状態の出所）。
            let _ = app.emit("menu-action", event.id().0.clone());
        })
```
  （`event.id().0` がメニューIDの文字列。バージョンにより `event.id().as_ref()` 等の場合あり、調整可。）
- 同期コマンドを追加（`commands` ではなく lib.rs 末尾に直接書くか、`commands/view_menu.rs` を作る。ここでは lib.rs に近い `commands/menu.rs` を作るのが整合的だが、簡潔のため lib.rs 末尾に `#[tauri::command]` で定義してよい）。本計画では `commands/view_menu.rs` を作る:

`src-tauri/src/commands/view_menu.rs` を作成:
```rust
use crate::menu::ViewMenu;
use tauri::State;

/// フロントのズームモード変更をネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_zoom_menu(menu: State<ViewMenu>, mode: String) {
    menu.sync_zoom(&mode);
}

/// フロントのファイル名表示トグルをネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_filename_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_filename(on);
}
```
`src-tauri/src/commands/mod.rs` に `pub mod view_menu;` を追記。
`invoke_handler!` に追加:
```rust
            commands::view_menu::sync_zoom_menu,
            commands::view_menu::sync_filename_menu,
```

- [ ] **Step 3:** Run: `cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo build && cargo test` → 成功・全PASS。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/menu.rs src-tauri/src/commands/view_menu.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(menu): native View menu with zoom and filename checkable items"
```

---

## Task 10: フロントのメニュー連携（イベント購読・チェック同期）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/api/prefs.ts`（同期コマンドのラッパ）
- Modify: `src/store/useViewerStore.ts`（setZoomMode/zoomBy でメニュー同期）
- Modify: `src/store/useQueryStore.ts`（toggleShowFilename でメニュー同期）

- [ ] **Step 1: 同期APIラッパ** `src/api/prefs.ts` の末尾に追加:
```ts
export const syncZoomMenu = (mode: string) => invoke<void>("sync_zoom_menu", { mode });
export const syncFilenameMenu = (on: boolean) => invoke<void>("sync_filename_menu", { on });
```

- [ ] **Step 2: ビューアストアからメニュー同期**

`src/store/useViewerStore.ts` の `setZoomMode` と `zoomBy` で、ズームモード変更時にメニューを同期する。import を追加:
```ts
import { syncZoomMenu } from "../api/prefs";
```
`setZoomMode` と `zoomBy` の set 後に同期（fire-and-forget・catch）:
```ts
  setZoomMode: (m) => {
    set({ zoomMode: m, scale: 1 });
    syncZoomMenu(m).catch((e) => console.error("syncZoomMenu failed:", e));
  },
  zoomBy: (factor) => {
    set({
      zoomMode: "custom",
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor)),
    });
    syncZoomMenu("custom").catch((e) => console.error("syncZoomMenu failed:", e));
  },
```
（`open` で `zoomMode:"fit"` にリセットする際もメニュー同期したいので、`open` の set 後にも `syncZoomMenu("fit").catch(...)` を追加する。）
**注**: `useViewerStore.test.ts` は `syncZoomMenu`（api/prefs→Tauri invoke）を呼ぶため、テストが Tauri ランタイム無しで落ちないよう、テストファイル先頭で `vi.mock("../api/prefs")` を追加すること（Task 5 のテストに後追いで追記）。本タスクで `useViewerStore.test.ts` に `import { vi } from "vitest"` と `vi.mock("../api/prefs");` を足し、全テストが通ることを確認する。

- [ ] **Step 3: ファイル名トグルでメニュー同期**

`src/store/useQueryStore.ts` の `toggleShowFilename` と `loadSettings`（showFilename 反映後）で `syncFilenameMenu` を呼ぶ。import に追加:
```ts
import { syncFilenameMenu } from "../api/prefs";
```
`toggleShowFilename` の末尾（setSetting の後）と、`loadSettings` の showRaw 反映後に:
```ts
    syncFilenameMenu(next).catch((e) => console.error("syncFilenameMenu failed:", e));
```
（`loadSettings` 側は反映した `showFilename` 値で呼ぶ。）`useQueryStore.test.ts` は既に `vi.mock("../api/prefs")` しているため追加のモックは不要だが、`syncFilenameMenu` がモック対象に含まれることを確認する。

- [ ] **Step 4: App.tsx でメニューイベント購読**

`src/App.tsx` を編集。import 追加:
```tsx
import { listen } from "@tauri-apps/api/event";
import { useViewerStore } from "./store/useViewerStore";
import type { ZoomMode } from "./types";
```
コンポーネント内でアクション取得:
```tsx
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
```
メニューイベント購読の useEffect を追加（既存の起動 useEffect とは別に）:
```tsx
  useEffect(() => {
    const un = listen<string>("menu-action", (e) => {
      const id = e.payload;
      if (id === "toggle_filename") {
        void toggleShowFilename();
      } else if (id.startsWith("zoom_")) {
        const mode = id.replace("zoom_", "") as ZoomMode;
        setZoomMode(mode);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [toggleShowFilename, setZoomMode]);
```

- [ ] **Step 5:** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run build && npm test` → 成功・全PASS（useViewerStore のテストは api/prefs モックで通る）。

- [ ] **Step 6: Commit**
```bash
git add src/App.tsx src/api/prefs.ts src/store/useViewerStore.ts src/store/useViewerStore.test.ts src/store/useQueryStore.ts
git commit -m "feat(frontend): wire native menu events and zoom/filename check sync"
```

---

## Task 11: 結合・手動スモークテスト

**Files:** なし（検証のみ）

- [ ] **Step 1: 全自動テスト**
```bash
cd /Users/ikomiki/workspace/gen-img-manager/src-tauri && cargo test
cd /Users/ikomiki/workspace/gen-img-manager && npm test
```
Expected: Rust 全テスト・フロント全テスト PASS。

- [ ] **Step 2: 開発モードで起動** Run: `cd /Users/ikomiki/workspace/gen-img-manager && npm run tauri dev`

- [ ] **Step 3: ビューア起動と原画像表示**
操作: スキャン済みディレクトリの一覧で、サムネをダブルクリック（またはクリックで選択→Enter）。
Expected: メインウィンドウ内オーバーレイで原画像が全体フィット表示。横の領域にメタデータ（ファイル名/寸法/モデル/Prompt等）が出る。原画像が表示される（asset scope 許可が効いている）。

- [ ] **Step 4: ナビゲーションとズーム**
操作: `→`/`Space` で次、`←` で前、端で停止。ズームボタンまたは `1`/`2`/`3` キーで 全体フィット/等倍/Fill 切替。`+`/`-` で任意倍率。`Esc` で閉じる。
Expected: それぞれ反映。等倍は原寸でスクロール、Fill は領域を埋める、任意倍率は拡大縮小。

- [ ] **Step 5: メニュー連携**
操作: メインメニュー「表示」→「ズーム」で各モードを選択。「表示」→「ファイル名を表示」をトグル。ビューア内でズーム変更後にメニューのチェックが追従するか確認。
Expected: メニュー選択でビューアのズームが変わり、ビューア/ツールバー操作でメニューのチェックが同期する。ファイル名トグルが一覧に反映＋メニューチェック同期。

- [ ] **Step 6: メタデータのコピー**
操作: メタパネルの Prompt「コピー」ボタン。
Expected: クリップボードにプロンプト（または parameters）がコピーされる。

- [ ] **Step 7: マイルストーン完了コミット**
```bash
cd /Users/ikomiki/workspace/gen-img-manager
git commit --allow-empty -m "chore: milestone 4 complete - image viewer"
```

---

## このプランで満たす設計書の項目（自己レビュー）

- §「画像をダブルクリックあるいはEnterキーすると」→ ビューア起動 ✔（Task 8）
- §画像表示: ウィンドウ内一枚絵、カーソル左右/スペースで探索、Escで閉じる ✔（Task 7）
- §ズーム: 既定=アスペクト比維持の全体フィット、その他（等倍/Fill/任意倍率）、メインメニュー「表示」→「ズーム」でチェック ✔（Task 5,7,9,10）
- §C案ハイブリッド（ビューアはメインウィンドウ内オーバーレイ）✔（Task 7,8）
- §メタデータ（プロンプト全文・コピー可）✔（Task 6,7）
- §8 原画像も asset protocol で表示 ✔（Task 3）

**計画5に持ち越す項目（範囲外）:** スライドショー（専用ウィンドウ・ランダム/ループ/秒数/先読み・フルスクリーン・表示メニューのスライドショー切替）。任意倍率のドラッグパン詳細（本計画は scale 中心、必要なら計画5前後で拡張）。

## 既知の注意点・実装時のリスク

- **Tauri v2 メニューAPI**: `tauri::menu` のビルダ/`CheckMenuItem::with_id`/`set_checked`/`app.set_menu`/`on_menu_event`/`event.id()` はマイナーバージョン差がある。Task 9 はコンパイルエラーに合わせて調整必須。メニューが組めなくてもビューアはキーボード/ツールバーで完結動作する（メニューは追加トリガ）。`ViewMenu` の managed state 化と `State<ViewMenu>` コマンドで双方向同期する設計。
- **asset scope と任意ディレクトリ**: 原画像表示のため記憶対象ディレクトリを `allow_directory` する。ユーザーが選んだフォルダのみを許可（`$APPDATA/**` 同様、ホーム全体は許可しない）。CSP は現状 null のため img 表示はブロックされない。
- **メニュー同期テスト**: `useViewerStore` が `syncZoomMenu`（Tauri invoke）を呼ぶため、`useViewerStore.test.ts` で `vi.mock("../api/prefs")` 必須。Task 5 で素朴に作り Task 10 でモック追加する流れ（Task 10 Step 2 で明記）。
- **大画像の等倍表示**: `viewer-actual` は原寸でstageが overflow:auto。巨大画像でメモリ負荷があるが原画像表示の要件上許容。先読み（次画像のプリロード）は計画5のスライドショーで扱う。
- **クリップボード**: `navigator.clipboard.writeText` を使用（Tauri WebViewのsecure contextで動作）。tauri-plugin-clipboard は使わない。
