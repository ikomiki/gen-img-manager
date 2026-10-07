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
