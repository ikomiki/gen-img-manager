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
