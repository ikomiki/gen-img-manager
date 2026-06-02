# スライドショー（計画5）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在のフィルタ＆ソート済みリストのスナップショットを専用ウィンドウで再生するスライドショー機能を実装する（ランダム/ループ/間隔指定/次画像プリロード/ウィンドウ・フルスクリーン切替/キーボード操作/表示メニュー連携）。

**Architecture:** 起動時にフロントが現在の `results`（画像パス配列）と開始位置をバックエンドの管理状態（`SlideshowState`）へ保存し、Rust 側で `slideshow` ラベルの第2 `WebviewWindow`（`index.html#slideshow`）を生成する。第2ウィンドウは同じ React バンドルをハッシュルーティングで `SlideshowApp` として起動し、マウント時に `get_slideshow_payload` でスナップショットを取得する。再生順序・前後送り・ループ折返しは純粋関数（`util/playlist.ts`）に切り出して単体テストし、タイマー/プリロード/フルスクリーン等の副作用はコンポーネントが担う。

**Tech Stack:** Tauri v2（`WebviewWindowBuilder`, `tauri::menu`）、Rust（rusqlite settings 既存）、React 19 + TypeScript、Zustand（既存ストア参照のみ）、Vitest。

---

## 前提・既存実装の参照ポイント

- バックエンドコマンドは `src-tauri/src/commands/<name>.rs` に定義し、`commands/mod.rs` で `pub mod`、`lib.rs` の `generate_handler!` に登録する（既存 `prefs`, `view_menu` と同じ流儀）。
- 設定の永続化は既存の `get_setting` / `set_setting`（`settings` テーブル、UPSERT）を再利用する。新キー: `slideshow_interval`（秒, 既定 `"5"`）、`slideshow_loop`（`"true"`/`"false"`, 既定 true）、`slideshow_random`（`"true"`/`"false"`, 既定 false）。
- メニューは `src-tauri/src/menu.rs` の `ViewMenu` にチェック項目を追加し、`build()` の「表示」サブメニューへ「スライドショー」サブメニューを足す。`Menu::default(app)` + `append` で macOS 既定メニューを保持する流儀を厳守する。
- メニュークリックは `lib.rs` の `on_menu_event` が `app.emit("menu-action", <id>)` で全ウィンドウへブロードキャストする（既存）。`SlideshowApp` 側でこのイベントを購読する。
- 原画像は asset protocol（`convertFileSrc`）で表示する。スコープは起動時に登録ディレクトリへ `allow_directory` 済み（`lib.rs`）で全ウィンドウ共通。第2ウィンドウでもそのまま表示できる。
- Tauri のコマンド引数は JS 側 camelCase → Rust 側 snake_case に自動変換される（例: JS `{ startIndex }` → Rust `start_index`）。一方、戻り値の serde シリアライズはフィールド名そのまま（`start_index`）。フロントの型はこれに合わせる。
- アプリ定義コマンド（`generate_handler!` 登録分）は ACL 権限の対象外で、どのウィンドウからも呼べる。core プラグイン（`setFullscreen` 等）の呼び出しのみ capability が必要。

---

## ファイル構成

**バックエンド（新規）**
- `src-tauri/src/commands/slideshow.rs` — `SlideshowState`/`SlideshowPayload`、`set_payload`/`get_payload`（テスト対象の純ロジック）、`start_slideshow`/`get_slideshow_payload`（#[command]）。
- `src-tauri/capabilities/slideshow.json` — `slideshow` ウィンドウ用 capability（フルスクリーン/クローズ権限）。

**バックエンド（変更）**
- `src-tauri/src/commands/mod.rs` — `pub mod slideshow;`
- `src-tauri/src/menu.rs` — `ViewMenu` にスライドショー用チェック項目追加、`sync_slideshow`。
- `src-tauri/src/commands/view_menu.rs` — `sync_slideshow_menu` コマンド追加。
- `src-tauri/src/lib.rs` — `SlideshowState` を manage、コマンド3種を登録。

**フロント（新規）**
- `src/util/playlist.ts` + `src/util/playlist.test.ts` — 再生順序/送りの純粋関数。
- `src/api/slideshow.ts` — `startSlideshow`/`getSlideshowPayload`/`syncSlideshowMenu`。
- `src/components/SlideshowApp.tsx` — 第2ウィンドウのルート（再生・プリロード・キーボード・フルスクリーン）。
- `src/components/SlideshowControls.tsx` — オーバーレイ操作バー（再生/一時停止・間隔・ループ・ランダム・フルスクリーン）。
- `src/SlideshowApp.css` — スライドショー用スタイル。

