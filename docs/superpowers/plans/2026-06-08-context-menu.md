# 右クリックコンテキストメニュー + Finderで表示 + パスコピー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グリッドのサムネイル右クリックでコンテキストメニュー（ビューアで開く・スライドショー開始・Finderで表示・パスをコピー）を表示し、グリッドとビューア両方に O/C キーボードショートカットを追加する。

**Architecture:** カスタム React Portal ベースの `ContextMenu` コンポーネントと `useContextMenu` フックで状態管理。Rust 側に `reveal_in_finder` コマンドを追加（macOS: `open -R`、Windows: `explorer /select,`）。パスコピーは `navigator.clipboard.writeText` を使用。

**Tech Stack:** Rust / Tauri 2 / React 19 / TypeScript / Zustand / @testing-library/react / Vitest

---

## 既存実装の前提（壊さないこと）

- `ImageGridPanel.tsx` の keydown switch（`0-5`, `Enter`, `Home`/`End` 等）は維持。
- `ImageViewer.tsx` の keydown switch（`z`/`Z`, `i`/`I`, `0-5`, `F11` 等）は維持。
- `src/api/images.ts` の既存エクスポート（`queryImages`, `countQuery`, `getImageDetail`, `setRating`）は維持。
- グリッドの右クリックは選択状態を変えない。`selectedIndex < 0` なら何もしない。
- `startSlideshow(paths: string[], startIndex: number)` は `src/api/slideshow.ts` に存在する。

## ファイル構成

| ファイル | 操作 |
|---|---|
| `src-tauri/src/commands/fs.rs` | 新規: `reveal_in_finder` コマンド |
| `src-tauri/src/commands/mod.rs` | 変更: `pub mod fs;` 追加 |
| `src-tauri/src/lib.rs` | 変更: コマンド登録 |
| `src/api/images.ts` | 変更: `revealInFinder` ラッパー追加 |
| `src/hooks/useContextMenu.ts` | 新規: 開閉状態フック |
| `src/hooks/useContextMenu.test.ts` | 新規: フックのテスト |
| `src/components/ContextMenu.tsx` | 新規: Portal コンポーネント |
| `src/components/ImageGridPanel.tsx` | 変更: 右クリックメニュー + O/C キー |
| `src/components/ImageViewer.tsx` | 変更: O/C キー追加 |
| `src/components/HelpOverlay.tsx` | 変更: 新キー追記 |
| `src/App.css` | 変更: コンテキストメニューのスタイル |

---

## Task 1: Rust — `reveal_in_finder` コマンド

**Files:**
- Create: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: `fs.rs` を作成**

`src-tauri/src/commands/fs.rs` を新規作成:

```rust
/// 指定パスをOSのファイルマネージャで開き、ファイルを選択状態にする。
/// macOS: open -R <path>  / Windows: explorer /select,<path>
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: `mod.rs` にモジュールを追加**

`src-tauri/src/commands/mod.rs` の末尾に追加:

```rust
pub mod fs;
```

- [ ] **Step 3: `lib.rs` にコマンドを登録**

`src-tauri/src/lib.rs` の `invoke_handler!` リスト内、`commands::slideshow::get_slideshow_payload,` の行の下に追加:

```rust
            commands::fs::reveal_in_finder,
```

- [ ] **Step 4: ビルドして確認**

Run: `cd src-tauri && cargo build`
Expected: コンパイル成功（警告なし）

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): reveal_in_finder tauri command"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 2: Frontend — `revealInFinder` API ラッパー

**Files:**
- Modify: `src/api/images.ts`

- [ ] **Step 1: `revealInFinder` を追加**

`src/api/images.ts` の末尾に追加:

```ts
export const revealInFinder = (path: string) =>
  invoke<void>("reveal_in_finder", { path });
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/api/images.ts
git commit -m "feat(api): revealInFinder invoke wrapper"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 3: `useContextMenu` フック（TDD）

**Files:**
- Create: `src/hooks/useContextMenu.ts`
- Create: `src/hooks/useContextMenu.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/hooks/useContextMenu.test.ts` を新規作成:

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContextMenu } from "./useContextMenu";

