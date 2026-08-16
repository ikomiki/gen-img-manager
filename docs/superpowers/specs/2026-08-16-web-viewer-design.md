# web ビューア 設計

AI生成画像ライブラリを LAN 内のブラウザ（PC / スマホ / タブレット）から閲覧するウェブアプリケーションを追加する。既存の macOS デスクトップ版（Tauri）とソースコードを共有し、デスクトップ版が作成した SQLite ライブラリを読み取り専用で参照する。

## スコープ

対象:

- ビューア（全画面表示・ズーム・前後送り）
- スライドショー（間隔・ループ・シャッフル）
- フィルタリング（クエリ文字列 + GUI フォーム）
- フィルタ履歴
- 並び替え

対象外:

- 詳細メタデータ表示
- レーティング設定
- ディレクトリのスキャン・登録
- タグ分析

## 前提

| 項目 | 決定 |
|---|---|
| 実行形態 | 画像と DB がある Mac 上でサーバを起動し、同一 LAN のブラウザから接続 |
| アクセス制限 | なし（LAN 内は全面許可） |
| データベース | `~/Library/Application Support/com.technonet.genimgmanager/library.db` を読み取り専用で参照 |
| 履歴の保存先 | ブラウザの localStorage（サーバはステートレス） |
| サーバ実装 | Rust + axum、共有クレート経由でデスクトップ版とロジックを共有 |
| フロント共有 | 型と純粋関数のみ共有し、UI は web 専用に実装 |

## リポジトリ構成

既存の `src/` と `src-tauri/` は移動しない。

```
gen-img-manager/
├── Cargo.toml            # [workspace] members = ["src-tauri", "crates/*"]
├── Cargo.lock            # workspace 化によりルートへ移動
├── package.json          # pnpm workspace root 兼 desktop フロント
├── pnpm-workspace.yaml   # packages: ["packages/*", "web"]
├── src/                  # desktop フロント
├── src-tauri/            # Tauri クレート（gim-core に依存）
├── crates/
│   ├── core/             # 共有 Rust: models / query / db
│   └── server/           # axum サーバ（バイナリ名 gim-server）
├── web/                  # web フロント（Vite + React）
└── packages/
    └── shared/           # 共有 TS: 型と純粋関数
```

Cargo workspace のメンバは `src-tauri`・`crates/core`・`crates/server`。`crates/core` と `crates/server` はアプリ版数と無関係なので `version = "0.0.0"` 固定とし、`npm run bump` の対象外とする。

## crates/core

### 境界

core へ移すもの:

- `models.rs`
- `query/`（`mod.rs`・`parse.rs`・`compile.rs`）
- `db/`（`mod.rs`・`migrations.rs`・`images.rs`・`image_query.rs`・`directories.rs`・`settings.rs`・`history.rs`・`tags.rs`・`analysis.rs`）

インラインテストも同時に移す。`cargo test -p gim-core` が緑であることが移設の正しさの担保になる。

`src-tauri` に残すもの: `commands/`・`scanner.rs`・`parser/`・`thumbnail.rs`・`menu.rs`・`backfill.rs`・`fs_guard.rs`・`lib.rs`。移設に伴う変更は `use crate::db::` → `use gim_core::db::` の置換が主。

### マイグレーションの所有者

`migrations.rs` は core に置くが、実行するのはデスクトップ版だけとする。サーバは起動時に `PRAGMA user_version` を読み、期待値と一致しなければ「デスクトップ版を先に起動してください」と表示して終了する。スキーマを進める主体を1つに保つため。

### DirScope

`db::image_query::query_images` と `count_query` は現在、対象ディレクトリを `AND directory_id IN (SELECT id FROM directories WHERE visible = 1)` と SQL に直書きしている。web 版は任意のディレクトリ集合で絞るため、これを引数化する。

```rust
pub enum DirScope {
    Visible,
    Ids(Vec<i64>),
}
```

`Ids` の値もバインドパラメータで束縛し、列名は許可リストの `&'static str` のみという既存方針を維持する。デスクトップ側の呼び出しは `DirScope::Visible` を渡す。

### 読み取り専用接続

`OpenFlags::SQLITE_OPEN_READ_ONLY` で開き、`PRAGMA query_only = ON` を重ねる。WAL データベースを読み取り専用で開く場合、SQLite は共有メモリインデックス（`library.db-shm`）を必要とするため、DB と同じディレクトリへの書き込み権限は要る。テーブルには一切書かないが `-wal` / `-shm` は触る、という意味の読み取り専用である。

`immutable=1` は使わない。デスクトップ版が同時に書き込んだ場合に不整合を読むため。

接続プールは持たず、リクエストごとに開いて閉じる。デスクトップ版によるスキーマ変更に次のリクエストから追随でき、長時間の読み取りトランザクションによる WAL 肥大も避けられる。

## crates/server

### 起動

