# GenImgLook 複数ファイル表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GenImgLook で、複数 PNG を1ウィンドウにまとめて左サイドバーとキー操作で切り替え、ドラッグ&ドロップで表示内容を差し替えられるようにする。

**Architecture:** `DocumentGroup` をやめ、`AppDelegate` が `NSWindow` + `NSHostingController` でウィンドウを作る。ファイルの選別・並び・移動は純粋な値型 `FileList` に切り出して XCTest で検証し、`ViewerView` はそれを `@State` で持って表示・D&D・キー操作をつなぐ。

**Tech Stack:** Swift 5 / SwiftUI / AppKit / QuickLookThumbnailing / XCTest / xcodegen（macOS 14.0 以上）

**Spec:** `docs/superpowers/specs/2026-10-07-gen-img-look-multifile-design.md`

## Global Constraints

- 対象は PNG のみ。フォルダや PNG 以外のファイルは無視する。
- キー操作は修飾キーなしの完全一致（`keyboardShortcut(_, modifiers: [])`）のときだけ反応させる。
- Space ではウィンドウを閉じない。Esc で閉じる。
- 外部 Swift パッケージは追加しない。
- 既存の `Shared/Parsing/`、`Shared/UI/PreviewView.swift`、`Shared/UI/MetadataPanel.swift` は変更しない。
- コードコメントは非自明な WHY だけ。コミットは type/scope 英語＋日本語本文、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 作業ブランチ `feature/gen-img-look-multifile`。コミット前に `git branch --show-current` と `git status` を確認する。

## Review Focus

1. Finder から PNG と PNG 以外を混ぜて開いた場合、PNG だけが1ウィンドウにまとまること（Task 1 の振り分けテストで担保、Task 2 で実機確認）。
2. 存在しないパスやフォルダが渡された場合に落ちず、除外されること（Task 1 にテストあり）。
3. 1ファイルのときにサイドバーが出ず、2ファイル以上で出ること（Task 2 で実機確認）。
4. 端でのキー操作で範囲外アクセスしないこと（Task 1 にテストあり）。
5. ファイル名の数字が自然順（`2.png` が `10.png` より前）に並ぶこと（Task 1 にテストあり）。

## File Structure

```
macos/GenImgLook/
  project.yml                       テストターゲットに Shared/Model を追加
  Shared/Model/FileList.swift       PNG の選別・並び・現在位置の移動（純粋ロジック）
  App/GenImgLookApp.swift           App 定義（メニュー）＋ AppDelegate（ウィンドウ生成）
  App/ViewerView.swift              サイドバー・画像・D&D・キー操作・非同期読み込み
  Tests/FileListTests.swift
  README.md                         使い方の更新
```

テスト実行（`macos/GenImgLook/` で）:

```bash
xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test
```

---

### Task 1: FileList

**Files:**
- Create: `macos/GenImgLook/Shared/Model/FileList.swift`
- Create: `macos/GenImgLook/Tests/FileListTests.swift`
- Modify: `macos/GenImgLook/project.yml`（`GenImgLookTests` の `sources`）

**Interfaces:**
- Consumes: なし
- Produces:
  ```swift
  struct FileList: Equatable {
      enum Move { case previous, next, first, last }
      private(set) var urls: [URL]
      private(set) var index: Int
      init?(_ candidates: [URL])        // PNG だけを自然順に。無ければ nil
      var current: URL { get }
      mutating func move(_ move: Move)  // 端で止まる
      mutating func select(_ url: URL)  // リストに無ければ何もしない
  }
  ```

- [ ] **Step 1: テストターゲットに `Shared/Model` を追加する**

`project.yml` の `GenImgLookTests` を次のようにする:

```yaml
  GenImgLookTests:
    type: bundle.unit-test
    platform: macOS
    sources: [Tests, Shared/Parsing, Shared/Model]
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
```

- [ ] **Step 2: 失敗するテストを書く**

`macos/GenImgLook/Tests/FileListTests.swift`:

```swift
import XCTest

final class FileListTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func file(_ name: String) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try Data().write(to: url)
        return url
    }

    private func names(_ list: FileList?) -> [String] {
        list?.urls.map(\.lastPathComponent) ?? []
    }

    func testKeepsOnlyPNGFilesInNaturalOrder() throws {
        let folder = dir.appendingPathComponent("sub.png")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let list = FileList([
            try file("10.png"), try file("b.jpg"), try file("2.png"), try file("A.PNG"), folder,
            dir.appendingPathComponent("missing.png"),
        ])
        XCTAssertEqual(names(list), ["2.png", "10.png", "A.PNG"])
        XCTAssertEqual(list?.current.lastPathComponent, "2.png")
    }

    func testReturnsNilWithoutPNG() throws {
        XCTAssertNil(FileList([try file("a.jpg")]))
        XCTAssertNil(FileList([]))
    }

    func testMoveStopsAtEnds() throws {
        var list = try XCTUnwrap(FileList([try file("1.png"), try file("2.png"), try file("3.png")]))
        list.move(.previous)
        XCTAssertEqual(list.index, 0)
        list.move(.next); list.move(.next); list.move(.next)
        XCTAssertEqual(list.index, 2)
        list.move(.first)
        XCTAssertEqual(list.index, 0)
        list.move(.last)
        XCTAssertEqual(list.current.lastPathComponent, "3.png")
    }

    func testSelect() throws {
        let b = try file("b.png")
        var list = try XCTUnwrap(FileList([try file("a.png"), b]))
        list.select(b)
        XCTAssertEqual(list.index, 1)
        list.select(dir.appendingPathComponent("other.png"))
        XCTAssertEqual(list.index, 1)
    }
}
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: コンパイルエラー（`cannot find 'FileList' in scope`）

- [ ] **Step 4: 実装する**

`macos/GenImgLook/Shared/Model/FileList.swift`:

```swift
import Foundation
import UniformTypeIdentifiers

/// 1ウィンドウで表示する PNG の並びと、表示中の位置。
struct FileList: Equatable {
    enum Move { case previous, next, first, last }

    private(set) var urls: [URL]
    private(set) var index = 0

    init?(_ candidates: [URL]) {
        // Finder がアプリへ渡す順は選択順とは限らないため、ファイル名の自然順に揃える
        let pngs = candidates.filter(Self.isPNGFile).sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        guard !pngs.isEmpty else { return nil }
        urls = pngs
    }

    var current: URL { urls[index] }

    mutating func move(_ move: Move) {
        switch move {
        case .previous: index = max(index - 1, 0)
        case .next: index = min(index + 1, urls.count - 1)
        case .first: index = 0
        case .last: index = urls.count - 1
        }
    }

    mutating func select(_ url: URL) {
        if let i = urls.firstIndex(of: url) { index = i }
    }

    private static func isPNGFile(_ url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .contentTypeKey]) else { return false }
        return values.isDirectory != true && values.contentType?.conforms(to: .png) == true
    }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`（既存29件＋4件）

- [ ] **Step 6: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): 表示する PNG の並びと位置を扱う FileList を追加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ウィンドウ管理・サイドバー・D&D・キー操作

**Files:**
- Modify: `macos/GenImgLook/App/GenImgLookApp.swift`（全置換）
- Create: `macos/GenImgLook/App/ViewerView.swift`
- Modify: `macos/GenImgLook/README.md`（「使い方」）

**Interfaces:**
- Consumes: `FileList`（Task 1）、`PreviewView(image:meta:)`、`ImageMetadata.load(url:)`
- Produces: `AppDelegate.openWindow(_ list: FileList?)`、`AppDelegate.showOpenPanel()`、`ViewerView(list: FileList?, openPanel: @escaping () -> Void)`

- [ ] **Step 1: App と AppDelegate を書く**

`macos/GenImgLook/App/GenImgLookApp.swift`（全置換。旧 `PNGDocument` / `ViewerView` は削除）:

```swift
import AppKit
import SwiftUI
import UniformTypeIdentifiers

