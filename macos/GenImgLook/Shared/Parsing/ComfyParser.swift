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
