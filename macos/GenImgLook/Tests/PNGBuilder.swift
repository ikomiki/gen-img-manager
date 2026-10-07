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