@main
struct GenImgLookApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // ウィンドウは AppDelegate が作る。メニューを載せるためだけのシーン
        Settings { EmptyView() }
            .commands {
                CommandGroup(replacing: .appSettings) {}
                CommandGroup(replacing: .newItem) {
                    Button("開く…") { appDelegate.showOpenPanel() }.keyboardShortcut("o")
                }
            }
    }
}

/// Finder から同時に開かれた複数ファイルは application(_:open:) に一括で届くため、
/// 1回の呼び出しを1ウィンドウにまとめる（DocumentGroup では1ファイル1ウィンドウになる）。
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windows: [NSWindow] = []
    private var cascadePoint = NSPoint.zero

    func applicationDidFinishLaunching(_ notification: Notification) {
        // ファイル付き起動では application(_:open:) が先に呼ばれ、ウィンドウが既にある
        if windows.isEmpty { openWindow(nil) }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if let list = FileList(urls) {
            openWindow(list)
        } else if windows.isEmpty {
            openWindow(nil)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openWindow(nil) }
        return true
    }

    func showOpenPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.png]
        guard panel.runModal() == .OK, let list = FileList(panel.urls) else { return }
        openWindow(list)
    }

    func openWindow(_ list: FileList?) {
        let host = NSHostingController(rootView: ViewerView(list: list, openPanel: { [weak self] in self?.showOpenPanel() }))
        host.sceneBridgingOptions = [.title, .toolbars]
        let window = NSWindow(contentViewController: host)
        window.styleMask.insert(.fullSizeContentView)
        window.setContentSize(NSSize(width: 1100, height: 720))
        window.isReleasedWhenClosed = false
        cascadePoint = window.cascadeTopLeft(from: cascadePoint)
        windows.append(window)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                self?.windows.removeAll { $0 === note.object as? NSWindow }
            }
        }
        window.makeKeyAndOrderFront(nil)
    }
}
```

- [ ] **Step 2: ViewerView を書く**

`macos/GenImgLook/App/ViewerView.swift`:

```swift
import AppKit
import QuickLookThumbnailing
import SwiftUI

struct ViewerView: View {
    @State var list: FileList?
    let openPanel: () -> Void

    private struct Loaded {
        let url: URL
        let image: NSImage?
        let meta: ImageMetadata?
    }

    @State private var loaded: Loaded?
    @AppStorage("sidePanelVisible") private var panelVisible = true

    var body: some View {
        HStack(spacing: 0) {
            if let list, list.urls.count > 1 {
                FileSidebar(urls: list.urls, selection: Binding(
                    get: { self.list?.current },
                    set: { url in if let url { self.list?.select(url) } }
                ))
                .frame(width: 180)
                Divider()
            }
            content
        }
        .frame(minWidth: 700, minHeight: 450)
        .navigationTitle(list?.current.lastPathComponent ?? "GenImgLook")
        .toolbar {
            if let url = list?.current {
                ShareLink(item: url)
                Button("プレビューで開く", systemImage: "eye") {
                    NSWorkspace.shared.open(
                        [url],
                        withApplicationAt: URL(fileURLWithPath: "/System/Applications/Preview.app"),
                        configuration: NSWorkspace.OpenConfiguration()
                    )
                }
            }
            Button("サイドパネル", systemImage: "sidebar.right") { panelVisible.toggle() }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let dropped = FileList(urls) else { return false }
            list = dropped
            return true
        }
        .task(id: list?.current) {
            guard let url = list?.current else { return }
            // NAS 上のファイルでも UI を止めないよう、デコードと解析をメインスレッド外で行う
            let result = await Task.detached { (NSImage(contentsOf: url), ImageMetadata.load(url: url)) }.value
            if list?.current == url { loaded = Loaded(url: url, image: result.0, meta: result.1) }
        }
        .background { keyHandlers }
    }

