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
                PreviewView(image: image, meta: meta)
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
        .background {
            // Quick Look と同じ閉じ方。modifiers: [] は完全一致なので Shift+Space 等は奪わない
            Group {
                Button("") { NSApp.keyWindow?.performClose(nil) }.keyboardShortcut(.space, modifiers: [])
                Button("") { NSApp.keyWindow?.performClose(nil) }.keyboardShortcut(.cancelAction)
            }
            .opacity(0)
            .accessibilityHidden(true)
        }
    }
}
