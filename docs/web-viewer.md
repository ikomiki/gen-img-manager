# Web ビューア（gim-server）

LAN 内の別マシンやスマートフォンのブラウザから、デスクトップ版が管理する画像ライブラリを閲覧するための機能です。`crates/server`（バイナリクレート `gim-server`）が単一バイナリで HTTP サーバとフロントエンドを配信します。

エンドユーザー向けの操作方法は **[web-viewer-usage.html](./web-viewer-usage.html)** を参照してください。このドキュメントは実装・起動・セキュリティモデルについての技術的な概要です。

## できること

- 検索 DSL による絞り込み・並び替え・ディレクトリ選択
- 全画面ビューア（ピンチズーム・パン・スワイプ送り・フルスクリーン）
- スライドショー（間隔・ループ・シャッフル、検索結果全体が対象）

デスクトップ版のみの機能（詳細メタデータ表示・レーティング設定・ディレクトリのスキャン登録・タグ分析）はありません。**読み取り専用**です。

## 起動方法

```bash
pnpm -C web build                    # フロントをビルド（gim-server に同梱される）
cargo run -p gim-server -- --port 5180
```

配布用バイナリをビルドする場合は `cargo build --release -p gim-server` を使います。`web/dist` が無い状態でビルドすると `build.rs` が案内文だけのプレースホルダ `index.html` を生成してコンパイルを通すため、実際にフロントを配信するには事前に `pnpm -C web build` が必要です。

サーバは起動時にデスクトップ版が作成した `library.db` を `open_read_only` で開けるか検証します。開けない場合は「デスクトップ版を一度起動してから、もう一度実行してください」と表示して終了します（サーバ自身はマイグレーションを実行しません）。

### コマンドラインオプション

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `--host` | `0.0.0.0` | 待受アドレス |
| `--port` | `5180` | 待受ポート |
| `--data-dir` | `~/Library/Application Support/com.technonet.genimgmanager` | `library.db` と `thumbnails/` を含むディレクトリ |
| `--allow-host` | なし（複数回指定可） | DNS リバインディング対策で追加許可するホスト名 |

## アーキテクチャ

- **サーバ**（`crates/server/src/`）: axum 製。`gim-core`（`crates/core`）を読み取り専用で使い、`library.db` には一切書き込みません。
- **フロントエンド**（`web/`）: 独立した npm パッケージ `@gim/web`（Vite + React 19 + zustand）。デスクトップ版と `packages/shared`（`@gim/shared`）の純粋関数・型を共有します。
- ビルド成果物 `web/dist` は `rust-embed` により `gim-server` バイナリへ同梱され（`webui.rs`）、`/api/*` 以外のパスは SPA として `index.html` にフォールバックします。

### API（`/api` 配下）

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/directories` | 登録ディレクトリ一覧 |
| GET | `/api/images` | 画像一覧（検索・並び替え） |
| GET | `/api/images/count` | 検索結果件数 |
| GET | `/api/images/ids` | 検索結果の ID 列（スライドショーの再生順に使用） |
| GET | `/api/thumb/{id}` | サムネイル画像 |
| GET | `/api/image/{id}` | リサイズ済み原画像 |

すべて GET のみで、書き込み系エンドポイントはありません。未知のパスや許可されていない Host・メソッドは JSON 形式のエラー（404 / 403 / 405）を返します。

## セキュリティモデル

- **認証はありません**。LAN 内での利用を前提としており、インターネットへの直接公開は非推奨です。
- **DNS リバインディング対策**（`hostcheck.rs`）: `Host` ヘッダが IP リテラル・`localhost`・`.local` 終端・`--allow-host` 許可リストのいずれでもない場合は 403 で拒否します。社内 DNS 名などでアクセスしたい場合は起動時に `--allow-host <名前>` を指定します。
- エラー応答に絶対パスやシステムエラー文が漏れないよう整形しています。

## キャッシュ

リサイズ済み画像は `<data_dir>/web-cache/` に生成されます。起動時に `resize::sweep_on_startup` が古いキャッシュを掃除し、ディレクトリが無ければ作成します。フルデコード＋Lanczos3 リサイズはコア数に応じた同時実行数の上限（`AppState::resize_slots`）で絞り、認証なしで LAN に公開しても並列リクエストだけで全コア・メモリを使い切らないようにしています。

## 関連ドキュメント

- [web-viewer-usage.html](./web-viewer-usage.html) — エンドユーザー向け使い方（起動・操作・検索・スライドショー・トラブルシューティング）
- [../CLAUDE.md](../CLAUDE.md) — リポジトリ全体のアーキテクチャ概要
