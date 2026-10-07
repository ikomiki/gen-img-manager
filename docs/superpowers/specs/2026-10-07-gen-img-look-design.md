# GenImgLook 設計（macOS Quick Look 拡張＋PNG ビューア）

## 目的

Finder から AI 生成 PNG を開いたとき、画像と一緒にプロンプト・モデル等のメタデータを確認し、Prompt / Negative をコピーできるようにする。gen-img-manager 本体のライブラリ取り込みを経由せずに使える。

## 前提・制約

- 個人利用。ローカルビルド＋ローカル署名で配布はしない（公証・App Store 対象外）。
- 対象は PNG のみ。
- Tauri アプリのビルドとは独立させる。gen-img-manager 本体のコードには手を入れない。

## ステップ0: スパイク（使い捨て）

本実装の前に、「Hello」と表示するだけの最小 Preview 拡張で次の2点を検証する。

1. `public.png` 向けの自作 Preview 拡張が、Finder のスペースキー押下で OS 組み込みのプレビューより優先されるか。
2. 有効な署名 ID が無い環境で、ad-hoc 署名（Sign to Run Locally）のまま `pluginkit` に登録され、動作するか。
3. Quick Look パネル内の SwiftUI ボタンがクリックに反応し、`NSPasteboard` へのコピーが効くか。

結果ごとの対応:

| 結果 | 対応 |
|---|---|
| 両方 OK | 本設計どおり実装する |
| 1 が NG | 拡張は `qlmanage -p` 等での明示呼び出し用とし、ビューアアプリを主役にする（作るものは変えない） |
| 2 が NG | Personal Team 証明書を使うかどうかをユーザーと相談する |
| 3 が NG | 拡張はパネル表示のみとし、コピーはテキスト選択＋Cmd+C に頼る。それも効かなければユーザーと相談する |

スパイクのコードは残さない。

## 構成

`macos/GenImgLook/` に Xcode プロジェクトを置き、`project.yml` を xcodegen で `.xcodeproj` に変換する。生成された `.xcodeproj` はコミットしない。

| ターゲット | 種別 | 役割 |
|---|---|---|
| `GenImgLook` | macOS App | 拡張を載せるホストアプリ。単体の PNG ビューアも兼ねる |
| `GenImgLookPreview` | Quick Look Preview Extension | Finder の Quick Look で表示する |
| `GenImgLookTests` | Unit Test | パーサ類のテスト |

共有コード（アプリと拡張の両ターゲットに含める）:

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

### Quick Look 拡張（GenImgLookPreview.appex）

- `QLPreviewingController` を実装した `NSViewController` で、`NSHostingView(PreviewView)` を表示する。
- `QLSupportedContentTypes` は `public.png`。
- タイトルバー・共有・「プレビューで開く」は OS 標準の Quick Look パネルが付けるので、自作しない。
- サイドカー XMP を読むため、エンタイトルメント `com.apple.security.temporary-exception.files.absolute-path.read-only` に `/` を指定する。

## 画面仕様

### レイアウト

- 左に画像、右にサイドパネル（幅 320pt 固定）を置く。
- 画像はアスペクト比を保ってウィンドウに収める。拡大・縮小はしない。
- パネルの開閉:
  - アプリはツールバーのボタンで開閉する。
  - 拡張はパネル上端の「›」で閉じ、閉じているときは画像右端の「‹」で開く。
- 開閉状態は `@AppStorage("sidePanelVisible")`（既定 `true`）で記憶する。アプリと拡張は別のコンテナなので、状態は別々に保存される。

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
| 画像をデコードできない | 拡張はエラーを返して OS に任せる。アプリは「開けません」を表示する |
| XMP が無い、または読めない | レーティング行を表示しない |

## テスト

- XCTest（`xcodebuild test`）で `PNGText` / `A1111Parser` / `ComfyParser` / `XMPRating` を検証する。PNG はテスト内でバイト列から組み立てる。テストケースは Rust 側の同名テストと同じ入力を使う。
- UI は手動で確認する: Finder のスペースキー、`qlmanage -p <file>`、アプリで開く、コピー、最大化、開閉状態の記憶。

## 範囲外

フォルダ内の前後送り、レーティングの編集、整形トグル、PNG 以外の形式、library.db の参照、配布用の署名・公証。