**フロント（変更）**
- `src/types.ts` — `SlideshowPayload` 型追加。
- `src/main.tsx` — `location.hash` による分岐ルーティング。
- `src/components/FilterBar.tsx` — ツールバーに「スライドショー▶」起動ボタン。

---

## Task 1: バックエンド スライドショーのペイロード保管（純ロジック + コマンド）

**Files:**
- Create: `src-tauri/src/commands/slideshow.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: `slideshow.rs` を作成し、状態・ペイロード・純ロジック・テストを書く**

`src-tauri/src/commands/slideshow.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// スライドショーへ渡すスナップショット（画像パス列と開始位置）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SlideshowPayload {
    pub paths: Vec<String>,
    pub start_index: usize,
}

/// 専用ウィンドウへ受け渡すスナップショットを保持する管理状態。
pub struct SlideshowState(pub Mutex<Option<SlideshowPayload>>);

impl Default for SlideshowState {
    fn default() -> Self {
        SlideshowState(Mutex::new(None))
    }
}

/// スナップショットを保存する（純ロジック・テスト対象）。
pub fn set_payload(state: &SlideshowState, payload: SlideshowPayload) {
    *state.0.lock().unwrap() = Some(payload);
}

/// 保存済みスナップショットを取得する（純ロジック・テスト対象）。
pub fn get_payload(state: &SlideshowState) -> Option<SlideshowPayload> {
    state.0.lock().unwrap().clone()
}

/// スナップショットを保存し、スライドショー専用ウィンドウを生成（または前面化）する。
#[tauri::command]
pub fn start_slideshow(
    app: AppHandle,
    state: State<SlideshowState>,
    paths: Vec<String>,
    start_index: usize,
) -> Result<(), String> {
    set_payload(&state, SlideshowPayload { paths, start_index });
    if let Some(w) = app.get_webview_window("slideshow") {
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "slideshow",
            WebviewUrl::App("index.html#slideshow".into()),
        )
        .title("スライドショー")
        .inner_size(1000.0, 700.0)
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// スライドショーウィンドウがマウント時に取得するスナップショット。
#[tauri::command]
pub fn get_slideshow_payload(state: State<SlideshowState>) -> Option<SlideshowPayload> {
    get_payload(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_payload_is_none_initially() {
        let state = SlideshowState::default();
        assert_eq!(get_payload(&state), None);
    }

    #[test]
    fn set_then_get_roundtrip_and_overwrite() {
        let state = SlideshowState::default();
        set_payload(
            &state,
            SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], start_index: 1 },
        );
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], start_index: 1 })
        );
        set_payload(&state, SlideshowPayload { paths: vec!["/c.png".into()], start_index: 0 });
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/c.png".into()], start_index: 0 })
        );
    }
}
```

- [ ] **Step 2: `commands/mod.rs` にモジュールを追加**

`src-tauri/src/commands/mod.rs` に次の行を追加（他の `pub mod` 行の並びに合わせる）:

```rust
pub mod slideshow;
```

- [ ] **Step 3: テストを実行して通ることを確認**

Run: `cd src-tauri && cargo test slideshow`
Expected: `set_then_get_roundtrip_and_overwrite` と `get_payload_is_none_initially` を含み PASS。`start_slideshow`/`get_slideshow_payload` は未登録だが `cargo test` はコンパイルが通れば実行される（この時点で `lib.rs` 未登録でも当モジュールはコンパイルされる）。

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/commands/slideshow.rs src-tauri/src/commands/mod.rs
git commit -m "feat(slideshow): backend payload state and window-launch commands"
```

---

## Task 2: バックエンド メニュー「表示 ▸ スライドショー」とチェック同期

**Files:**
- Modify: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/commands/view_menu.rs`

- [ ] **Step 1: `ViewMenu` 構造体にスライドショー用チェック項目を追加**

`src-tauri/src/menu.rs` の `ViewMenu` 構造体（`show_filename` の下）に追加:

```rust
    pub show_filename: CheckMenuItem<Wry>,
    pub slideshow_windowed: CheckMenuItem<Wry>,
    pub slideshow_fullscreen: CheckMenuItem<Wry>,
}
```

- [ ] **Step 2: `build()` にスライドショーサブメニューを追加**

`src-tauri/src/menu.rs` の `build()` 内、`show_filename` の生成直後にチェック項目を追加:

```rust
    let show_filename =
        CheckMenuItem::with_id(app, "toggle_filename", "ファイル名を表示", true, true, None::<&str>)?;
    let slideshow_windowed =
        CheckMenuItem::with_id(app, "slideshow_windowed", "ウィンドウ全体", true, true, None::<&str>)?;
    let slideshow_fullscreen =
        CheckMenuItem::with_id(app, "slideshow_fullscreen", "フルスクリーン", true, false, None::<&str>)?;
