# GenImgLook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finder の Quick Look と単体ビューアアプリで、AI 生成 PNG の画像とメタデータ（Prompt / Negative / モデル等・XMP レーティング）を表示し、Prompt / Negative をコピーできるようにする。

**Architecture:** `macos/GenImgLook/` に xcodegen で生成する Xcode プロジェクトを置く。ホストアプリ（単体ビューア兼用）と Quick Look Preview 拡張の2ターゲットが、`Shared/`（パーサ群と SwiftUI ビュー）を共有する。パーサは gen-img-manager の Rust 実装（`src-tauri/src/parser/`）と同じ規則で Swift に再実装する。

**Tech Stack:** Swift 5 / SwiftUI / AppKit / QuickLookUI / XCTest / xcodegen / Xcode 27（macOS 14.0 以上がターゲット）

**Spec:** `docs/superpowers/specs/2026-10-07-gen-img-look-design.md`

## Global Constraints

- 対象は PNG（`public.png`）のみ。
- 個人利用。ad-hoc 署名（`CODE_SIGN_IDENTITY: "-"`）。公証・App Store 対応はしない。
- gen-img-manager 本体（`src/`、`src-tauri/`、`crates/`、`packages/`）は変更しない。
- 外部 Swift パッケージは追加しない（Foundation / SwiftUI / AppKit / QuickLookUI のみ）。
- 生成物 `macos/GenImgLook/GenImgLook.xcodeproj` と `macos/GenImgLook/build/` はコミットしない。
- コードコメントは非自明な WHY だけを書く（WHAT・変更履歴・タスク ID は書かない）。
- コミットメッセージ: type/scope は英語、要約・本文は日本語。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。
- 作業ブランチは `feature/gen-img-look`。コミット前に `git branch --show-current` と `git status` を確認する。

## Review Focus

1. A1111 の parameters の改行が CRLF の場合も、LF と同じ結果になること（Task 1 にテストあり）。
2. iTXt の圧縮テキスト、および日本語を含む UTF-8 の iTXt を読めること（Task 3 にテストあり）。
3. チャンク長がファイル末尾を超える壊れた PNG でもクラッシュせず、読めた範囲だけ返すこと（Task 3 にテストあり）。
4. `画像.png.xmp` が無く `画像.xmp` だけがある場合に、そちらからレーティングを読むこと（Task 4 にテストあり）。
5. メタデータの無い PNG で、`ImageMetadata` が寸法だけを持ち、`hasGenerationInfo == false` になること（Task 5 にテストあり）。

## File Structure

```
macos/GenImgLook/
  project.yml                         xcodegen 定義（3ターゲット）
  README.md                           ビルド・インストール手順
  Shared/Parsing/A1111Parser.swift    A1111 parameters → A1111Fields
  Shared/Parsing/ComfyParser.swift    ComfyUI prompt JSON → テキスト
  Shared/Parsing/PNGText.swift        IHDR + tEXt/zTXt/iTXt の読み取り
  Shared/Parsing/XMPRating.swift      xmp:Rating の解析・サイドカー探索
  Shared/Parsing/ImageMetadata.swift  上記を統合したモデル
  Shared/UI/MetadataPanel.swift       右サイドパネル
  Shared/UI/PreviewView.swift         画像＋パネルのレイアウト
  App/GenImgLookApp.swift             DocumentGroup・ツールバー
  Preview/PreviewViewController.swift QLPreviewingController
  Tests/A1111ParserTests.swift
  Tests/ComfyParserTests.swift
  Tests/PNGTextTests.swift
  Tests/XMPRatingTests.swift
  Tests/ImageMetadataTests.swift
  Tests/PNGBuilder.swift              テスト用に PNG バイト列を組み立てる
```

`Info.plist` とエンタイトルメントは xcodegen が `project.yml` の `info` / `entitlements` から生成する（生成先 `App/Info.plist` などもコミット対象にする。xcodegen は毎回上書きする）。

共通コマンド（`macos/GenImgLook/` で実行）:

```bash
xcodegen generate
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -configuration Release -derivedDataPath build build
```

---

### Task 0: スパイク — Quick Look 拡張の優先・ad-hoc 署名・操作性を検証（使い捨て）

**Files:** すべて scratchpad 配下に作る。リポジトリにはコミットしない。

**Interfaces:**
- Consumes: なし
- Produces: 検証結果3点（優先されるか / ad-hoc 署名で登録できるか / ボタン＋コピーが効くか）。結果はユーザーに報告し、spec の対応表に従って続行可否を確定する。

- [ ] **Step 1: 最小プロジェクトを作る**

`$SCRATCH/spike/project.yml`（`$SCRATCH` は scratchpad ディレクトリ）:

```yaml
name: Spike
options:
  bundleIdPrefix: local.genimgspike
  deploymentTarget:
    macOS: "14.0"
settings:
  base:
    CODE_SIGN_IDENTITY: "-"
    CODE_SIGN_STYLE: Manual
    ENABLE_HARDENED_RUNTIME: NO
targets:
  Spike:
    type: application
    platform: macOS
    sources: [App]
    info:
      path: App/Info.plist
    dependencies:
      - target: SpikePreview
  SpikePreview:
    type: app-extension
    platform: macOS
    sources: [Preview]
    info:
      path: Preview/Info.plist
      properties:
        NSExtension:
          NSExtensionPointIdentifier: com.apple.quicklook.preview
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).PreviewViewController
          NSExtensionAttributes:
            QLSupportedContentTypes: [public.png]
            QLSupportsSearchableItems: false
    entitlements:
      path: Preview/SpikePreview.entitlements
      properties:
        com.apple.security.app-sandbox: true
        com.apple.security.files.user-selected.read-only: true
```

`$SCRATCH/spike/App/SpikeApp.swift`:

```swift
import SwiftUI

@main
struct SpikeApp: App {
    var body: some Scene {
        WindowGroup { Text("Spike host") }
    }
}
```

`$SCRATCH/spike/Preview/PreviewViewController.swift`:

