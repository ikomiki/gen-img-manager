import Foundation
import UniformTypeIdentifiers

/// 1ウィンドウで表示する PNG の並びと、表示中の位置。
struct FileList: Equatable {
    enum Move { case previous, next, first, last }

    private(set) var urls: [URL]
    private(set) var index = 0

    init?(_ candidates: [URL]) {
        // Finder がアプリへ渡す順は選択順とは限らないため、ファイル名の自然順に揃える
        // 同じファイルが重なるとサイドバー（List の id）が重複するため、パスで一意にする
        var seen = Set<String>()
        let unique = candidates.map(\.standardizedFileURL).filter { seen.insert($0.path).inserted }
        let pngs = unique.filter(Self.isPNGFile).sorted {
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