```

`zoom_submenu` の構築直後に、スライドショーサブメニューを構築し、`view_submenu` に組み込む:

```rust
    let slideshow_submenu = SubmenuBuilder::new(app, "スライドショー")
        .item(&slideshow_windowed)
        .item(&slideshow_fullscreen)
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_submenu)
        .item(&slideshow_submenu)
        .separator()
        .item(&show_filename)
        .build()?;
```

`Ok((menu, ViewMenu { ... }))` の構造体初期化に新フィールドを追加:

```rust
    Ok((
        menu,
        ViewMenu {
            zoom_fit,
            zoom_actual,
            zoom_fill,
            zoom_custom,
            show_filename,
            slideshow_windowed,
            slideshow_fullscreen,
        },
    ))
```

- [ ] **Step 3: `ViewMenu` に `sync_slideshow` を追加**

`src-tauri/src/menu.rs` の `impl ViewMenu` 内（`sync_filename` の下）に追加:

```rust
    /// スライドショーの表示モード（ウィンドウ全体 / フルスクリーン）を排他更新する。
    pub fn sync_slideshow(&self, fullscreen: bool) {
        if let Err(e) = self.slideshow_windowed.set_checked(!fullscreen) {
            eprintln!("[menu] slideshow_windowed set_checked failed: {e}");
        }
        if let Err(e) = self.slideshow_fullscreen.set_checked(fullscreen) {
            eprintln!("[menu] slideshow_fullscreen set_checked failed: {e}");
        }
    }
```

- [ ] **Step 4: `sync_slideshow_menu` コマンドを追加**

`src-tauri/src/commands/view_menu.rs` の末尾に追加:

```rust
/// スライドショーの表示モード変更をネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_slideshow_menu(menu: State<ViewMenu>, fullscreen: bool) {
    menu.sync_slideshow(fullscreen);
}
```

- [ ] **Step 5: コンパイル確認（コマンド登録は Task 3）**

Run: `cd src-tauri && cargo build`
Expected: コンパイル成功（警告 `function never used` が `sync_slideshow_menu`/`start_slideshow` 等に出る場合があるが Task 3 登録で解消）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/menu.rs src-tauri/src/commands/view_menu.rs
git commit -m "feat(slideshow): add 表示▸スライドショー menu with check sync"
```

---

## Task 3: バックエンド 状態管理とコマンド登録

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: `SlideshowState` を manage する**

`src-tauri/src/lib.rs` の `.setup(|app| { ... })` 内、`app.manage(view_menu);` の直前に追加:

```rust
            app.manage(crate::commands::slideshow::SlideshowState::default());
```

- [ ] **Step 2: コマンド3種を `generate_handler!` に登録**

`src-tauri/src/lib.rs` の `invoke_handler` 内、`commands::view_menu::sync_filename_menu,` の下に追加:

```rust
            commands::view_menu::sync_slideshow_menu,
            commands::slideshow::start_slideshow,
            commands::slideshow::get_slideshow_payload,
```

- [ ] **Step 3: 既存テストが壊れていないことを確認**

Run: `cd src-tauri && cargo test`
Expected: `87 passed`（既存）+ slideshow の 2 件 = `89 passed; 0 failed`。

- [ ] **Step 4: ビルド確認**

Run: `cd src-tauri && cargo build`
Expected: 成功・未使用警告なし。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(slideshow): manage SlideshowState and register commands"
```

---

## Task 4: スライドショーウィンドウの capability

**Files:**
- Create: `src-tauri/capabilities/slideshow.json`

- [ ] **Step 1: capability ファイルを作成**

`src-tauri/capabilities/slideshow.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "slideshow",
  "description": "Capability for the slideshow window",
  "windows": [
    "slideshow"
  ],
  "permissions": [
    "core:default",
    "core:window:allow-set-fullscreen",
    "core:window:allow-is-fullscreen",
    "core:window:allow-close",
    "core:event:default"
  ]
}
```

- [ ] **Step 2: ビルドで capability が解決されることを確認**

Run: `cd src-tauri && cargo build`
Expected: 成功（capability スキーマエラーが無いこと）。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/capabilities/slideshow.json
git commit -m "feat(slideshow): capability for slideshow window (fullscreen/close)"
```