```swift
import Cocoa
import QuickLookUI
import SwiftUI

final class PreviewViewController: NSViewController, QLPreviewingController {
    override func loadView() { view = NSView() }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let host = NSHostingView(rootView: VStack {
            Text("Hello from SpikePreview: \(url.lastPathComponent)").font(.largeTitle)
            Button("コピー") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString("spike-copied", forType: .string)
            }
        }.frame(minWidth: 600, minHeight: 400))
        host.frame = view.bounds
        host.autoresizingMask = [.width, .height]
        view.addSubview(host)
        preferredContentSize = NSSize(width: 600, height: 400)
        handler(nil)
    }
}
```

- [ ] **Step 2: ビルドしてインストールする**

```bash
cd $SCRATCH/spike && xcodegen generate
xcodebuild -project Spike.xcodeproj -scheme Spike -configuration Release -derivedDataPath build build
mkdir -p ~/Applications && rm -rf ~/Applications/Spike.app
cp -R build/Build/Products/Release/Spike.app ~/Applications/
open ~/Applications/Spike.app
pluginkit -m -v -p com.apple.quicklook.preview | grep -i spike
qlmanage -r && qlmanage -r cache
```

Expected: `pluginkit` の出力に `local.genimgspike.SpikePreview` が出る（行頭 `+` は有効を示す）。出なければ検証 2 は NG。`pluginkit -e use -i local.genimgspike.SpikePreview` で有効化を試し、結果を記録する。

- [ ] **Step 3: 明示呼び出しで表示を確認する**

```bash
qlmanage -p <任意の PNG のパス>
```

Expected: 「Hello from SpikePreview」が表示される。

- [ ] **Step 4: ユーザーに Finder での確認を依頼する**

ユーザーに次を依頼して結果を受け取る:
1. Finder で PNG を選択してスペースキーを押し、「Hello from SpikePreview」が出るか（検証 1）。
2. 「コピー」ボタンを押し、テキストエディタに貼り付けると `spike-copied` になるか（検証 3）。

- [ ] **Step 5: 後片付けと報告**

```bash
pluginkit -e ignore -i local.genimgspike.SpikePreview
rm -rf ~/Applications/Spike.app
qlmanage -r
```

3点の結果をユーザーに報告し、spec の対応表に従って続行方法を確定する。NG がある場合は Task 1 以降に進む前にユーザーの判断を待つ。

---

### Task 1: プロジェクト雛形と A1111Parser

**Files:**
- Create: `macos/GenImgLook/project.yml`
- Create: `macos/GenImgLook/Shared/Parsing/A1111Parser.swift`
- Create: `macos/GenImgLook/Tests/A1111ParserTests.swift`
- Create: `macos/GenImgLook/App/GenImgLookApp.swift`（ビルドを通すための仮実装。Task 7 で置き換える）
- Create: `macos/GenImgLook/Preview/PreviewViewController.swift`（ビルドを通すための仮実装。Task 8 で置き換える）
- Modify: `.gitignore`（末尾に追記）

**Interfaces:**
- Consumes: なし
- Produces:
  ```swift
  struct A1111Fields: Equatable {
      var positive: String?; var negative: String?
      var model: String?; var sampler: String?
      var steps: Int?; var seed: Int?; var cfg: Double?
  }
  enum A1111Parser { static func parse(_ raw: String) -> A1111Fields }
  ```
  `project.yml` のターゲット名は `GenImgLook` / `GenImgLookPreview` / `GenImgLookTests`。テストターゲットは `Tests/` と `Shared/Parsing/` を直接コンパイルするので、テストコードは `@testable import` を使わない。

- [ ] **Step 1: `project.yml` を書く**

```yaml
name: GenImgLook
options:
  bundleIdPrefix: local.genimgmanager
  deploymentTarget:
    macOS: "14.0"
settings:
  base:
    SWIFT_VERSION: "5.0"
    CODE_SIGN_IDENTITY: "-"
    CODE_SIGN_STYLE: Manual
    ENABLE_HARDENED_RUNTIME: NO
    MARKETING_VERSION: "0.1.0"
    CURRENT_PROJECT_VERSION: "1"
targets:
  GenImgLook:
    type: application
    platform: macOS
    sources: [App, Shared]
    info:
      path: App/Info.plist
      properties:
        CFBundleDisplayName: GenImgLook
        LSApplicationCategoryType: public.app-category.graphics-design
        CFBundleDocumentTypes:
          - CFBundleTypeName: PNG Image
            CFBundleTypeRole: Viewer
            LSHandlerRank: Alternate
            LSItemContentTypes: [public.png]
    dependencies:
      - target: GenImgLookPreview
    scheme:
      testTargets: [GenImgLookTests]
  GenImgLookPreview:
    type: app-extension
    platform: macOS
    sources: [Preview, Shared]
    info:
      path: Preview/Info.plist
      properties:
        CFBundleDisplayName: GenImgLook Preview
        NSExtension:
          NSExtensionPointIdentifier: com.apple.quicklook.preview
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).PreviewViewController
          NSExtensionAttributes:
            QLSupportedContentTypes: [public.png]
            QLSupportsSearchableItems: false
    entitlements:
      path: Preview/GenImgLookPreview.entitlements
      properties:
        com.apple.security.app-sandbox: true
        com.apple.security.files.user-selected.read-only: true
        # 隣接するサイドカー XMP はプレビュー対象ファイルではないため、サンドボックス例外が要る
        com.apple.security.temporary-exception.files.absolute-path.read-only: ["/"]
  GenImgLookTests:
    type: bundle.unit-test
    platform: macOS
    sources: [Tests, Shared/Parsing]
```

ホストアプリはサンドボックス化しない（App Store 配布しないため。サイドカー XMP を読むのに例外を足さずに済む）。

- [ ] **Step 2: ビルド用の仮実装と `.gitignore` を追加する**

`macos/GenImgLook/App/GenImgLookApp.swift`:

```swift
import SwiftUI

@main
struct GenImgLookApp: App {
    var body: some Scene {
        WindowGroup { Text("GenImgLook") }
    }
}
```

`macos/GenImgLook/Preview/PreviewViewController.swift`:

```swift
import Cocoa
import QuickLookUI

final class PreviewViewController: NSViewController, QLPreviewingController {
    override func loadView() { view = NSView() }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        handler(nil)
    }
}
```

`.gitignore` の末尾に追記:

```
# GenImgLook (xcodegen generated)
macos/GenImgLook/GenImgLook.xcodeproj/
macos/GenImgLook/build/
```