describe("useContextMenu", () => {
  it("starts closed with no imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.menuState.open).toBe(false);
    expect(result.current.menuState.imageId).toBeNull();
  });

  it("showMenu opens with given position and imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => {
      result.current.showMenu(100, 200, 42);
    });
    expect(result.current.menuState).toEqual({ open: true, x: 100, y: 200, imageId: 42 });
  });

  it("closeMenu sets open to false while preserving imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => {
      result.current.showMenu(100, 200, 42);
    });
    act(() => {
      result.current.closeMenu();
    });
    expect(result.current.menuState.open).toBe(false);
    expect(result.current.menuState.imageId).toBe(42);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/hooks/useContextMenu.test.ts`
Expected: FAIL（モジュール解決エラー）

- [ ] **Step 3: フックを実装**

`src/hooks/useContextMenu.ts` を新規作成:

```ts
import { useState } from "react";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  imageId: number | null;
}

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    imageId: null,
  });

  const showMenu = (x: number, y: number, imageId: number) =>
    setMenuState({ open: true, x, y, imageId });

  const closeMenu = () => setMenuState((s) => ({ ...s, open: false }));

  return { menuState, showMenu, closeMenu };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/hooks/useContextMenu.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: 全テストと型チェック**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add src/hooks/useContextMenu.ts src/hooks/useContextMenu.test.ts
git commit -m "feat(hooks): useContextMenu hook with open/close/position state"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 4: `ContextMenu` コンポーネント + CSS

**Files:**
- Create: `src/components/ContextMenu.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: `ContextMenu.tsx` を作成**

`src/components/ContextMenu.tsx` を新規作成:

```tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
}

export type MenuEntry = MenuItem | { separator: true };

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

const MENU_W = 200;
const MENU_H = 160;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLUListElement>(null);

  const left = x + MENU_W > window.innerWidth ? x - MENU_W : x;
  const top = y + MENU_H > window.innerHeight ? y - MENU_H : y;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <ul ref={ref} className="context-menu" style={{ left, top }} role="menu">
      {items.map((item, i) => {
        if ("separator" in item) {
          return <li key={i} className="context-menu-separator" role="separator" />;
        }
        return (
          <li key={i} role="menuitem">
            <button onClick={item.onClick}>
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}
```

- [ ] **Step 2: `App.css` にスタイルを追加**

`src/App.css` の末尾に追加:

```css
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 180px;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  font-size: 13px;
}
.context-menu li {
  padding: 0;
}
.context-menu li button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 12px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  gap: 16px;
}
.context-menu li button:hover {
  background: #0066cc;
  color: #fff;
}
.context-menu li button kbd {
  font-size: 11px;
  opacity: 0.7;
  font-family: ui-monospace, monospace;
}
.context-menu-separator {
  height: 1px;
  background: #e0e0e0;
  margin: 4px 0;
}
```

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 4: コミット**

```bash
git add src/components/ContextMenu.tsx src/App.css
git commit -m "feat(ui): ContextMenu portal component and styles"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 5: グリッドへの統合（右クリックメニュー + O/C キー）

**Files:**
- Modify: `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: import を追加**

`src/components/ImageGridPanel.tsx` の先頭 import 群（6行目 `moveIndex` の import の下）に追加:

```ts
import { ContextMenu } from "./ContextMenu";
import type { MenuEntry } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
import { revealInFinder } from "../api/images";
import { startSlideshow } from "../api/slideshow";
```

- [ ] **Step 2: `useContextMenu` フックを追加**

コンポーネント内（16行目 `const setRating = ...` の下）に追加:

```ts
  const { menuState, showMenu, closeMenu } = useContextMenu();
```

- [ ] **Step 3: keydown switch に O/C を追加**

keydown switch の `case "Enter":` ブロック（120-124行）の直前に挿入:

```ts
        case "o":
        case "O": {
          e.preventDefault();
          const target = results[cur];
          if (target) {
            void revealInFinder(target.path).catch((e) =>
              console.error("Finderで表示に失敗しました:", e),
            );
          }
          return;
        }
        case "c":
        case "C": {
          e.preventDefault();
          const target = results[cur];
          if (target) {
            void navigator.clipboard
              .writeText(target.path)
              .catch((e) => console.error("パスのコピーに失敗しました:", e));
          }
          return;
        }
```

- [ ] **Step 4: keydown useEffect の依存配列を更新**

現在の依存配列（135行）:
```ts
  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer, setRating]);
