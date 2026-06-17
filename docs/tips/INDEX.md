# 技術知見 Tips インデックス

このディレクトリは gen-img-manager の開発を通じて得た、**非自明なトラブル・設計判断・落とし穴**をまとめたものです。基本的な内容は含めず、発生した問題・解決策・その理由に絞っています。

---

## TypeScript / React

| ファイル | 概要 |
|----------|------|
| [ts-01-keyboard-shortcut-exact-modifier.md](ts-01-keyboard-shortcut-exact-modifier.md) | ショートカット判定は修飾キーを**完全一致**で確認する。緩い判定は `Cmd+A` が `Cmd+Shift+A` を奪う競合を起こす |
| [ts-02-ime-enter-detection.md](ts-02-ime-enter-detection.md) | `isComposing` と `keyCode 229` の両方で IME 確定 Enter を除外する。WKWebView での考慮も必要 |
| [ts-03-immutable-set-operations.md](ts-03-immutable-set-operations.md) | Zustand の Set 状態は非破壊コピーで操作する。破壊操作は再レンダリングが起きない |
| [ts-04-react-remount-prevention.md](ts-04-react-remount-prevention.md) | 早期 return で `ref` 付き要素のツリー位置が変わると再マウントが起き ResizeObserver が切れる（グリッドが真っ白になる問題） |
| [ts-05-query-tokenizer-parity.md](ts-05-query-tokenizer-parity.md) | フロント/バックエンドのトークナイザを同一仕様で実装し、クエリ文字列の往復を保証する |

---

## Tauri

| ファイル | 概要 |
|----------|------|
| [tauri-01-single-bundle-two-windows.md](tauri-01-single-bundle-two-windows.md) | `window.location.hash` で単一バンドルから 2 ウィンドウを出し分け、管理状態をスナップショットバッファとしてウィンドウ間通信する |
| [tauri-02-menu-state-sync.md](tauri-02-menu-state-sync.md) | ネイティブメニューのチェック状態はフロントが正。変更時に `sync_*` コマンドで Rust へ通知し、操作は `"menu-action"` イベントでフロントへ |
| [tauri-03-asset-protocol-scope.md](tauri-03-asset-protocol-scope.md) | ローカル画像表示に asset protocol を使い、setup でディレクトリを許可する。動的追加時も同様に登録が必要 |
| [tauri-04-hidpi-window-geometry.md](tauri-04-hidpi-window-geometry.md) | `tauri-plugin-window-state` は物理ピクセルで保存して HiDPI でサイズが 2 倍になる問題。位置・サイズは論理ポイントで自前管理する |
| [tauri-05-plugin-registration-order.md](tauri-05-plugin-registration-order.md) | `on_window_ready` を持つプラグインは `setup` 内でなく Builder チェーンで登録する（初期ウィンドウの生成が `setup` より先） |

---

## Rust / SQLite

| ファイル | 概要 |
|----------|------|
| [rust-01-sqlite-migration-user-version.md](rust-01-sqlite-migration-user-version.md) | `PRAGMA user_version` と `&[&str]` 配列インデックスを対応させるマイグレーション管理。追記のみ・並び替え禁止 |
| [rust-02-fts5-content-table-triggers.md](rust-02-fts5-content-table-triggers.md) | FTS5 コンテンツテーブルと INSERT/UPDATE/DELETE トリガーで全文検索インデックスを自動同期する |
| [rust-03-sql-injection-prevention.md](rust-03-sql-injection-prevention.md) | 列名は `&'static str` 許可リストのみ、値は必ずバインドパラメータ。LIKE のワイルドカードもエスケープ |
| [rust-04-offline-drive-timeout.md](rust-04-offline-drive-timeout.md) | 切断ネットワークドライブで `exists()` が永久ブロックする問題を別スレッド + タイムアウトで回避（意図的なスレッドリーク） |
| [rust-05-fts5-syntax-validation.md](rust-05-fts5-syntax-validation.md) | FTS5 MATCH 式の構文を渡す前に検証し、不正な場合は 1 フレーズに縮退させる（グレースフルデグラデーション） |
| [rust-06-thumbnail-hash-filename.md](rust-06-thumbnail-hash-filename.md) | サムネイルのファイル名に FNV-1a 64bit ハッシュを使う。WebP エンコード前に必ず RGBA8 に正規化する |
| [rust-07-query-dsl-design.md](rust-07-query-dsl-design.md) | 2段階コンパイル（パース → 中間表現 → SQL WHERE）でテスト・セキュリティ管理・拡張を分離する |
| [rust-08-wkwebview-event-loop.md](rust-08-wkwebview-event-loop.md) | WKWebView で `setInterval` が run loop から外れて UI が固まる問題。`requestAnimationFrame` 駆動タイマーで解決 |
| [rust-09-bayesian-tag-rating.md](rust-09-bayesian-tag-rating.md) | 少数サンプルのタグ評価をベイズ平滑化で安定化。SQLite ビュー + パラメータテーブルで動的調整 |

---

## カテゴリ別クロスリファレンス

### セキュリティ
- [rust-03-sql-injection-prevention.md](rust-03-sql-injection-prevention.md) — SQL インジェクション対策
- [rust-05-fts5-syntax-validation.md](rust-05-fts5-syntax-validation.md) — FTS5 構文エラー回避

### 非同期・タイムアウト
- [rust-04-offline-drive-timeout.md](rust-04-offline-drive-timeout.md) — スレッド + タイムアウト
- [rust-08-wkwebview-event-loop.md](rust-08-wkwebview-event-loop.md) — rAF 駆動タイマー

### プラットフォーム固有（macOS）
- [tauri-04-hidpi-window-geometry.md](tauri-04-hidpi-window-geometry.md) — HiDPI 論理ポイント
- [rust-08-wkwebview-event-loop.md](rust-08-wkwebview-event-loop.md) — WKWebView の挙動
- [ts-01-keyboard-shortcut-exact-modifier.md](ts-01-keyboard-shortcut-exact-modifier.md) — Option+Command の e.code

### DOM/React の罠
- [ts-04-react-remount-prevention.md](ts-04-react-remount-prevention.md) — 早期 return による再マウント
- [ts-03-immutable-set-operations.md](ts-03-immutable-set-operations.md) — Zustand の Set

### テスタビリティ
- [ts-03-immutable-set-operations.md](ts-03-immutable-set-operations.md) — 純粋関数化
- [rust-07-query-dsl-design.md](rust-07-query-dsl-design.md) — 中間表現分離
- [tauri-01-single-bundle-two-windows.md](tauri-01-single-bundle-two-windows.md) — コマンドとロジックの分離
