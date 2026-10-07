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
    private var models: [ObjectIdentifier: ViewerModel] = [:]
    private var cascadePoint = NSPoint.zero

    func applicationDidFinishLaunching(_ notification: Notification) {
        // SwiftUI の keyboardShortcut(_, modifiers: []) は矢印キー等で Shift 付きでも発火するため、
        // キー判定は KeyCommand で修飾キーの完全一致を見る
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let window = event.window,
                  let model = self.models[ObjectIdentifier(window)],
                  let command = KeyCommand(keyCode: event.keyCode, modifiers: event.modifierFlags),
                  // フォーカスの有無で判定すると、テキストを一度クリックした後は矢印で切り替えられなくなる
                  command.applies(whenTextSelected: ((window.firstResponder as? NSTextView)?.selectedRange().length ?? 0) > 0)
            else { return event }
            switch command {
            case .move(let move): model.list?.move(move)
            case .close: window.performClose(nil)
            }
            return nil
        }
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
        let model = ViewerModel(list: list)
        let host = NSHostingController(rootView: ViewerView(model: model, openPanel: { [weak self] in self?.showOpenPanel() }))
        host.sceneBridgingOptions = [.toolbars]
        let window = NSWindow(contentViewController: host)
        window.styleMask.insert(.fullSizeContentView)
        window.setContentSize(NSSize(width: 1100, height: 720))
        window.isReleasedWhenClosed = false
        cascadePoint = window.cascadeTopLeft(from: cascadePoint)
        windows.append(window)
        models[ObjectIdentifier(window)] = model
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let closed = note.object as? NSWindow else { return }
                self?.windows.removeAll { $0 === closed }
                self?.models[ObjectIdentifier(closed)] = nil
            }
        }
        trackTitle(window, model)
        window.makeKeyAndOrderFront(nil)
    }

    /// navigationTitle のブリッジはウィンドウによって反映されず "Untitled" のままになることがあったため、直接設定する
    private func trackTitle(_ window: NSWindow, _ model: ViewerModel) {
        withObservationTracking {
            window.title = model.list?.current.lastPathComponent ?? "GenImgLook"
        } onChange: { [weak self, weak window] in
            Task { @MainActor in
                if let window { self?.trackTitle(window, model) }
            }
        }
    }
}