```
を次に変更（`closeMenu` は安定な setState ラッパーだが、明示的に追加する）:

```ts
  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer, setRating, closeMenu]);
```

- [ ] **Step 5: `onContextMenu` ハンドラをグリッドコンテナに追加**

150行目の `<div className="image-grid" ref={parentRef} tabIndex={0}>` を次に置き換える:

```tsx
      <div
        className="image-grid"
        ref={parentRef}
        tabIndex={0}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selectedIndex < 0 || !results[selectedIndex]) return;
          showMenu(e.clientX, e.clientY, results[selectedIndex].id);
        }}
      >
```

- [ ] **Step 6: `ContextMenu` を描画する**

`return (` の後に `<>` と `</>` を追加して Fragment で包み、グリッドの閉じタグ `</div>` の後に `<ContextMenu>` を追加する。変更前:

```tsx
  return (
    <div
      className="image-grid"
      ...
    >
      ...
    </div>
  );
```

変更後:

```tsx
  return (
    <>
      <div
        className="image-grid"
        ...
      >
        ...
      </div>
      {menuState.open && results[selectedIndex] && (() => {
        const target = results[selectedIndex];
        const items: MenuEntry[] = [
          {
            label: "ビューアで開く",
            onClick: () => {
              openViewer(selectedIndex);
              closeMenu();
            },
          },
          {
            label: "スライドショー開始",
            onClick: () => {
              void startSlideshow(results.map((r) => r.path), selectedIndex).catch(
                (e) => console.error("スライドショー起動に失敗しました:", e),
              );
              closeMenu();
            },
          },
          { separator: true as const },
          {
            label: "Finderで表示",
            shortcut: "O",
            onClick: () => {
              void revealInFinder(target.path).catch((e) =>
                console.error("Finderで表示に失敗しました:", e),
              );
              closeMenu();
            },
          },
          {
            label: "パスをコピー",
            shortcut: "C",
            onClick: () => {
              void navigator.clipboard
                .writeText(target.path)
                .catch((e) => console.error("パスのコピーに失敗しました:", e));
              closeMenu();
            },
          },
        ];
        return (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            items={items}
          />
        );
      })()}
    </>
  );
```

- [ ] **Step 7: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 8: 手動確認**

Run: `npm run tauri dev`
確認:
1. サムネイルを選択してから右クリック → メニューが4項目（セパレータ含む）表示される
2. 「ビューアで開く」→ビューアが開く
3. 「スライドショー開始」→ スライドショーウィンドウが開く
4. 「Finderで表示」→ Finder が開いてファイルが選択状態になる
5. 「パスをコピー」→ クリップボードにフルパスがコピーされる（ターミナルで `pbpaste` で確認）
6. `O` キー → Finder が開く
7. `C` キー → パスがコピーされる
8. 選択なしで右クリック → メニューが出ない
9. メニュー外クリック / Esc でメニューが閉じる

- [ ] **Step 9: コミット**

```bash
git add src/components/ImageGridPanel.tsx
git commit -m "feat(grid): context menu with viewer/slideshow/finder/copy + O/C shortcuts"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 6: ビューアへの統合（O/C キー）

**Files:**
- Modify: `src/components/ImageViewer.tsx`

- [ ] **Step 1: `revealInFinder` を import に追加**

6行目の import を変更する。変更前:

```ts
import { getImageDetail } from "../api/images";
```

変更後:

```ts
import { getImageDetail, revealInFinder } from "../api/images";
```

- [ ] **Step 2: keydown switch に O/C を追加**

`case "5":` ブロック（156-159行）の後（`default:` の前）に追加:

```ts
        case "o":
        case "O":
          e.preventDefault();
          if (image) {
            void revealInFinder(image.path).catch((e) =>
              console.error("Finderで表示に失敗しました:", e),
            );
          }
          break;
        case "c":
        case "C":
          e.preventDefault();
          if (image) {
            void navigator.clipboard
              .writeText(image.path)
              .catch((e) => console.error("パスのコピーに失敗しました:", e));
          }
          break;
```

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 4: 手動確認**

Run: `npm run tauri dev`
確認:
1. ビューアを開いて `O` → Finder が開き、表示中の画像ファイルが選択状態になる
2. ビューアを開いて `C` → クリップボードにフルパスがコピーされる（`pbpaste` で確認）

- [ ] **Step 5: コミット**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat(viewer): O to reveal in Finder, C to copy path"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Task 7: HelpOverlay 更新

**Files:**
- Modify: `src/components/HelpOverlay.tsx`

- [ ] **Step 1: 新キーを追記**

`src/components/HelpOverlay.tsx` の `SECTIONS` 配列を更新する。

「一覧（グリッド）」セクション（`rows` 配列末尾の `{ keys: "0 - 5", ... }` の後）に追加:

```ts
      { keys: "O", desc: "Finderで表示" },
      { keys: "C", desc: "パスをコピー" },
```

「ビューア」セクション（`{ keys: "0 - 5", ... }` の後、`{ keys: "Enter", ... }` の前）に追加:

```ts
      { keys: "O", desc: "Finderで表示" },
      { keys: "C", desc: "パスをコピー" },
```

- [ ] **Step 2: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全 PASS

- [ ] **Step 3: コミット**

```bash
git add src/components/HelpOverlay.tsx
git commit -m "docs(help): add O/C shortcut entries to help overlay"
```
末尾に `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## 完了確認（全タスク後）

- [ ] **全テスト・型チェック・ビルド**

Run: `cd src-tauri && cargo test && cd .. && npx tsc --noEmit && npx vitest run && npm run build`
Expected: cargo テスト・フロントテスト・型チェック・ビルドすべて成功

- [ ] **総合手動確認**

Run: `npm run tauri dev`

1. グリッドで画像を選択して右クリック → メニュー4項目表示（セパレータ含む）
2. 「ビューアで開く」→ ビューア起動
3. 「スライドショー開始」→ スライドショーウィンドウ起動
4. 「Finderで表示」→ Finder が開き対象ファイルが選択状態
5. 「パスをコピー」→ pbpaste でフルパス確認
6. グリッドで `O` → Finder 表示、`C` → パスコピー
7. ビューアで `O` → Finder 表示、`C` → パスコピー
8. 選択なし右クリック → メニュー不表示
9. `?` でヘルプを開き、グリッド・ビューアセクションに O/C が表示されている

---

## Self-Review

**1. Spec coverage:**
- コンテキストメニュー（グリッド右クリック）: Task 5 ✅
- 「ビューアで開く」: Task 5 ✅
- 「スライドショー開始」: Task 5 ✅
- 「Finderで表示」: Task 1（Rust）+ Task 2（API）+ Task 5（グリッド）+ Task 6（ビューア）✅
- 「パスをコピー」: Task 5 + Task 6 ✅
- O/C キー（グリッド）: Task 5 ✅
- O/C キー（ビューア）: Task 6 ✅
- ヘルプ更新: Task 7 ✅
- 右クリックで選択変更しない: Task 5 の `onContextMenu` ハンドラが `selectedIndex` を読むのみ ✅
- 選択なしでメニュー不表示: Task 5 の `selectedIndex < 0` チェック ✅
- 画面端補正: `ContextMenu.tsx` の left/top 計算 ✅

**2. Placeholder scan:** TBD・TODO なし。全ステップにコードあり。

**3. Type consistency:**
- `MenuEntry = MenuItem | { separator: true }` → ContextMenu.tsx で定義、ImageGridPanel で `MenuEntry[]` として使用 ✅
- `showMenu(x: number, y: number, imageId: number)` → フック定義と呼び出し側で一致 ✅
- `revealInFinder(path: string)` → Rust コマンド `reveal_in_finder(path: String)` と invoke ラッパーで一致 ✅
- `startSlideshow(paths: string[], startIndex: number)` → 既存 API と一致 ✅