    @ViewBuilder
    private var content: some View {
        if list == nil {
            VStack(spacing: 12) {
                Text("PNG をここにドロップ").font(.title3).foregroundStyle(.secondary)
                Button("開く…", action: openPanel)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loaded {
            if let image = loaded.image {
                PreviewView(image: image, meta: loaded.meta).id(loaded.url)
            } else {
                Text("開けません").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// 修飾キーなしの完全一致に限定し、Shift+矢印などのテキスト選択操作を奪わない
    private var keyHandlers: some View {
        Group {
            key(.upArrow) { list?.move(.previous) }
            key(.leftArrow) { list?.move(.previous) }
            key(.downArrow) { list?.move(.next) }
            key(.rightArrow) { list?.move(.next) }
            key(.home) { list?.move(.first) }
            key(.end) { list?.move(.last) }
            key(.escape) { NSApp.keyWindow?.performClose(nil) }
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    private func key(_ key: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button("", action: action).keyboardShortcut(key, modifiers: [])
    }
}

private struct FileSidebar: View {
    let urls: [URL]
    @Binding var selection: URL?

    var body: some View {
        ScrollViewReader { proxy in
            List(urls, id: \.self, selection: $selection) { url in
                VStack(spacing: 4) {
                    Thumbnail(url: url)
                    Text(url.lastPathComponent).font(.caption).lineLimit(1).truncationMode(.middle)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            .onChange(of: selection) { _, url in
                if let url { withAnimation { proxy.scrollTo(url) } }
            }
        }
    }
}

private struct Thumbnail: View {
    let url: URL
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
            } else {
                Color.secondary.opacity(0.1)
            }
        }
        .frame(width: 140, height: 100)
        .task(id: url) {
            let request = QLThumbnailGenerator.Request(
                fileAt: url, size: CGSize(width: 140, height: 100),
                scale: NSScreen.main?.backingScaleFactor ?? 2, representationTypes: .thumbnail
            )
            image = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).nsImage
        }
    }
}
```

- [ ] **Step 3: README の「使い方」を更新する**

`macos/GenImgLook/README.md` の「使い方」の次の行を置き換える:

- `- Space または Esc でウィンドウを閉じます。` → `- Esc でウィンドウを閉じます。`

「使い方」の末尾に次を追加する:

```markdown
- Finder で複数の PNG を選んで開くと、1つのウィンドウにまとまり、左サイドバーにサムネイル付きの一覧が出ます。
- ↑ / ← で前、↓ / → で次、Home で先頭、End で末尾のファイルを表示します（修飾キーなしのとき）。
- ウィンドウに PNG をドラッグ&ドロップすると、一覧をドロップしたファイルに置き換えます。PNG 以外とフォルダは無視します。
- 「ファイル > 開く…」（Cmd+O）で選んだファイルを新しいウィンドウで開きます。
```

- [ ] **Step 4: ビルドとテスト**

Run: `cd macos/GenImgLook && xcodegen generate && xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: 実機で確認する（スクリーンショットは撮らない）**

試験用 PNG を scratchpad に3つ用意し（中身は Task 7 の sample.png と同じ生成方法）、Release ビルドで次を確認する。ウィンドウ数とタイトルは `osascript` の System Events で読む。

```bash
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -configuration Release -derivedDataPath build build
open -a "$PWD/build/Build/Products/Release/GenImgLook.app" <a.png> <b.png> <c.png>
osascript -e 'tell application "System Events" to tell process "GenImgLook" to get name of every window'
```

Expected:
- ウィンドウが1つで、タイトルが先頭のファイル名。
- `key code 125`（↓）でタイトルが次のファイル名に、`key code 119`（End）で末尾、`key code 115`（Home）で先頭に変わる。
- `key code 49`（Space）でウィンドウ数が変わらない。`key code 53`（Esc）で閉じる。
- 1ファイルだけ開いたウィンドウではサイドバーが出ない（ユーザー確認）。
- ドラッグ&ドロップ、サムネイル、Cmd+O、Dock アイコンへのドロップはユーザーに確認を依頼する。

- [ ] **Step 6: コミットする**

```bash
git add macos/GenImgLook
git commit -m "feat(look): 複数ファイルを1ウィンドウで切り替え、ドラッグ&ドロップで表示を差し替える

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
