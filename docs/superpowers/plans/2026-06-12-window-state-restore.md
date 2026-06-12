# ウィンドウ位置・サイズ復元（メインウィンドウ）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メインウィンドウの位置・サイズ・最大化・フルスクリーン状態を、公式プラグイン `tauri-plugin-window-state` で終了時に保存し次回起動時に復元する。

**Architecture:** Tauri 2 のデスクトップ向けに `tauri-plugin-window-state`（v2）を依存追加し、`lib.rs` の `setup` 内で `#[cfg(desktop)]` ガード付きで登録する。`with_state_flags` で対象状態を「位置・サイズ・最大化・フルスクリーン」に限定し、`with_denylist(&["slideshow"])` でスライドショーウィンドウを除外する。保存・復元はプラグインが Rust 側で自動実行するため、フロント（`src/`）の変更は無い。

**Tech Stack:** Rust / Tauri 2 / `tauri-plugin-window-state` v2

> **テスト方針の注記:** 本変更は設定とプラグイン登録のみで、テスト可能な独自の純粋ロジックを追加しない。したがって失敗するユニットテストを書く TDD ステップは存在せず、検証ゲートは `cargo build` / `cargo clippy`（コンパイル・lint 成功）と手動動作確認とする。

**設計ドキュメント:** `docs/superpowers/specs/2026-06-12-window-state-restore-design.md`

---

### Task 1: プラグイン依存を追加する

**Files:**
- Modify: `src-tauri/Cargo.toml`（`[target.'cfg(...)'.dependencies]` セクションが追加される）
- Modify: `src-tauri/Cargo.lock`（自動更新）

- [ ] **Step 1: デスクトップ向けターゲット限定で依存を追加**

`src-tauri` ディレクトリで以下を実行する（`cargo add` が `Cargo.toml` と `Cargo.lock` を更新する）。

```bash
cargo add tauri-plugin-window-state \
  --manifest-path src-tauri/Cargo.toml \
  --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
```

- [ ] **Step 2: 依存が追加されたことを確認**

Run: `grep -n "tauri-plugin-window-state" src-tauri/Cargo.toml`
Expected: `[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]` セクション配下に `tauri-plugin-window-state = "2"`（バージョンはマイナーが付く場合あり）が表示される。

注: アプリのバージョン（`version` フィールド）は変更しない。`npm run bump` は不要（依存追加であってアプリ版更新ではないため）。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build(tauri): tauri-plugin-window-state を依存に追加"
```

---

### Task 2: `lib.rs` でプラグインを登録する

**Files:**
- Modify: `src-tauri/src/lib.rs`（`setup` クロージャ内、`app.manage(view_menu);` の直後・`Ok(())` の直前に追加）

- [ ] **Step 1: setup 内にプラグイン登録を追加**

`src-tauri/src/lib.rs` の `setup` クロージャ末尾、既存の `app.manage(view_menu);` の直後に以下を挿入する。`use` は追加せず、衝突や `#[cfg(desktop)]` 非該当時の未使用警告を避けるためフルパスで記述する。

```rust
            app.manage(view_menu);
            #[cfg(desktop)]
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::POSITION
                            | tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED
                            | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                    )
                    .with_denylist(&["slideshow"])
                    .build(),
            )?;
            Ok(())
```

- `with_state_flags(...)`：要件どおり「位置・サイズ・最大化・フルスクリーン」のみを対象とし、`VISIBLE` / `DECORATIONS` は含めない。
- `with_denylist(&["slideshow"])`：スライドショーウィンドウ（label `slideshow`）を保存・復元対象から除外する。
- `?`：`setup` の戻り値は `Result<(), Box<dyn Error>>` で、`plugin()` の `tauri::Result` を `?` で伝播できる。

- [ ] **Step 2: コンパイルが通ることを確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: エラーなくビルド成功（`Finished` 表示）。`Builder` / `StateFlags` / `with_denylist` / `with_state_flags` が解決できること。

- [ ] **Step 3: lint が通ることを確認**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml`
Expected: 本変更に起因する警告・エラーが無いこと。

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): メインウィンドウの位置・サイズ・最大化・フルスクリーンを保存/復元"
```

---

### Task 3: ケイパビリティに権限を追加する

**Files:**
- Modify: `src-tauri/capabilities/default.json`（`permissions` 配列に追加）

- [ ] **Step 1: `window-state:default` 権限を追加**

`src-tauri/capabilities/default.json` の `permissions` 配列へ `"window-state:default"` を追加する。`windows` は `"main"` のまま変更しない。変更後の内容:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "dialog:default",
    "window-state:default"
  ]
}
```

注: 自動保存・復元のみであれば必須ではないが、公式手順に従い追加する。

- [ ] **Step 2: スキーマ／ビルドが通ることを確認**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: ケイパビリティ検証エラーが無くビルド成功。`window-state:default` が未知の権限として弾かれないこと（プラグイン導入済みのため認識される）。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(window): メインウィンドウのケイパビリティに window-state 権限を追加"
```

---

### Task 4: 手動動作確認

**Files:**
- なし（実機検証のみ）

- [ ] **Step 1: アプリを起動**

Run: `npm run tauri dev`
Expected: メインウィンドウが起動する（初回は `tauri.conf.json` の既定 800×600・中央配置）。

- [ ] **Step 2: 位置・サイズの復元を確認**

ウィンドウを別の位置へ移動し、サイズを変更してからアプリを終了 → 再度 `npm run tauri dev` で起動。
Expected: 前回の位置とサイズが復元される。

- [ ] **Step 3: 最大化の復元を確認**

ウィンドウを最大化して終了 → 再起動。
Expected: 最大化状態が復元される。

- [ ] **Step 4: フルスクリーンの復元を確認**

ウィンドウをフルスクリーンにして終了 → 再起動。
Expected: フルスクリーン状態が復元される。

- [ ] **Step 5: スライドショーが影響を受けないことを確認**

画像を表示しスライドショーを開く → 閉じる → メインウィンドウを移動・終了・再起動。
Expected: スライドショーは従来どおり開き（固定の初期サイズ＋フルスクリーン運用）、その開閉はメインウィンドウの復元挙動に影響しない。

- [ ] **Step 6: 状態ファイルの生成を確認（任意）**

app config dir 配下に `.window-state.json` が生成されていること。
macOS の例: `~/Library/Application Support/com.technonet.genimgmanager/.window-state.json`
Expected: `main` のウィンドウ状態（位置・サイズ・最大化・フルスクリーン）が記録され、`slideshow` は含まれない。

---

## 完了条件

- `cargo build` / `cargo clippy`（`--manifest-path src-tauri/Cargo.toml`）が本変更起因のエラー・警告なく通る。
- メインウィンドウの位置・サイズ・最大化・フルスクリーン状態が再起動後に復元される。
- スライドショーウィンドウは復元対象外で、従来どおりの挙動を保つ。
