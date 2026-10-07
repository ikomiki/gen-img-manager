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