---

## Task 5: フロント 型と API ラッパー

**Files:**
- Modify: `src/types.ts`
- Create: `src/api/slideshow.ts`

- [ ] **Step 1: `SlideshowPayload` 型を追加**

`src/types.ts` の末尾に追加（フィールド名はバックエンド serde 出力に合わせて `start_index`）:

```ts
export interface SlideshowPayload {
  paths: string[];
  start_index: number;
}
```

- [ ] **Step 2: API ラッパーを作成**

`src/api/slideshow.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { SlideshowPayload } from "../types";

/** 現在のリストのスナップショットを保存し、スライドショーウィンドウを起動する。 */
export const startSlideshow = (paths: string[], startIndex: number) =>
  invoke<void>("start_slideshow", { paths, startIndex });

/** スライドショーウィンドウがマウント時に取得するスナップショット。 */
export const getSlideshowPayload = () =>
  invoke<SlideshowPayload | null>("get_slideshow_payload");

/** スライドショーの表示モード（フルスクリーン）をネイティブメニューへ同期する。 */
export const syncSlideshowMenu = (fullscreen: boolean) =>
  invoke<void>("sync_slideshow_menu", { fullscreen });
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/types.ts src/api/slideshow.ts
git commit -m "feat(slideshow): frontend types and api wrappers"
```

---

## Task 6: 再生順序・送りの純粋関数（TDD）

**Files:**
- Create: `src/util/playlist.ts`
- Test: `src/util/playlist.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/playlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32, buildOrder, step } from "./playlist";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces values in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildOrder", () => {
  it("returns identity when not random", () => {
    expect(buildOrder(4, false, mulberry32(1))).toEqual([0, 1, 2, 3]);
  });

  it("returns a permutation of all indices when random", () => {
    const order = buildOrder(5, true, mulberry32(123));
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns empty for length 0", () => {
    expect(buildOrder(0, true, mulberry32(1))).toEqual([]);
  });
});

describe("step", () => {
  it("advances forward within bounds", () => {
    expect(step(0, 3, false, 1)).toEqual({ pos: 1, wrapped: false, stop: false });
  });

  it("stops at end when not looping", () => {
    expect(step(2, 3, false, 1)).toEqual({ pos: 2, wrapped: false, stop: true });
  });

  it("wraps to start at end when looping", () => {
    expect(step(2, 3, true, 1)).toEqual({ pos: 0, wrapped: true, stop: false });
  });

  it("goes backward within bounds", () => {
    expect(step(2, 3, false, -1)).toEqual({ pos: 1, wrapped: false, stop: false });
  });

  it("stays at start going backward when not looping", () => {
    expect(step(0, 3, false, -1)).toEqual({ pos: 0, wrapped: false, stop: false });
  });

  it("wraps to end going backward when looping", () => {
    expect(step(0, 3, true, -1)).toEqual({ pos: 2, wrapped: true, stop: false });
  });

  it("stops for empty list", () => {
    expect(step(0, 0, true, 1)).toEqual({ pos: 0, wrapped: false, stop: true });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/util/playlist.test.ts`
Expected: FAIL（`./playlist` が存在しない）。

- [ ] **Step 3: 実装を書く**

`src/util/playlist.ts`:

```ts
/** 決定的な疑似乱数生成器（mulberry32）。テスト容易性のため seed を取る。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 再生順序（results のインデックス列）を作る。
 * random=false なら昇順、true なら Fisher–Yates で重複なしシャッフル。
 */
export function buildOrder(length: number, random: boolean, rand: () => number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  if (!random) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export interface StepResult {
  /** 次の order 上の位置。 */
  pos: number;
  /** 末尾→先頭（または先頭→末尾）に折り返したか（random 時は再シャッフルの契機）。 */
  wrapped: boolean;
  /** 自動再生を停止すべきか（非ループで末尾に到達 or 空リスト）。 */
  stop: boolean;
}

/**
 * order 上の位置を delta（+1 次へ / -1 前へ）方向に進める。
 * ループ時は端で折り返す。非ループ時は前方端で停止、後方端で据え置き。
 */
export function step(pos: number, length: number, loop: boolean, delta: 1 | -1): StepResult {
  if (length <= 0) return { pos: 0, wrapped: false, stop: true };
  const next = pos + delta;
  if (next >= length) {
    return loop ? { pos: 0, wrapped: true, stop: false } : { pos: length - 1, wrapped: false, stop: true };
  }
  if (next < 0) {
    return loop ? { pos: length - 1, wrapped: true, stop: false } : { pos: 0, wrapped: false, stop: false };
  }
  return { pos: next, wrapped: false, stop: false };
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npx vitest run src/util/playlist.test.ts`
Expected: PASS（17 アサーション程度、全 green）。

