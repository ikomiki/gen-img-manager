import AppKit
import QuickLookThumbnailing
import SwiftUI

/// キー操作（AppDelegate のイベントモニタ）とビューの両方から表示対象を変えるため、ウィンドウごとに共有する。
@Observable
final class ViewerModel {
    var list: FileList?
    var maximizedBlock: String?
    init(list: FileList?) { self.list = list }
}

struct ViewerView: View {
    @Bindable var model: ViewerModel
    let openPanel: () -> Void

    private var list: FileList? { model.list }

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
                    get: { model.list?.current },
                    set: { url in if let url { model.list?.select(url) } }
                ))
                .frame(width: 180)
                Divider()
            }
            content
        }
        .frame(minWidth: 700, minHeight: 450)
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
            model.list = dropped
            return true
        }
        .task(id: list?.current) {
            guard let url = list?.current else { return }
            // キーを押し続けて次々に切り替わる間は読み込みを始めない。Task.detached は .task の
            // キャンセルを引き継がず、NAS では読み込みが積み上がるため、待ってから開始する
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            // NAS 上のファイルでも UI を止めないよう、デコードと解析をメインスレッド外で行う
            let result = await Task.detached { (NSImage(contentsOf: url), ImageMetadata.load(url: url)) }.value
            if list?.current == url { loaded = Loaded(url: url, image: result.0, meta: result.1) }
        }
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
                PreviewView(image: image, meta: loaded.meta, maximized: $model.maximizedBlock).id(loaded.url)
            } else {
                Text("開けません").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
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
            // キー操作は AppDelegate のモニタが一括で扱う。List 自身の Shift+矢印などで選択が動かないようにする
            .focusable(false)
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
