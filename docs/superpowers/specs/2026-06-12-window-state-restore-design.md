# ウィンドウ位置・サイズの復元（メインウィンドウ）設計

- 日付: 2026-06-12
- 対象: メインウィンドウ（label `main`）の位置・サイズ・最大化・フルスクリーン状態の保存と復元
- 方針: 公式プラグイン `tauri-plugin-window-state`（v2）を導入

## 目的・要件

- メインウィンドウの **位置・サイズ・最大化・フルスクリーン状態** を終了時に保存し、次回起動時に復元する。
- スライドショーウィンドウ（label `slideshow`）は対象外（フルスクリーン運用のため、毎回固定の初期状態で開く）。
- macOS のベストプラクティスに沿う：起動時にウィンドウが画面外に開かないようモニタ可視領域へクランプする（プラグインが標準で実施）。

## アーキテクチャ / コンポーネント

公式プラグイン **`tauri-plugin-window-state`**（v2）を導入する。状態の保存・復元はプラグインが Rust 側で自動実行するため、フロント（JS）からの呼び出しは行わない（`@tauri-apps/plugin-window-state` の npm 導入は不要）。

変更は Rust／設定ファイルのみで、フロント（`src/`）は変更しない。

### 1. `src-tauri/Cargo.toml`

デスクトップ向けターゲット限定で依存を追加する。

```bash
cargo add tauri-plugin-window-state --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
```

- `Cargo.lock` も併せて更新される。
- これはアプリのバージョン（`version` フィールド）の変更ではなく、新規依存の追加なので、`npm run bump` による4ファイル一括更新は不要。

### 2. `src-tauri/src/lib.rs`

`setup` クロージャ内でプラグインを登録する（公式ドキュメント準拠）。`#[cfg(desktop)]` でガードする。

```rust
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
```

- `with_state_flags(...)`：要件どおり「位置・サイズ・最大化・フルスクリーン」のみを対象とし、`VISIBLE` / `DECORATIONS` は除外する。
- `with_denylist(&["slideshow"])`：スライドショーウィンドウを保存・復元の対象から除外する。
- 登録位置は、既存の DB 初期化・メニュー構築などと並ぶ `setup` 内とする（実際の挿入箇所は実装時に確定。`use` の追加方法も含め周囲のスタイルに合わせる）。

### 3. `src-tauri/capabilities/default.json`

`permissions` に `"window-state:default"` を追加する（公式手順準拠）。自動保存・復元のみであれば必須ではないが、ドキュメント推奨に従い追加する。`windows` は `"main"` のまま（変更不要）。

## データフロー

- **アプリ終了時**：プラグインが `main` の現在の位置・サイズ・最大化・フルスクリーン状態を app config dir の `.window-state.json`（プラグインの `DEFAULT_FILENAME`）へ保存する。
- **アプリ起動時**：プラグインが `.window-state.json` を読み、`main` ウィンドウへ適用する。保存位置が画面外の場合は可視領域へクランプする。`slideshow` は denylist により無視される。
- **初回起動（保存ファイル無し）**：プラグインは何もせず、`tauri.conf.json` の既定値（800×600・OS 中央配置）がそのまま使われる。

## エッジケース

- `tauri.conf.json` の `width` / `height` と復元値が競合する場合 → 復元値が後勝ちで上書きされるため問題なし。
- スライドショーは毎回 `slideshow.rs` の `inner_size(1000, 700)` ＋フルスクリーンで開く（従来どおり、本変更の影響を受けない）。
- マルチモニタ構成で前回のモニタが存在しない場合 → プラグインのクランプ処理で可視領域に収まる。

## テスト方針

- このプラグインの挙動はビルトインであり、今回追加する独自ロジック（純粋関数）は無いため、ユニットテストの対象面は実質的に存在しない。新規ロジックを純粋関数へ切り出すという本プロジェクトの方針に照らしても、テスト追加対象は無い。
- 検証は手動で行う：
  1. ウィンドウを移動・リサイズ → 終了 → 再起動で位置・サイズが復元されること。
  2. 最大化して終了 → 再起動で最大化状態が復元されること。
  3. フルスクリーンにして終了 → 再起動でフルスクリーン状態が復元されること。
  4. スライドショーを開閉してもメインウィンドウの復元挙動に影響しないこと、スライドショー自体は従来どおり開くこと。
- 併せて `cargo build --manifest-path src-tauri/Cargo.toml` と `cargo clippy --manifest-path src-tauri/Cargo.toml` が通ることを確認する。

## 参考

- 公式ドキュメント: https://v2.tauri.app/plugin/window-state/
- クレート: `tauri-plugin-window-state`（v2、`Builder` / `StateFlags` / `with_denylist` / `with_state_flags` / `DEFAULT_FILENAME`）