- [ ] **Step 3: 失敗するテストを書く**

`macos/GenImgLook/Tests/A1111ParserTests.swift`（`src-tauri/src/parser/a1111.rs` のテストを移植し、CRLF を追加）:

```swift
import XCTest

final class A1111ParserTests: XCTestCase {
    func testParsesFullExample() {
        let raw = "masterpiece, 1girl, forest\nNegative prompt: blurry, lowres\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7.5, Seed: 12345, Size: 512x768, Model: sdxl_base"
        let f = A1111Parser.parse(raw)
        XCTAssertEqual(f.positive, "masterpiece, 1girl, forest")
        XCTAssertEqual(f.negative, "blurry, lowres")
        XCTAssertEqual(f.steps, 28)
        XCTAssertEqual(f.sampler, "DPM++ 2M")
        XCTAssertEqual(f.cfg, 7.5)
        XCTAssertEqual(f.seed, 12345)
        XCTAssertEqual(f.model, "sdxl_base")
    }

    func testHandlesMissingNegativePrompt() {
        let f = A1111Parser.parse("a cat\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Model: m")
        XCTAssertEqual(f.positive, "a cat")
        XCTAssertNil(f.negative)
        XCTAssertEqual(f.steps, 20)
    }

    func testHandlesPlainPromptWithoutParams() {
        let f = A1111Parser.parse("just a prompt with no settings")
        XCTAssertEqual(f.positive, "just a prompt with no settings")
        XCTAssertNil(f.steps)
        XCTAssertNil(f.sampler)
    }

    func testMultilinePositivePrompt() {
        let f = A1111Parser.parse("line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9")
        XCTAssertEqual(f.positive, "line one\nline two")
        XCTAssertEqual(f.negative, "bad")
        XCTAssertEqual(f.seed, 9)
    }

    func testSingleLineParamsOnly() {
        let f = A1111Parser.parse("Steps: 5, Seed: 3")
        XCTAssertNil(f.positive)
        XCTAssertEqual(f.steps, 5)
        XCTAssertEqual(f.seed, 3)
    }

    func testCRLFMatchesLF() {
        let lf = "line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9"
        let crlf = lf.replacingOccurrences(of: "\n", with: "\r\n")
        XCTAssertEqual(A1111Parser.parse(crlf), A1111Parser.parse(lf))
    }
}
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'A1111Parser' in scope`）

- [ ] **Step 5: 実装する**

`macos/GenImgLook/Shared/Parsing/A1111Parser.swift`:

```swift
import Foundation

struct A1111Fields: Equatable {
    var positive: String?
    var negative: String?
    var model: String?
    var sampler: String?
    var steps: Int?
    var seed: Int?
    var cfg: Double?
}

/// gen-img-manager の `src-tauri/src/parser/a1111.rs` と同じ規則で解析する。
enum A1111Parser {
    static func parse(_ input: String) -> A1111Fields {
        // Swift の Character では "\r\n" が1文字になり "\n" で分割できないため、先に LF へ揃える
        let raw = input.replacingOccurrences(of: "\r\n", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var fields = A1111Fields()

        var body = raw
        var paramsLine = ""
        if let nl = raw.lastIndex(of: "\n") {
            let last = String(raw[raw.index(after: nl)...])
            if last.contains("Steps:") {
                body = String(raw[..<nl])
                paramsLine = last
            }
        } else if raw.contains("Steps:") {
            body = ""
            paramsLine = raw
        }

        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedBody.isEmpty {
            if let r = trimmedBody.range(of: "Negative prompt:") {
                fields.positive = nonEmpty(trimmedBody[..<r.lowerBound])
                fields.negative = nonEmpty(trimmedBody[r.upperBound...])
            } else {
                fields.positive = trimmedBody
            }
        }

        // ponytail: ", " の単純分割。値に ", " を含むと欠損する（Rust 実装と同じ制限）
        for token in paramsLine.components(separatedBy: ", ") {
            guard let sep = token.range(of: ": ") else { continue }
            let key = token[..<sep.lowerBound].trimmingCharacters(in: .whitespaces)
            let value = token[sep.upperBound...].trimmingCharacters(in: .whitespaces)
            switch key {
            case "Steps": fields.steps = Int(value)
            case "Sampler": fields.sampler = value
            case "CFG scale": fields.cfg = Double(value)
            case "Seed": fields.seed = Int(value)
            case "Model": fields.model = value
            default: break
            }
        }
        return fields
    }

    private static func nonEmpty(_ s: Substring) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`（6件）

- [ ] **Step 7: コミットする**

```bash
git add .gitignore macos/GenImgLook
git commit -m "feat(look): GenImgLook の Xcode プロジェクト雛形と A1111 パーサを追加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git status` で `GenImgLook.xcodeproj` と `build/` が含まれていないことを確認する。xcodegen が生成した `App/Info.plist`・`Preview/Info.plist`・`Preview/GenImgLookPreview.entitlements` はコミットする。

---

### Task 2: ComfyParser

**Files:**
- Create: `macos/GenImgLook/Shared/Parsing/ComfyParser.swift`
- Create: `macos/GenImgLook/Tests/ComfyParserTests.swift`

**Interfaces:**
- Consumes: なし
- Produces: `enum ComfyParser { static func extractText(_ promptJSON: String) -> String? }` — `CLIPTextEncode` を含む `class_type` のノードの `inputs.text` を、ノード ID の自然順で改行結合する。対象が無い・JSON でない・オブジェクトでない場合は `nil`。

- [ ] **Step 1: 失敗するテストを書く**

`macos/GenImgLook/Tests/ComfyParserTests.swift`（`comfyui.rs` のテストを移植）:

```swift
import XCTest

final class ComfyParserTests: XCTestCase {
    func testExtractsClipTextEncodeNodesInNodeOrder() {
        let json = """
        {"10": {"class_type": "CLIPTextEncode", "inputs": {"text": "second"}},
         "3": {"class_type": "KSampler", "inputs": {"seed": 1}},
         "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "first"}}}
        """
        XCTAssertEqual(ComfyParser.extractText(json), "first\nsecond")
    }

    func testNoTextNodesReturnsNil() {
        XCTAssertNil(ComfyParser.extractText(#"{"3": {"class_type": "KSampler", "inputs": {"seed": 1}}}"#))
    }

    func testInvalidJSONReturnsNil() {
        XCTAssertNil(ComfyParser.extractText("not json"))
    }

    func testWhitespaceOnlyTextIsFiltered() {
        XCTAssertNil(ComfyParser.extractText(#"{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "   "}}}"#))
    }

    func testNonObjectJSONReturnsNil() {
        XCTAssertNil(ComfyParser.extractText("[1, 2, 3]"))
        XCTAssertNil(ComfyParser.extractText("42"))
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'ComfyParser' in scope`）

- [ ] **Step 3: 実装する**

`macos/GenImgLook/Shared/Parsing/ComfyParser.swift`:

```swift
import Foundation

/// gen-img-manager の `comfyui.rs` と同じ抽出規則。ComfyUI のグラフからは正負を判別できないため、
/// テキストエンコードノードの文字列をすべて結合して返す。
enum ComfyParser {
    static func extractText(_ promptJSON: String) -> String? {
        guard let data = promptJSON.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? [String: Any]
        else { return nil }

        // JSONSerialization の辞書は順序を持たないため、ノード ID の自然順で並べて表示を安定させる
        let texts = root.keys
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .compactMap { key -> String? in
                guard let node = root[key] as? [String: Any],
                      (node["class_type"] as? String)?.contains("CLIPTextEncode") == true,
                      let text = (node["inputs"] as? [String: Any])?["text"] as? String
                else { return nil }
                let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            }
        return texts.isEmpty ? nil : texts.joined(separator: "\n")
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): ComfyUI の prompt JSON からテキストを抽出する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: PNGText

**Files:**
- Create: `macos/GenImgLook/Shared/Parsing/PNGText.swift`
- Create: `macos/GenImgLook/Tests/PNGBuilder.swift`
- Create: `macos/GenImgLook/Tests/PNGTextTests.swift`

**Interfaces:**
- Consumes: なし
- Produces:
  ```swift
  struct PNGText: Equatable {
      let width: Int; let height: Int; let texts: [String: String]
      static func read(_ data: Data) -> PNGText?   // シグネチャ不一致・IHDR 無しなら nil
  }
  // テスト専用（Tests/PNGBuilder.swift）
  enum PNGBuilder {
      static func png(width: Int, height: Int, chunks: [(String, Data)]) -> Data
      static func tEXt(_ key: String, _ text: String) -> (String, Data)
      static func zTXt(_ key: String, _ text: String) -> (String, Data)
      static func iTXt(_ key: String, _ text: String, compressed: Bool) -> (String, Data)
  }
  ```

- [ ] **Step 1: テスト用 PNG ビルダーを書く**

`macos/GenImgLook/Tests/PNGBuilder.swift`:

```swift
import Foundation

/// パーサは CRC を検証しないので、CRC は 0 埋めで組み立てる。
enum PNGBuilder {
    static func png(width: Int, height: Int, chunks: [(String, Data)]) -> Data {
        var d = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        var ihdr = Data()
        ihdr.append(be32(width)); ihdr.append(be32(height))
        ihdr.append(contentsOf: [8, 6, 0, 0, 0])
        for (type, body) in [("IHDR", ihdr)] + chunks + [("IDAT", Data()), ("IEND", Data())] {
            d.append(be32(body.count))
            d.append(type.data(using: .ascii)!)
            d.append(body)
            d.append(be32(0))
        }
        return d
    }

    static func tEXt(_ key: String, _ text: String) -> (String, Data) {
        var b = key.data(using: .isoLatin1)!
        b.append(0); b.append(text.data(using: .isoLatin1)!)
        return ("tEXt", b)
    }

    static func zTXt(_ key: String, _ text: String) -> (String, Data) {
        var b = key.data(using: .isoLatin1)!
        b.append(contentsOf: [0, 0])
        b.append(zlib(text.data(using: .isoLatin1)!))
        return ("zTXt", b)
    }

    static func iTXt(_ key: String, _ text: String, compressed: Bool) -> (String, Data) {
        var b = key.data(using: .isoLatin1)!
        b.append(contentsOf: [0, compressed ? 1 : 0, 0])
        b.append(contentsOf: Array("ja".utf8)); b.append(0)
        b.append(0)
        let utf8 = text.data(using: .utf8)!
        b.append(compressed ? zlib(utf8) : utf8)
        return ("iTXt", b)
    }

    /// NSData の .zlib は raw deflate なので、zlib ヘッダと（0 埋めの）Adler-32 を付けて実ファイルと同じ形にする。
    private static func zlib(_ raw: Data) -> Data {
        var d = Data([0x78, 0x9C])
        d.append(try! (raw as NSData).compressed(using: .zlib) as Data)
        d.append(contentsOf: [0, 0, 0, 0])
        return d
    }

    private static func be32(_ v: Int) -> Data {
        Data([UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)])
    }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`macos/GenImgLook/Tests/PNGTextTests.swift`:

```swift
import XCTest

final class PNGTextTests: XCTestCase {
    func testReadsDimensionsAndTEXt() {
        let data = PNGBuilder.png(width: 512, height: 768, chunks: [PNGBuilder.tEXt("parameters", "a dog\nSteps: 12")])
        XCTAssertEqual(PNGText.read(data), PNGText(width: 512, height: 768, texts: ["parameters": "a dog\nSteps: 12"]))
    }

    func testReadsZTXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.zTXt("prompt", #"{"a":1}"#)])
        XCTAssertEqual(PNGText.read(data)?.texts["prompt"], #"{"a":1}"#)
    }

    func testReadsUncompressedJapaneseITXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.iTXt("parameters", "猫、桜", compressed: false)])
        XCTAssertEqual(PNGText.read(data)?.texts["parameters"], "猫、桜")
    }

    func testReadsCompressedJapaneseITXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.iTXt("parameters", "猫、桜", compressed: true)])
        XCTAssertEqual(PNGText.read(data)?.texts["parameters"], "猫、桜")
    }

    func testRejectsNonPNG() {
        XCTAssertNil(PNGText.read(Data("not a png".utf8)))
    }

}
```

次の2件も同じファイルの `PNGTextTests` クラス内に追加する:

```swift
    func testIgnoresTextAfterIDAT() {
        var data = PNGBuilder.png(width: 1, height: 1, chunks: [])
        let iendLength = 12
        let iend = data.suffix(iendLength)
        data.removeLast(iendLength)
        let (type, body) = PNGBuilder.tEXt("late", "x")
        var late = Data([0, 0, 0, UInt8(body.count)])
        late.append(type.data(using: .ascii)!); late.append(body); late.append(contentsOf: [0, 0, 0, 0])
        data.append(late); data.append(iend)
        XCTAssertEqual(PNGText.read(data)?.texts, [:])
    }
```

```swift
    func testTruncatedChunkReturnsWhatWasRead() {
        let full = PNGBuilder.png(width: 3, height: 4, chunks: [
            PNGBuilder.tEXt("parameters", "ok"),
            ("tEXt", Data(repeating: 0x41, count: 100)),
        ])
        // シグネチャ8 + IHDR 25 + tEXt("parameters","ok") 25 + 2つ目の tEXt の途中まで
        let r = PNGText.read(full.prefix(8 + 25 + 25 + 20))
        XCTAssertEqual(r?.width, 3)
        XCTAssertEqual(r?.texts, ["parameters": "ok"])
    }
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'PNGText' in scope`）

- [ ] **Step 4: 実装する**

`macos/GenImgLook/Shared/Parsing/PNGText.swift`:

```swift
import Foundation

/// PNG の IHDR と、IDAT より前にある tEXt / zTXt / iTXt を読む。
/// A1111 の parameters や ComfyUI の prompt は IDAT 前に書かれる（Rust 側の png クレートと同じ範囲）。
struct PNGText: Equatable {
    let width: Int
    let height: Int
    let texts: [String: String]

    static func read(_ data: Data) -> PNGText? {
        let b = [UInt8](data)
        guard b.count >= 8, b[0..<8].elementsEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) else { return nil }

        var width: Int?
        var height = 0
        var texts: [String: String] = [:]
        var p = 8
        while p + 8 <= b.count {
            let length = be32(b, p)
            let type = String(decoding: b[(p + 4)..<(p + 8)], as: UTF8.self)
            let start = p + 8
            guard length <= b.count - start else { break }
            let body = Array(b[start..<(start + length)])
            switch type {
            case "IHDR" where body.count >= 8:
                width = be32(body, 0)
                height = be32(body, 4)
            case "tEXt", "zTXt", "iTXt":
                if let (k, v) = text(type, body) { texts[k] = v }
            case "IDAT", "IEND":
                p = b.count
                continue
            default:
                break
            }
            p = start + length + 4
        }
        guard let width else { return nil }
        return PNGText(width: width, height: height, texts: texts)
    }

    private static func text(_ type: String, _ body: [UInt8]) -> (String, String)? {
        guard let z = body.firstIndex(of: 0),
              let key = String(bytes: body[..<z], encoding: .isoLatin1) else { return nil }
        let rest = Array(body[(z + 1)...])
        switch type {
        case "tEXt":
            return String(bytes: rest, encoding: .isoLatin1).map { (key, $0) }
        case "zTXt":
            guard rest.count >= 1, let raw = inflate(Array(rest.dropFirst())) else { return nil }
            return String(bytes: raw, encoding: .isoLatin1).map { (key, $0) }
        default: // iTXt: 圧縮フラグ, 圧縮方式, 言語タグ\0, 翻訳キーワード\0, 本文
            guard rest.count >= 2 else { return nil }
            let compressed = rest[0] == 1
            var tail = Array(rest.dropFirst(2))
            for _ in 0..<2 {
                guard let n = tail.firstIndex(of: 0) else { return nil }
                tail = Array(tail[(n + 1)...])
            }
            let bytes = compressed ? inflate(tail) : tail
            return bytes.flatMap { String(bytes: $0, encoding: .utf8) }.map { (key, $0) }
        }
    }

    /// NSData の .zlib は raw deflate を期待するので、zlib ヘッダ2バイトと Adler-32 4バイトを外して渡す。
    private static func inflate(_ zlib: [UInt8]) -> [UInt8]? {
        guard zlib.count > 6 else { return nil }
        let raw = Data(zlib[2..<(zlib.count - 4)]) as NSData
        return (try? raw.decompressed(using: .zlib)).map { [UInt8]($0 as Data) }
    }

    private static func be32(_ b: [UInt8], _ i: Int) -> Int {
        Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3])
    }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 6: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): PNG のテキストチャンク（tEXt/zTXt/iTXt）を読む

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: XMPRating

**Files:**
- Create: `macos/GenImgLook/Shared/Parsing/XMPRating.swift`
- Create: `macos/GenImgLook/Tests/XMPRatingTests.swift`

**Interfaces:**
- Consumes: なし
- Produces:
  ```swift
  enum XMPRating {
      static func parse(_ xml: String) -> Int?          // 0...5 に丸める
      static func readSidecar(for imageURL: URL) -> Int? // 画像.png.xmp → 画像.xmp の順
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`macos/GenImgLook/Tests/XMPRatingTests.swift`（`xmp.rs` の `parse_rating` / `read_rating_sidecar` のテストを移植）:

```swift
import XCTest

final class XMPRatingTests: XCTestCase {
    func testReadsRatingAsElement() {
        let xml = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
            <rdf:Description><xmp:Rating>4</xmp:Rating></rdf:Description>
          </rdf:RDF></x:xmpmeta>
        """
        XCTAssertEqual(XMPRating.parse(xml), 4)
    }

    func testReadsRatingAsAttribute() {
        let xml = #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"/>"#
        XCTAssertEqual(XMPRating.parse(xml), 5)
    }

    func testClampsOutOfRange() {
        let xml = #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="9"/>"#
        XCTAssertEqual(XMPRating.parse(xml), 5)
        XCTAssertEqual(XMPRating.parse(xml.replacingOccurrences(of: "\"9\"", with: "\"-1\"")), 0)
    }

    func testNoRatingReturnsNil() {
        XCTAssertNil(XMPRating.parse("<x>nothing</x>"))
    }

    func testEmptyRatingTagDoesNotLeakIntoSiblingText() {
        XCTAssertNil(XMPRating.parse(#"<root xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Rating/><foo>3</foo></root>"#))
    }

    func testSidecarPrefersSuffixedThenFallsBack() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let img = dir.appendingPathComponent("pic.png")
        let xmp = { (r: Int) in #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="\#(r)"/>"# }

        XCTAssertNil(XMPRating.readSidecar(for: img))
        try xmp(2).write(to: dir.appendingPathComponent("pic.xmp"), atomically: true, encoding: .utf8)
        XCTAssertEqual(XMPRating.readSidecar(for: img), 2)
        try xmp(3).write(to: dir.appendingPathComponent("pic.png.xmp"), atomically: true, encoding: .utf8)
        XCTAssertEqual(XMPRating.readSidecar(for: img), 3)
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'XMPRating' in scope`）

- [ ] **Step 3: 実装する**

`macos/GenImgLook/Shared/Parsing/XMPRating.swift`:

```swift
import Foundation

enum XMPRating {
    static func parse(_ xml: String) -> Int? {
        guard let data = xml.data(using: .utf8) else { return nil }
        let delegate = Delegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.rating.map { min(max($0, 0), 5) }
    }

    static func readSidecar(for imageURL: URL) -> Int? {
        let candidates = [
            URL(fileURLWithPath: imageURL.path + ".xmp"),
            imageURL.deletingPathExtension().appendingPathExtension("xmp"),
        ]
        for url in candidates {
            if let xml = try? String(contentsOf: url, encoding: .utf8), let r = parse(xml) { return r }
        }
        return nil
    }

    /// 名前空間処理を無効にしているため、要素名・属性名は "xmp:Rating" の修飾名のまま届く。
    private final class Delegate: NSObject, XMLParserDelegate {
        var rating: Int?
        private var inRating = false
        private var buffer = ""

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            if let v = attributes["xmp:Rating"], let r = Int(v.trimmingCharacters(in: .whitespaces)) {
                rating = r
                parser.abortParsing()
                return
            }
            if name == "xmp:Rating" { inRating = true; buffer = "" }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            if inRating { buffer += string }
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            guard name == "xmp:Rating" else { return }
            inRating = false
            if let r = Int(buffer.trimmingCharacters(in: .whitespacesAndNewlines)) {
                rating = r
                parser.abortParsing()
            }
        }
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): サイドカー XMP からレーティングを読む

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ImageMetadata

**Files:**
- Create: `macos/GenImgLook/Shared/Parsing/ImageMetadata.swift`
- Create: `macos/GenImgLook/Tests/ImageMetadataTests.swift`

**Interfaces:**
- Consumes: `PNGText.read(_:)`、`A1111Parser.parse(_:)`、`ComfyParser.extractText(_:)`、`XMPRating.readSidecar(for:)`、テストでは `PNGBuilder`
- Produces:
  ```swift
  struct ImageMetadata: Equatable {
      var filename: String; var width: Int; var height: Int
      var sourceTool: String               // "a1111" / "comfyui" / "unknown"
      var positive: String?; var negative: String?; var rawParameters: String?
      var model: String?; var sampler: String?
      var steps: Int?; var seed: Int?; var cfg: Double?
      var rating: Int?
      var hasGenerationInfo: Bool { get }  // positive / negative / rawParameters のいずれかがある
      static func load(url: URL) -> ImageMetadata?  // PNG として読めなければ nil
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`macos/GenImgLook/Tests/ImageMetadataTests.swift`:

```swift
import XCTest

final class ImageMetadataTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func write(_ name: String, _ chunks: [(String, Data)]) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try PNGBuilder.png(width: 640, height: 480, chunks: chunks).write(to: url)
        return url
    }

    func testA1111WithRating() throws {
        let url = try write("a.png", [PNGBuilder.tEXt("parameters", "a dog\nNegative prompt: bad\nSteps: 12, Seed: 7, Model: m1")])
        try #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"/>"#
            .write(to: dir.appendingPathComponent("a.png.xmp"), atomically: true, encoding: .utf8)
        let m = try XCTUnwrap(ImageMetadata.load(url: url))
        XCTAssertEqual(m.filename, "a.png")
        XCTAssertEqual(m.width, 640)
        XCTAssertEqual(m.sourceTool, "a1111")
        XCTAssertEqual(m.positive, "a dog")
        XCTAssertEqual(m.negative, "bad")
        XCTAssertEqual(m.steps, 12)
        XCTAssertEqual(m.model, "m1")
        XCTAssertEqual(m.rawParameters, "a dog\nNegative prompt: bad\nSteps: 12, Seed: 7, Model: m1")
        XCTAssertEqual(m.rating, 4)
    }

    func testComfyUI() throws {
        let prompt = #"{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "sunset"}}}"#
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("c.png", [PNGBuilder.tEXt("prompt", prompt)])))
        XCTAssertEqual(m.sourceTool, "comfyui")
        XCTAssertEqual(m.positive, "sunset")
        XCTAssertNil(m.negative)
        XCTAssertEqual(m.rawParameters, prompt)
    }

    func testParametersWinsOverPrompt() throws {
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("b.png", [
            PNGBuilder.tEXt("prompt", "{}"), PNGBuilder.tEXt("parameters", "cat"),
        ])))
        XCTAssertEqual(m.sourceTool, "a1111")
        XCTAssertEqual(m.positive, "cat")
    }

    func testNoMetadata() throws {
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("n.png", [])))
        XCTAssertEqual(m.sourceTool, "unknown")
        XCTAssertEqual(m.height, 480)
        XCTAssertFalse(m.hasGenerationInfo)
        XCTAssertNil(m.rating)
    }

    func testNotPNGReturnsNil() throws {
        let url = dir.appendingPathComponent("x.png")
        try Data("nope".utf8).write(to: url)
        XCTAssertNil(ImageMetadata.load(url: url))
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'ImageMetadata' in scope`）

- [ ] **Step 3: 実装する**

`macos/GenImgLook/Shared/Parsing/ImageMetadata.swift`:

```swift
import Foundation

struct ImageMetadata: Equatable {
    var filename: String
    var width: Int
    var height: Int
    var sourceTool = "unknown"
    var positive: String?
    var negative: String?
    var rawParameters: String?
    var model: String?
    var sampler: String?
    var steps: Int?
    var seed: Int?
    var cfg: Double?
    var rating: Int?

    var hasGenerationInfo: Bool { positive != nil || negative != nil || rawParameters != nil }

    static func load(url: URL) -> ImageMetadata? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe),
              let png = PNGText.read(data) else { return nil }
        var m = ImageMetadata(filename: url.lastPathComponent, width: png.width, height: png.height)
        if let params = png.texts["parameters"] {
            let f = A1111Parser.parse(params)
            m.sourceTool = "a1111"
            m.rawParameters = params
            m.positive = f.positive
            m.negative = f.negative
            m.model = f.model
            m.sampler = f.sampler
            m.steps = f.steps
            m.seed = f.seed
            m.cfg = f.cfg
        } else if let prompt = png.texts["prompt"] {
            m.sourceTool = "comfyui"
            m.rawParameters = prompt
            m.positive = ComfyParser.extractText(prompt)
        }
        m.rating = XMPRating.readSidecar(for: url)
        return m
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): PNG・XMP の解析結果を ImageMetadata にまとめる

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: SwiftUI ビュー（MetadataPanel / PreviewView）

**Files:**
- Create: `macos/GenImgLook/Shared/UI/MetadataPanel.swift`
- Create: `macos/GenImgLook/Shared/UI/PreviewView.swift`

**Interfaces:**
- Consumes: `ImageMetadata`
- Produces:
  ```swift
  struct MetadataPanel: View { init(meta: ImageMetadata) }
  struct PreviewView: View {
      init(image: NSImage, meta: ImageMetadata?, showsInlineToggle: Bool)
  }
  ```
  `PreviewView` はパネルの開閉状態を `@AppStorage("sidePanelVisible")`（既定 `true`）で持つ。`showsInlineToggle == true`（拡張用）のときはパネル上端の「›」と、閉じたときの画像右端「‹」を表示する。アプリはツールバーから同じキーを切り替える。

UI はユニットテストしない（spec の方針）。Task 7・8 で動作確認する。

- [ ] **Step 1: MetadataPanel を書く**

`macos/GenImgLook/Shared/UI/MetadataPanel.swift`:

```swift
import AppKit
import SwiftUI

/// gen-img-manager の `src/components/MetadataPanel.tsx` と同じ並び・挙動。
struct MetadataPanel: View {
    let meta: ImageMetadata
    @State private var maximized: String?

    private struct Block: Identifiable {
        let id: String
        let label: String
        let text: String
    }

    private var blocks: [Block] {
        var b: [Block] = []
        if let p = meta.positive { b.append(Block(id: "prompt", label: "Prompt", text: p)) }
        if let n = meta.negative { b.append(Block(id: "negative", label: "Negative", text: n)) }
        if meta.positive == nil, let raw = meta.rawParameters { b.append(Block(id: "params", label: "Parameters", text: raw)) }
        return b
    }

    var body: some View {
        if let id = maximized, let block = blocks.first(where: { $0.id == id }) {
            blockView(block, isMax: true).padding(12)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(meta.filename).font(.headline).textSelection(.enabled)
                    row("サイズ", "\(meta.width) × \(meta.height)")
                    row("ツール", meta.sourceTool)
                    row("モデル", meta.model)
                    row("サンプラー", meta.sampler)
                    row("Steps", meta.steps.map(String.init))
                    row("CFG", meta.cfg.map { $0.formatted() })
                    row("Seed", meta.seed.map(String.init))
                    if let r = meta.rating, r > 0 { row("レーティング", "★\(r)") }
                    if !meta.hasGenerationInfo {
                        Text("メタデータなし").foregroundStyle(.secondary)
                    }
                    ForEach(blocks) { blockView($0, isMax: false) }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(.secondary).frame(width: 80, alignment: .leading)
                Text(value).textSelection(.enabled)
            }
            .font(.callout)
        }
    }

    private func blockView(_ b: Block, isMax: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(b.label).foregroundStyle(.secondary)
                Spacer()
                Button("コピー") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(b.text, forType: .string)
                }
                .accessibilityLabel("\(b.label)をコピー")
                Button(isMax ? "戻す" : "最大化") { maximized = isMax ? nil : b.id }
            }
            .font(.callout)
            ScrollView {
                Text(b.text)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
            }
            .frame(maxHeight: isMax ? .infinity : 200)
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}
```

- [ ] **Step 2: PreviewView を書く**

`macos/GenImgLook/Shared/UI/PreviewView.swift`:

```swift
import AppKit
import SwiftUI