```
gim-server [--host 0.0.0.0] [--port 5180] [--data-dir <path>]
```

`--data-dir` の既定値は `~/Library/Application Support/com.technonet.genimgmanager`。ここから `library.db`・`thumbnails/`・`web-cache/` を導く。起動時に DB を検証し、LAN 側の待受アドレスを標準出力に表示する（`http://192.168.x.x:5180 で待受中`）。

web フロントは `rust-embed` でバイナリに埋め込む。`crates/server/build.rs` が `web/dist` の存在を確認し、無ければ「先に `npm run build -w web` を実行してください」と表示して失敗する。

### API

すべて `GET`。書き込み系エンドポイントは存在しない。

| エンドポイント | 返すもの |
|---|---|
| `GET /api/directories` | `Directory[]`（`visible` を含む。初期選択の判断はクライアント側） |
| `GET /api/images?q&sort&dir&limit&offset&dirs` | `ImageRow[]` |
| `GET /api/images/count?q&dirs` | `{ total: number }` |
| `GET /api/images/ids?q&sort&dir&dirs` | `number[]`（スライドショーの再生順序用） |
| `GET /api/thumb/:id` | 既存 `thumb_path` の WebP をそのまま |
| `GET /api/image/:id?w=1280` | リサイズ版 WebP。`w` 省略時は原画像 |
| `GET /api/health` | `{ schema_version, image_count }` |

`dirs` はディレクトリ ID のカンマ区切り。省略時は `visible = 1` のものを意味する。

`/api/images/ids` を分けているのは、スライドショーが検索結果全体を再生対象にする一方、数万件の `ImageRow` をモバイルへ送るのが無駄なため。表示は `/api/image/:id` で引けるので ID 配列だけあればよい。

### リサイズとキャッシュ

`crates/server/src/resize.rs` が担当する。

- アスペクト比を保った長辺基準の縮小のみ。原画像より `w` が大きい場合は原画像を返す
- 出力は WebP 品質 82
- `w` は `640 / 1280 / 1920 / 2560` の許可リストへスナップする。任意の値を受け付けるとキャッシュが際限なく増えるため
- キャッシュキーは `FNV-1a(元パス + mtime + w)` の hex + `.webp`。mtime を含むので画像の差し替えで自然に無効化される
- 生成は一時ファイルへ書いてから `rename` する。同一画像への同時リクエストが競合しても壊れない
- 容量は起動時に測り、上限（既定 2GB）超過時はアクセス時刻の古い順に削除する

クライアントは `min(viewport幅 × devicePixelRatio, 2560)` から `w` を選ぶ。

サムネイルとリサイズ版には `ETag`（キャッシュキー）と `Cache-Control: public, max-age=31536000, immutable` を付ける。キーが内容で決まるため永続キャッシュして安全で、スライドショーの往復と再訪がほぼ無通信になる。`w` 省略時の原画像も同様に扱い、`ETag` は `FNV-1a(元パス + mtime)` とする。

### エラー処理

画像パスは DB 由来でユーザ入力ではないため、パストラバーサルの余地はない。

ファイルアクセスは `spawn_blocking` + 3秒タイムアウトで包む。オフラインの外部ドライブ上のパスで `exists()` がハングし得るため。タイムアウト時は 503、ファイルが存在しない場合は 404 を返し、「消えた」と「今は届かない」を区別する。フロントはどちらもプレースホルダを出して次へ進む。

その他のエラーは `{ "error": "..." }` の JSON で返す。`parse.rs` は不正なクエリ文字列でも常に `ParsedQuery` を返すため、400 になるのは `limit` / `offset` / `w` の数値パース失敗のみ。

## packages/shared

desktop の `src/util/` から、UI にも Tauri にも依存しない純粋関数を移す。

移す: `queryTokens`・`promptQuery`・`normalizeText`・`imageDates`・`ratingFilter`・`historyMatch`・`historyNav`・`playlist`・`gridNav`、および `types.ts` のうち `Directory`・`ImageRow`・`SortKey`・`SortDir`。テストファイルも同時に移す。

残す: `selection`・`dialogKeys`・`platform`・`zoomSetting`・`zoomCycle`・`ratingStars`・`ratingNav`・`dirStatus`（Tauri のメニューやレーティング操作と結びついているため）、`ImageDetail`・`TagFreq` などの詳細表示・分析系の型。

このパッケージはビルドしない。`package.json` の `exports` から `src/*.ts` を直接指し、Vite と vitest が TS をそのまま解決する。ビルド段が無いため shared の修正が反映漏れを起こさない。

desktop 側は `src/util/x.ts` を削除して import を `@gim/shared` へ差し替える。既存テストがそのまま回帰検出になる。

新規に追加するのは履歴操作の純粋関数（記録・重複時の先頭への昇格・上限件数）。Rust の `db/history.rs` と同じケースをテストする。上限は 50 件とする（`db/history.rs` の 20 件より多いのは、localStorage が容量的に余裕があり、スマホでの手入力を減らす価値が大きいため）。

