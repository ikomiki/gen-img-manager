# 右クリックコンテキストメニュー + ファイルマネージャ連携 設計書

- 日付: 2026-06-08
- 対象: グリッドとビューアへの右クリックコンテキストメニュー追加、OSファイルマネージャ連携、パスコピー

## 1. 目的とスコープ

画像グリッドの右クリックでコンテキストメニューを表示し、「ビューアで開く」「スライドショー開始」「Finderで表示」「パスをコピー」を提供する。グリッドとビューア両方に `O`（Finderで表示）・`C`（パスコピー）キーボードショートカットを追加する。

### スコープ外
- Tauri ネイティブコンテキストメニュープラグインの使用
- グリッド外（ビューア内）での右クリックメニュー表示
- ファイル削除・移動などの破壊的操作

## 2. アーキテクチャ

### 新規ファイル
| ファイル | 役割 |
|---|---|
| `src/components/ContextMenu.tsx` | 汎用コンテキストメニュー（React Portal） |
| `src/hooks/useContextMenu.ts` | メニューの開閉状態を管理するフック |
| `src-tauri/src/commands/fs.rs` | `reveal_in_finder` Tauriコマンド |

### 変更ファイル
| ファイル | 変更内容 |
|---|---|
| `src/api/images.ts` | `revealInFinder(path)` invoke ラッパー追加 |
| `src/components/ImageGridPanel.tsx` | 右クリックメニュー表示 + `O`/`C` キー追加 |
| `src/components/ImageViewer.tsx` | `O`/`C` キー追加 |
| `src/components/HelpOverlay.tsx` | 新キー追記 |
| `src-tauri/src/commands/mod.rs` | `pub mod fs;` 追加 |
| `src-tauri/src/lib.rs` | コマンド登録 |
| `src/App.css` | コンテキストメニューのスタイル追加 |

## 3. コンテキストメニュー仕様

### 表示条件
- グリッドのサムネイル上で右クリックしたとき
- 選択画像がある場合のみ表示（選択なしは `e.preventDefault()` のみ）
- 右クリックによる選択変更は行わない（右クリック前の選択画像に対して作用）

### メニュー項目（グリッド）
```
┌─────────────────────────┐
│ ビューアで開く           │
│ スライドショー開始       │
│ ─────────────────────── │
│ Finderで表示        [O] │
│ パスをコピー        [C] │
└─────────────────────────┘
```

### 閉じる条件
- メニュー外クリック
- `Escape` キー
- 画面スクロール

### 画面端補正
メニューが画面端からはみ出る場合、自動的に反対側に反転して表示する。

## 4. コンポーネント設計

### `useContextMenu.ts`

```ts
interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  imageId: number | null;
}
// 返り値: { menuState, showMenu(x, y, imageId), closeMenu() }
```

### `ContextMenu.tsx`

```ts
interface MenuItem {
  label: string;
  shortcut?: string;  // 右端に表示するキー名 (例: "O")
  onClick: () => void;
  separator?: false;
}
interface Separator {
  separator: true;
}

interface Props {
  x: number;
  y: number;
  items: (MenuItem | Separator)[];
  onClose: () => void;
}
```

- `ReactDOM.createPortal` で `document.body` に描画
- `useEffect` でウィンドウクリック・Escape・スクロールを購読して `onClose` を呼ぶ

## 5. Rustバックエンド

### `src-tauri/src/commands/fs.rs`

```rust
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

- `spawn()` で非同期起動（完了を待たない）
- ファイルが `missing` でも呼び出し可能（OSがエラー表示を担当）
- フロント: `invoke<void>("reveal_in_finder", { path })`

## 6. キーボードショートカット

| キー | 動作 | 対象画面 |
|---|---|---|
| `O` / `o` | Finderで表示（macOS）/ エクスプローラで表示（Windows） | グリッド・ビューア |
| `C` / `c` | 現在の画像のフルパスをクリップボードにコピー | グリッド・ビューア |

### グリッド（`ImageGridPanel.tsx`）
- `results[selectedIndex]` が存在する場合のみ発火
- 検索欄入力中は無効（既存の `activeElement` ガードを流用）
- `setRating` と同様に `keydown` の `useEffect` 依存配列に追加

### ビューア（`ImageViewer.tsx`）
- `image` オブジェクトが存在する場合のみ発火
- `applyRating` と同様のパターンで実装

### パスコピーの実装
```ts
await navigator.clipboard.writeText(image.path);
```
Tauri の WebView では `navigator.clipboard` が使用可能。

## 7. HelpOverlay 更新

「一覧（グリッド）」セクションに追記：
```
O   Finderで表示
C   パスをコピー
```

「ビューア」セクションにも追記：
```
O   Finderで表示
C   パスをコピー
```

## 8. エラー処理

- `reveal_in_finder` が失敗した場合: コンソールエラーのみ（UIへの通知は行わない。OSがエラー表示を担う）
- `navigator.clipboard.writeText` が失敗した場合: コンソールエラーのみ（Tauri WebView 内では通常失敗しない）

## 9. テスト方針

- `useContextMenu`: フックの状態遷移（show/close）を Vitest でテスト
- `reveal_in_finder`: Rust の `cargo test` は `spawn()` の副作用を含むため単体テストは設けず、手動確認で検証
- フロント統合: `npm run tauri dev` での手動確認
