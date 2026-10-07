# GenImgLook 設計（Quick Look 風の PNG ビューア）

## 目的

Finder から AI 生成 PNG を開いたとき、画像と一緒にプロンプト・モデル等のメタデータを確認し、Prompt / Negative をコピーできるようにする。gen-img-manager 本体のライブラリ取り込みを経由せずに使える。

## 前提・制約

- 個人利用。ローカルビルド＋ローカル署名で配布はしない（公証・App Store 対象外）。
- 対象は PNG のみ。
- Tauri アプリのビルドとは独立させる。gen-img-manager 本体のコードには手を入れない。

## Quick Look 拡張を作らない理由

`public.png` 向けの Quick Look Preview 拡張を ad-hoc 署名で作り、`pluginkit` で有効化して検証した。その状態でも、Finder のスペースキーでは OS 標準のプレビューが表示された。PNG では自作の拡張が呼ばれないため、拡張は作らず、Quick Look 風に使えるビューアアプリだけを作る。

## 構成

`macos/GenImgLook/` に Xcode プロジェクトを置き、`project.yml` を xcodegen で `.xcodeproj` に変換する。生成された `.xcodeproj` はコミットしない。

| ターゲット | 種別 | 役割 |
|---|---|---|
| `GenImgLook` | macOS App | PNG ビューア |
| `GenImgLookTests` | Unit Test | パーサ類のテスト |

コード（パーサ類はテストターゲットにも含める）:

- `PNGText` — PNG の IHDR（幅・高さ）と tEXt / zTXt / iTXt を読む
- `A1111Parser` — `parameters` テキストを正規化する
- `ComfyParser` — `prompt` JSON からテキストを抽出する
- `XMPRating` — サイドカー XMP から rating を読む
- `ImageMetadata` — 上記をまとめたモデル（`load(url:)`）
- `PreviewView` / `MetadataPanel` — SwiftUI のビュー

### ビューアアプリ（GenImgLook.app）

- `DocumentGroup`（閲覧専用）で PNG に関連付ける。Finder の「このアプリで開く」やドラッグで開く。
- タイトルバーにファイル名を表示する（ドキュメントウィンドウの標準動作）。
- ツールバー: 共有（`ShareLink`）、「プレビューで開く」（`NSWorkspace.open(_:withApplicationAt:)` で Preview.app に渡す）、サイドパネルの開閉。
- Quick Look と同じく、修飾キーなしの Space または Esc でウィンドウを閉じる。
- サンドボックス化しない（App Store 配布をしないため。サイドカー XMP をそのまま読める）。

## 画面仕様

### レイアウト

- 左に画像、右にサイドパネル（幅 320pt 固定）を置く。
- 画像はアスペクト比を保ってウィンドウに収める。拡大・縮小はしない。
- パネルはツールバーのボタンで開閉し、開閉状態は `@AppStorage("sidePanelVisible")`（既定 `true`）で記憶する。

### サイドパネル

gen-img-manager の `MetadataPanel.tsx` と同じ並びにする。

1. ファイル名
2. サイズ（`W × H`）/ ツール（`a1111` / `comfyui` / `unknown`）/ モデル / サンプラー / Steps / CFG / Seed。値が無い行は表示しない。
3. レーティング: `★N`（表示のみ）。rating が取れない、または 0 のときは行ごと表示しない。
4. テキストブロック:
   - Prompt（positive があるとき）
   - Negative（negative があるとき）
   - Parameters（positive が無く、生パラメータがあるとき）

各テキストブロックの仕様:

- ヘッダに「コピー」「最大化」ボタンを置く。
- 本文は等幅フォントで、スクロールでき、テキストを選択できる。
- 「コピー」は表示中の原文を `NSPasteboard.general` に書き込む。
- 「最大化」はそのブロックだけをパネル全体に表示し、「戻す」で元に戻す。画像が切り替わったら最大化を解除する。

メタデータが無いときは、ファイル名とサイズに続けて「メタデータなし」と表示する。

## 解析ルール（Rust 実装 `src-tauri/src/parser/` と同じ）

### PNG

- IHDR から幅と高さを取る。
- tEXt（Latin-1）、zTXt（zlib 圧縮・Latin-1）、iTXt（UTF-8、圧縮フラグ付き）を読み、キーワードから本文への辞書を作る。
- zlib の展開には `NSData.decompressed(using: .zlib)` を使う（raw deflate を受け取るので、zlib ヘッダ2バイトと末尾の Adler-32 4バイトを除いて渡す）。
- IEND または IDAT 以降は読まない。

### ツールの判定

- `parameters` キーがあれば A1111 とする。`raw_parameters` は `parameters` の本文。
- `parameters` が無く `prompt` キーがあれば ComfyUI とする。`raw_parameters` は `prompt` の本文。
- どちらも無ければ `unknown`。

### A1111

- 入力を trim する。
- 最後の行が `Steps:` を含めば、その行をパラメータ行として切り出す。改行が無く全体が `Steps:` を含む場合は、全体をパラメータ行とする。
- 本文に `Negative prompt:` があれば、それより前を positive、後ろを negative とする（いずれも trim し、空なら無しとする）。
- パラメータ行から `Steps` / `Sampler` / `CFG scale` / `Seed` / `Model` を拾う。
- 細部は `a1111.rs` に合わせ、そのテストケースを Swift のテストに移植する。

### ComfyUI

- `prompt` JSON の各ノードのうち、`class_type` が `CLIPTextEncode` を含むものについて `inputs.text` を集める。
- 各テキストを trim し、空のものは除く。残りを改行で結合して positive とする。
- negative は持たない。

### XMP

- `画像.png.xmp` を優先し、無ければ `画像.xmp` を読む。
- `xmp:Rating` を属性形式・要素形式のどちらからでも読む。
- 値は 0〜5 に丸める（-1 は 0 になる）。

## エラー時の挙動

| 状況 | 挙動 |
|---|---|
| メタデータが無い、または解析に失敗した | 画像は表示し、パネルに「メタデータなし」を出す |
| 画像をデコードできない | 「開けません」を表示する |
| XMP が無い、または読めない | レーティング行を表示しない |

## テスト

- XCTest（`xcodebuild test`）で `PNGText` / `A1111Parser` / `ComfyParser` / `XMPRating` を検証する。PNG はテスト内でバイト列から組み立てる。テストケースは Rust 側の同名テストと同じ入力を使う。
- UI は手動で確認する: アプリで開く、共有、プレビューで開く、コピー、最大化、パネル開閉状態の記憶、Space / Esc で閉じる。

## 範囲外

フォルダ内の前後送り、レーティングの編集、整形トグル、PNG 以外の形式、library.db の参照、配布用の署名・公証。