## web フロント

### 画面

**一覧画面**（起点）: 上部にクエリ入力・「絞り込み」ボタン・ソート切替・件数表示。その下に仮想スクロールのグリッド（`@tanstack/react-virtual`）。取得は 200 件ずつの無限スクロールで、総数は `/api/images/count` から別に取る。

**履歴**: クエリ入力をタップすると履歴リストが下に開き、入力中の文字列で前方一致絞り込みされる（`historyMatch` / `historyNav`）。

**フィルタシート**: ボトムシート。レーティング・サイズ・日付・モデル・生成ツール・プロンプトをフォームで指定すると、`queryTokens` でクエリ文字列を組み立てて入力欄へ反映する。シートは独自の状態を持たず、常にクエリ文字列が正である。これによりシートで作った条件を手で直せ、履歴もデスクトップ版と同じ表現で残る。

**ディレクトリシート**: チェックボックス一覧。

**ビューア**: 全画面表示、左右スワイプで送り、ピンチズーム、タップで UI 表示切替。

**スライドショー**: ビューアから起動。間隔・ループ・シャッフルを設定できる。順序生成は `playlist.ts` の `buildOrder` / `step` を使い、次の2枚を `new Image()` でプリロードする。

PC ブラウザではキーボードも効かせる（←→ で送り、Space で再生/停止、F でフルスクリーン、`/` でクエリ入力へフォーカス）。修飾キーは完全一致で判定する。

### 状態

zustand ストア2つ:

- `useQueryStore` — クエリ・ソート・ディレクトリ選択・結果・総数・ページング
- `useViewerStore` — 現在位置・ズーム・スライドショー設定

localStorage は `gim.web.*` の名前空間に `history`（最大50件、新しい順・重複は先頭へ昇格）・`query`・`sort`・`dirs`・`slideshow` を保存する。読み書きはロジックから分離し、ロジック側を `packages/shared` の純粋関数としてテストする。

## テスト

**Rust core**: 移設した既存インラインテスト。追加は `DirScope::Ids`（指定 ID のみ返す・空リストは0件・存在しない ID は無視）。

**Rust server**: `resize.rs` を厚く（拡大しない・`w` のスナップ・キャッシュキーが同入力で安定し mtime 変化で変わる・一時ファイル経由の書き込み）。ハンドラは `tower::ServiceExt::oneshot` で HTTP を立てずに検証する。temp ディレクトリに `migrations::run` で作ったテスト DB を置き、クエリパラメータの解釈とレスポンス形状、`user_version` 不一致時の起動拒否をテストする。

**共有 TS**: 移設した既存 vitest。追加は履歴操作。

**web フロント**: フィルタシートのフォーム入力からクエリ文字列が正しく組み上がること、履歴リストの絞り込み表示。

コマンド:

```bash
cargo test --workspace
npm test          # vitest projects でルート・web・packages/shared を束ねる
```

## ビルドと起動

```bash
npm run build -w web
cargo build --release -p gim-server
./target/release/gim-server
```

開発時は `npm run dev -w web`（Vite、`/api` を `localhost:5180` へプロキシ）と `cargo run -p gim-server` の2プロセス。

`scripts/version-core.mjs` が対象とする4ファイルのうち `src-tauri/Cargo.lock` を `Cargo.lock` へ変更する。

## 実装フェーズ

1. **Cargo workspace 化と core 抽出** — 機能変更なし。`cargo test --workspace` が緑、`npm run tauri dev` が起動する。`scripts/version-core.mjs` の `Cargo.lock` パス修正を含む（テスト先行）
2. **`packages/shared` 抽出** — 機能変更なし。`npm test` 緑、desktop が動く
3. **`DirScope` 導入** — テストを先に書いてから core と desktop 呼び出しを直す
4. **`crates/server` の JSON API** — DB 読み取りのみ。ここで WAL の読み取り専用接続が実際に開けるかを最初に確認する
5. **画像配信とリサイズキャッシュ**
6. **web フロント: 一覧・フィルタ・履歴・ディレクトリ選択**
7. **ビューアとスライドショー**
8. **`rust-embed` で単一バイナリ化と待受アドレス表示**

フェーズ1〜3は既存アプリを触るため、各フェーズの終わりにデスクトップ版の起動と主要動作を確認してからコミットする。フェーズ4以降は追加のみでデスクトップ版へ影響しない。

## リスク

**WAL データベースへの読み取り専用接続が開けない場合**: `library.db` を起動時にキャッシュディレクトリへコピーして読む方式へ退避する（デスクトップ版の更新は再起動で反映）。フェーズ4を前倒ししているのはこの分岐を早く確定させるため。

**大量画像でのモバイル性能**: フェーズ6の終わりにスマホ実機で確認する。