struct PreviewView: View {
    let image: NSImage
    let meta: ImageMetadata?
    /// Quick Look パネルにはツールバーを足せないため、拡張ではパネル内に開閉ボタンを置く
    let showsInlineToggle: Bool

    @AppStorage("sidePanelVisible") private var panelVisible = true

    var body: some View {
        HStack(spacing: 0) {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .trailing) {
                    if showsInlineToggle && !panelVisible {
                        Button("‹") { panelVisible = true }.padding(8)
                    }
                }
            if panelVisible, let meta {
                Divider()
                VStack(spacing: 0) {
                    if showsInlineToggle {
                        HStack { Spacer(); Button("›") { panelVisible = false } }.padding([.top, .horizontal], 8)
                    }
                    MetadataPanel(meta: meta)
                }
                .frame(width: 320)
            }
        }
    }
}
```

- [ ] **Step 3: ビルドが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`（UI は未使用だがアプリ・拡張ターゲットのコンパイルが通る）

- [ ] **Step 4: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): 画像とメタデータのサイドパネルを表示する SwiftUI ビューを追加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ビューアアプリ（DocumentGroup・ツールバー）

**Files:**
- Modify: `macos/GenImgLook/App/GenImgLookApp.swift`（Task 1 の仮実装を全置換）

**Interfaces:**
- Consumes: `PreviewView(image:meta:showsInlineToggle:)`、`ImageMetadata.load(url:)`
- Produces: PNG を開ける `GenImgLook.app`

- [ ] **Step 1: 実装する**

`macos/GenImgLook/App/GenImgLookApp.swift`:

```swift
import AppKit
import SwiftUI
import UniformTypeIdentifiers

@main
struct GenImgLookApp: App {
    var body: some Scene {
        DocumentGroup(viewing: PNGDocument.self) { file in
            if let url = file.fileURL {
                ViewerView(url: url)
            } else {
                Text("開けません")
            }
        }
    }
}

/// 表示は URL から直接読む（サイドカー XMP の探索に URL が要るため）。ドキュメントは開く操作の受け口だけを担う。
struct PNGDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.png] }
    init(configuration: ReadConfiguration) throws {}
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        throw CocoaError(.featureUnsupported)
    }
}

struct ViewerView: View {
    let url: URL
    private let image: NSImage?
    private let meta: ImageMetadata?
    @AppStorage("sidePanelVisible") private var panelVisible = true

    init(url: URL) {
        self.url = url
        image = NSImage(contentsOf: url)
        meta = ImageMetadata.load(url: url)
    }

    var body: some View {
        Group {
            if let image {
                PreviewView(image: image, meta: meta, showsInlineToggle: false)
            } else {
                Text("開けません").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 700, minHeight: 450)
        .toolbar {
            ShareLink(item: url)
            Button("プレビューで開く", systemImage: "eye") {
                NSWorkspace.shared.open(
                    [url],
                    withApplicationAt: URL(fileURLWithPath: "/System/Applications/Preview.app"),
                    configuration: NSWorkspace.OpenConfiguration()
                )
            }
            Button("サイドパネル", systemImage: "sidebar.right") { panelVisible.toggle() }
        }
    }
}
```

- [ ] **Step 2: ビルドとテスト**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 3: 手動で確認する**

```bash
cd macos/GenImgLook
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -configuration Release -derivedDataPath build build
open -a build/Build/Products/Release/GenImgLook.app <A1111 生成の PNG>
```

確認項目（ユーザーにも依頼する）:
- タイトルバーにファイル名が出る。
- 右パネルに Prompt / Negative / モデル等が出る。「コピー」で貼り付けられる。「最大化」「戻す」が効く。
- ツールバーの共有・プレビューで開く・サイドパネル開閉が効く。アプリを再起動してもパネルの開閉状態が保たれる。
- メタデータの無い PNG で「メタデータなし」が出る。

- [ ] **Step 4: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): PNG ビューアアプリ（共有・プレビューで開く・パネル開閉）を実装

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Quick Look 拡張と README

**Files:**
- Modify: `macos/GenImgLook/Preview/PreviewViewController.swift`（Task 1 の仮実装を全置換）
- Create: `macos/GenImgLook/README.md`

**Interfaces:**
- Consumes: `PreviewView(image:meta:showsInlineToggle:)`、`ImageMetadata.load(url:)`
- Produces: Finder の Quick Look で動く `GenImgLookPreview.appex`

- [ ] **Step 1: 実装する**

`macos/GenImgLook/Preview/PreviewViewController.swift`:

```swift
import Cocoa
import QuickLookUI
import SwiftUI

final class PreviewViewController: NSViewController, QLPreviewingController {
    override func loadView() { view = NSView() }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        // 画像を表示できないときはエラーを返し、OS 標準のプレビューに任せる
        guard let image = NSImage(contentsOf: url) else {
            handler(CocoaError(.fileReadCorruptFile))
            return
        }
        let host = NSHostingView(rootView: PreviewView(image: image, meta: ImageMetadata.load(url: url), showsInlineToggle: true))
        host.frame = view.bounds
        host.autoresizingMask = [.width, .height]
        view.addSubview(host)
        preferredContentSize = NSSize(width: 1100, height: 750)
        handler(nil)
    }
}
```

- [ ] **Step 2: README を書く**

`macos/GenImgLook/README.md`:

````markdown
# GenImgLook

AI 生成 PNG の画像とメタデータ（Prompt / Negative / モデル等・XMP レーティング）を表示する macOS アプリと Quick Look 拡張です。Prompt / Negative をコピーできます。

## 必要なもの

- macOS 14 以上、Xcode
- xcodegen（`brew install xcodegen`）

## ビルドとテスト

```bash
cd macos/GenImgLook
xcodegen generate
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -configuration Release -derivedDataPath build build
```

## インストール

```bash
mkdir -p ~/Applications
rm -rf ~/Applications/GenImgLook.app
cp -R build/Build/Products/Release/GenImgLook.app ~/Applications/
open ~/Applications/GenImgLook.app   # 初回起動で Quick Look 拡張が登録される
qlmanage -r && qlmanage -r cache
```

登録の確認:

```bash
pluginkit -m -v -p com.apple.quicklook.preview | grep GenImgLook
```

Finder で PNG を選んでスペースキーを押すと表示されます。`qlmanage -p <file.png>` でも確認できます。

## 使い方

- 右のサイドパネルにファイル名・サイズ・ツール・モデル・サンプラー・Steps・CFG・Seed・レーティングを表示します。
- Prompt / Negative（Prompt が無い場合は Parameters）の「コピー」でクリップボードにコピーし、「最大化」でパネル全体に表示します。
- レーティングは `画像.png.xmp`、無ければ `画像.xmp` の `xmp:Rating` から読みます（表示のみ）。
- パネルは、アプリではツールバー、Quick Look ではパネル上端の「›」と画像右端の「‹」で開閉します。開閉状態は記憶されます。

## 制限

- 対象は PNG のみです。
- ad-hoc 署名のローカルビルドを前提にしています。他の Mac への配布は想定していません。
- Quick Look 拡張は、サイドカー XMP を読むためにサンドボックス例外（読み取り専用）を使っています。
````

- [ ] **Step 3: ビルドとテスト**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 4: インストールして手動で確認する**

README の「インストール」手順を実行し、`pluginkit` の出力に `local.genimgmanager.GenImgLook.GenImgLookPreview` が出ることを確認する。`qlmanage -p <A1111 の PNG>` で画像とパネルが出ることを確認する。

ユーザーに Finder での確認を依頼する:
- スペースキーで画像とサイドパネルが出る。タイトルバーにファイル名、共有、「プレビューで開く」が出る（OS 標準）。
- 「コピー」「最大化」「›」「‹」が効く。Quick Look を開き直しても開閉状態が保たれる。
- `.xmp` のある画像でレーティングが出る。

- [ ] **Step 5: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): Quick Look 拡張で画像とメタデータパネルを表示する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
