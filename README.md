# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## バージョンの更新

アプリのバージョンは `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` の4ファイルに分散しています。必ず以下のコマンドで一括更新してください（個別編集は避ける）。

```bash
npm run bump -- patch     # 例: 0.1.0 -> 0.1.1
npm run bump -- minor     # 例: 0.1.0 -> 0.2.0
npm run bump -- major     # 例: 0.1.0 -> 1.0.0
npm run bump -- 1.2.3     # バージョンを明示指定
npm run bump -- patch --dry-run   # 変更内容のプレビュー（書き込みなし）
```