- [ ] **Step 5: コミット**

```bash
git add src/util/playlist.ts src/util/playlist.test.ts
git commit -m "feat(slideshow): pure playlist ordering/advance utils with tests"
```

---

## Task 7: エントリのハッシュルーティング

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: `location.hash` で `SlideshowApp` を出し分ける**

`src/main.tsx` を次の内容に置き換える:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SlideshowApp } from "./components/SlideshowApp";

const isSlideshow = window.location.hash.replace(/^#/, "") === "slideshow";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSlideshow ? <SlideshowApp /> : <App />}</React.StrictMode>,
);
```

注: この時点では `SlideshowApp` が未作成のためビルドは失敗する。Task 8 とセットでコミットする（このタスクは単独でコミットしない）。

---

## Task 8: スライドショー本体コンポーネント

**Files:**
- Create: `src/components/SlideshowControls.tsx`
- Create: `src/components/SlideshowApp.tsx`
- Create: `src/SlideshowApp.css`

- [ ] **Step 1: 操作バー `SlideshowControls.tsx` を作成**

`src/components/SlideshowControls.tsx`:

```tsx
interface Props {
  playing: boolean;
  intervalSec: number;
  loop: boolean;
  random: boolean;
  fullscreen: boolean;
  position: number;
  total: number;
  onTogglePlay: () => void;
  onIntervalChange: (sec: number) => void;
  onToggleLoop: () => void;
  onToggleRandom: () => void;
  onToggleFullscreen: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SlideshowControls(props: Props) {
  return (
    <div className="ss-controls">
      <button onClick={props.onClose} aria-label="閉じる">
        ✕
      </button>
      <button onClick={props.onPrev} aria-label="前へ">
        ‹
      </button>
      <button onClick={props.onTogglePlay} aria-label={props.playing ? "一時停止" : "再生"}>
        {props.playing ? "⏸" : "▶"}
      </button>
      <button onClick={props.onNext} aria-label="次へ">
        ›
      </button>
      <span className="ss-pos">
        {props.total === 0 ? 0 : props.position + 1} / {props.total}
      </span>
      <label className="ss-field">
        間隔
        <input
          type="number"
          min={1}
          max={600}
          value={props.intervalSec}
          onChange={(e) => props.onIntervalChange(Math.max(1, Number(e.target.value) || 1))}
          aria-label="表示間隔（秒）"
        />
        秒
      </label>
      <label className="ss-field">
        <input type="checkbox" checked={props.loop} onChange={props.onToggleLoop} />
        ループ
      </label>
      <label className="ss-field">
        <input type="checkbox" checked={props.random} onChange={props.onToggleRandom} />
        ランダム
      </label>
      <button onClick={props.onToggleFullscreen} aria-pressed={props.fullscreen}>
        {props.fullscreen ? "ウィンドウ" : "全画面"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: スタイル `SlideshowApp.css` を作成**

`src/SlideshowApp.css`:

```css
.ss-root {
  position: fixed;
  inset: 0;
  background: #000;
  overflow: hidden;
}
.ss-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ss-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.ss-controls {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.6);
  color: #eee;
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 2;
}
.ss-root:hover .ss-controls,
.ss-controls:focus-within {
  opacity: 1;
}
.ss-field {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
}
.ss-field input[type="number"] {
  width: 56px;
}
.ss-pos {
  font-size: 12px;
  color: #bbb;
  white-space: nowrap;
}
.ss-toast {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 3;
}
.ss-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
}
```

- [ ] **Step 3: 本体 `SlideshowApp.tsx` を作成**

`src/components/SlideshowApp.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getSlideshowPayload, syncSlideshowMenu } from "../api/slideshow";
import { getSetting, setSetting } from "../api/prefs";
import { buildOrder, mulberry32, step } from "../util/playlist";
import { SlideshowControls } from "./SlideshowControls";
import "../SlideshowApp.css";

export function SlideshowApp() {
  const [paths, setPaths] = useState<string[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalSec, setIntervalSec] = useState(5);
  const [loop, setLoop] = useState(true);
  const [random, setRandom] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // 最新値を副作用から参照するための ref ミラー。
  const posRef = useRef(0);
  const orderRef = useRef<number[]>([]);
  const loopRef = useRef(true);
  const randomRef = useRef(false);
  const errorsRef = useRef(0);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { randomRef.current = random; }, [random]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  // 初期化: スナップショットと設定を読み込み、再生順序を組む。
  useEffect(() => {
    void (async () => {
      const [payload, iv, lp, rnd] = await Promise.all([
        getSlideshowPayload(),
        getSetting("slideshow_interval"),
        getSetting("slideshow_loop"),
        getSetting("slideshow_random"),
      ]);
      const sec = iv ? Math.max(1, Number(iv) || 5) : 5;
      const lpOn = lp === null ? true : lp !== "false";
      const rndOn = rnd === null ? false : rnd === "true";
      setIntervalSec(sec);
      setLoop(lpOn);
      setRandom(rndOn);

      const p = payload?.paths ?? [];
      const startImg = Math.min(payload?.start_index ?? 0, Math.max(p.length - 1, 0));
      const ord = buildOrder(p.length, rndOn, mulberry32(p.length + startImg + 1));
      let startPos = startImg;
      if (rndOn && p.length > 0) {
        // 開始画像を先頭に持ってくる。
        const i = ord.indexOf(startImg);
        if (i > 0) {
          ord.splice(i, 1);
          ord.unshift(startImg);
        }
        startPos = 0;
      }
      setPaths(p);
      setOrder(ord);
      setPos(startPos);
      setReady(true);
    })();
  }, []);

  // delta 方向に進める（自動・手動共通）。
  const advance = useCallback((delta: 1 | -1) => {
    const len = orderRef.current.length;
    if (len === 0) return;
    const r = step(posRef.current, len, loopRef.current, delta);
    if (r.stop) {
      setPlaying(false);
      return;
    }
    if (r.wrapped && randomRef.current && delta === 1) {
      setOrder(buildOrder(len, true, mulberry32(len + r.pos + posRef.current + 2)));
    }
    setPos(r.pos);
  }, []);

  // 自動再生タイマー。playing / 間隔 / 現在位置の変化で貼り直す。
  useEffect(() => {
    if (!ready || !playing || order.length === 0) return;
    const id = window.setTimeout(() => advance(1), intervalSec * 1000);
    return () => window.clearTimeout(id);
  }, [ready, playing, intervalSec, pos, order, advance]);

  // 次の1枚をプリロード（デコード済みで保持）。
  useEffect(() => {
    if (order.length === 0) return;
    const peek = step(pos, order.length, loop, 1).pos;
    const nextPath = paths[order[peek]];
    if (nextPath) {
      const img = new Image();
      img.src = convertFileSrc(nextPath);
    }
  }, [pos, order, paths, loop]);

  // フルスクリーン切替。
  const toggleFullscreen = useCallback(async (on: boolean) => {
    try {
      await getCurrentWindow().setFullscreen(on);
      setFullscreen(on);
      await syncSlideshowMenu(on);
    } catch (e) {
      console.error("setFullscreen failed:", e);
    }
  }, []);

  // キーボード操作。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          advance(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          advance(-1);
          break;
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "Escape":
          e.preventDefault();
          void getCurrentWindow().close();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);

  // メニュー「表示 ▸ スライドショー」連携。
  useEffect(() => {
    const un = listen<string>("menu-action", (e) => {
      if (e.payload === "slideshow_fullscreen") void toggleFullscreen(true);
      else if (e.payload === "slideshow_windowed") void toggleFullscreen(false);
    });
    return () => {
      un.then((f) => f());
    };
  }, [toggleFullscreen]);

  // 設定変更ハンドラ（永続化）。
  const onIntervalChange = (sec: number) => {
    setIntervalSec(sec);
    void setSetting("slideshow_interval", String(sec));
  };
  const onToggleLoop = () => {
    const next = !loop;
    setLoop(next);
    void setSetting("slideshow_loop", String(next));
  };
  const onToggleRandom = () => {
    const next = !random;
    setRandom(next);
    void setSetting("slideshow_random", String(next));
    // 現在の画像を起点に順序を組み直す。
    const curImg = orderRef.current[posRef.current] ?? 0;
    const ord = buildOrder(paths.length, next, mulberry32(Date.now()));
    if (next && paths.length > 0) {
      const i = ord.indexOf(curImg);
      if (i > 0) {
        ord.splice(i, 1);
        ord.unshift(curImg);
      }
      setOrder(ord);
      setPos(0);
    } else {
      setOrder(ord);
      setPos(curImg);
    }
  };

  // 画像読み込み失敗時は通知してスキップ（全滅なら停止）。
  const onImgError = () => {
    errorsRef.current += 1;
    showToast("画像を表示できないためスキップしました");
    if (errorsRef.current >= Math.max(order.length, 1)) {
      setPlaying(false);
      return;
    }
    advance(1);
  };
  const onImgLoad = () => {
    errorsRef.current = 0;
  };

  const currentPath = order.length > 0 ? paths[order[pos]] : undefined;

  return (
    <div className="ss-root">
      <div className="ss-stage">
        {currentPath ? (
          <img
            className="ss-img"
            src={convertFileSrc(currentPath)}
            alt=""
            onError={onImgError}
            onLoad={onImgLoad}
          />
        ) : (
          <div className="ss-empty">{ready ? "表示する画像がありません" : "読み込み中…"}</div>
        )}
      </div>
      {toast && <div className="ss-toast">{toast}</div>}
      <SlideshowControls
        playing={playing}
        intervalSec={intervalSec}
        loop={loop}
        random={random}
        fullscreen={fullscreen}
        position={pos}
        total={order.length}
        onTogglePlay={() => setPlaying((p) => !p)}
        onIntervalChange={onIntervalChange}
        onToggleLoop={onToggleLoop}
        onToggleRandom={onToggleRandom}
        onToggleFullscreen={() => void toggleFullscreen(!fullscreen)}
        onPrev={() => advance(-1)}
        onNext={() => advance(1)}
        onClose={() => void getCurrentWindow().close()}
      />
    </div>
  );
}
```

- [ ] **Step 4: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: 成功（Task 7 のルーティングと合わせてビルドが通る）。

- [ ] **Step 5: 全フロントテストが壊れていないことを確認**

Run: `npm test`
Expected: 既存 30 + playlist 分が green。

- [ ] **Step 6: コミット（Task 7 のルーティングも併せて）**

```bash
git add src/main.tsx src/components/SlideshowApp.tsx src/components/SlideshowControls.tsx src/SlideshowApp.css
git commit -m "feat(slideshow): slideshow window app with playback, preload, keyboard, fullscreen"
```

---

## Task 9: ツールバー「スライドショー▶」起動ボタン

**Files:**
- Modify: `src/components/FilterBar.tsx`

- [ ] **Step 1: import を追加**

`src/components/FilterBar.tsx` の import 群に追加:

```tsx
import { useViewerStore } from "../store/useViewerStore";
import { startSlideshow } from "../api/slideshow";
```

- [ ] **Step 2: 必要な store 値を読む**

`FilterBar` 関数内、既存の `useQueryStore` セレクタ群の near に追加:

```tsx
  const results = useQueryStore((s) => s.results);
  const selectedIndex = useViewerStore((s) => s.selectedIndex);
```

- [ ] **Step 3: 起動ハンドラを追加**

`submit` 関数の下に追加:

```tsx
  const launchSlideshow = () => {
    if (results.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : 0;
    void startSlideshow(
      results.map((r) => r.path),
      start,
    ).catch((e) => console.error("スライドショー起動に失敗しました:", e));
  };
```

- [ ] **Step 4: ボタンを配置**

`src/components/FilterBar.tsx` の「詳細…」ボタン（`<button onClick={() => setDialogOpen(true)} ...>詳細…</button>`）の直後に追加:

```tsx
      <button
        onClick={launchSlideshow}
        disabled={results.length === 0}
        aria-label="スライドショーを開始"
      >
        スライドショー▶
      </button>
```

- [ ] **Step 5: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: 成功。

- [ ] **Step 6: 全テスト確認**

Run: `npm test`
Expected: 全 green（FilterBar に store 依存追加でも既存テストは無関係に通る）。

- [ ] **Step 7: コミット**

```bash
git add src/components/FilterBar.tsx
git commit -m "feat(slideshow): toolbar launch button using current results snapshot"
```

---

## Task 10: 結合ビルドと全テスト確認

**Files:** （変更なし・検証のみ）

- [ ] **Step 1: バックエンド全テスト**

Run: `cd src-tauri && cargo test`
Expected: `89 passed; 0 failed`（既存 87 + slideshow 2）。

- [ ] **Step 2: バックエンド lint**

Run: `cd src-tauri && cargo clippy --all-targets`
Expected: 当計画の変更分に警告なし（既存からの新規警告ゼロ）。

- [ ] **Step 3: フロント全テスト**

Run: `npm test`
Expected: 全 green。

- [ ] **Step 4: フロント本番ビルド**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 5: コミット（不要なら省略）**

検証のみで差分が無ければコミット不要。

---

## Task 11: GUI スモークテスト（手動・ヘッドレス不可）

**Files:** （手動確認）

- [ ] **Step 1: 開発起動**

Run: `npm run tauri dev`

- [ ] **Step 2: 以下を目視確認**

1. メイン一覧でフィルタ/ソートを適用 → ツールバー「スライドショー▶」で専用ウィンドウが開く。
2. 選択画像があればそこから、なければ先頭から開始する。
3. 指定間隔（既定5秒）で自動送り。`Space` で一時停止/再開。`←/→` で手動前後（タイマーが貼り直される）。`Esc` でウィンドウが閉じる。
4. 「ランダム」ON で重複なしシャッフル、「ループ」ON で末尾→先頭（ランダム時は再シャッフル）。間隔/ループ/ランダムを変更 → アプリ再起動後も保持（settings 永続化）。
5. 表示メニュー「表示 ▸ スライドショー ▸ フルスクリーン/ウィンドウ全体」で全画面切替＆チェックが排他更新される。操作バー「全画面/ウィンドウ」ボタンでも切替できる。
6. 画像はアスペクト比維持で黒背景に全体フィット。
7. 切断/欠落（存在しないパスを含むディレクトリをオフライン化等）に当たると通知が出てスキップし、再生は止まらない。
8. 次画像のプリロードにより、切替時に黒画面の待ちが（ほぼ）生じない。

---

## Self-Review

**1. Spec coverage（§7 スライドショー / §6 メニュー）**
- 専用ウィンドウ起動: Task 1（`start_slideshow` + `WebviewWindowBuilder`）/ Task 9（起動ボタン）。
- 対象＝フィルタ＆ソート済みリストのスナップショット: Task 9 が `results` のパス配列を渡し、Task 1 が `SlideshowState` に保管、Task 8 がマウント時に取得。
- 選択画像から/なければ先頭: Task 9（`start`）+ Task 8（`start_index` 反映）。
- 待ち時間（秒・既定5）/ ループ / ランダム（重複なしシャッフル）/ 先読み: Task 6（順序・送り）+ Task 8（タイマー・プリロード・設定永続化）。
- 操作 ←/→/Space/Esc: Task 8 キーボード。
- 表示メニュー ▸ スライドショー（ウィンドウ全体/フルスクリーン・チェック式）: Task 2（メニュー）+ Task 8（連携・`setFullscreen`）+ Task 5（`syncSlideshowMenu`）。
- アスペクト比維持・黒背景: Task 8 CSS（`object-fit: contain` / `background:#000`）。
- 欠落/切断は自動スキップ＋通知、再生継続: Task 8 `onImgError`。
- 設定 settings 永続化: Task 8（`slideshow_interval/loop/random`、既存 `set_setting`）。

**2. Placeholder scan:** 各コード手順は完全なコードを掲載済み。「適切に処理」等の曖昧表現なし。

**3. Type consistency:**
- 関数名: `startSlideshow`/`getSlideshowPayload`/`syncSlideshowMenu`（api）、`start_slideshow`/`get_slideshow_payload`/`sync_slideshow_menu`（Rust command）、`set_payload`/`get_payload`/`SlideshowState`/`SlideshowPayload`（Rust）、`mulberry32`/`buildOrder`/`step`/`StepResult`（util）— Task 間で一致。
- ペイロードのフィールド名 `start_index`（Rust serde 出力）↔ フロント `SlideshowPayload.start_index`（Task 5）↔ `start_slideshow` の JS 引数 `startIndex`→Rust `start_index`（Tauri 自動変換）で整合。
- `step(pos, length, loop, delta)` の戻り `{ pos, wrapped, stop }` を Task 8 の `advance` が参照、ループ折返し時の再シャッフルは `wrapped && random && delta===1` で発火 — 一貫。

---

## 実行方法

このプランは subagent-driven-development（推奨）または executing-plans で、タスク単位に実装する。各バックエンドタスクは `cargo test` / `cargo build`、各フロントタスクは `npx vitest run` / `npm run build` で検証し、頻繁にコミットする。GUI 挙動（Task 11）はヘッドレス不可のため最後に手動スモークする。
```
