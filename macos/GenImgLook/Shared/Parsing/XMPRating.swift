import Foundation

enum XMPRating {
    static func parse(_ xml: String) -> Int? {
        guard let data = xml.data(using: .utf8) else { return nil }
        let delegate = Delegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.rating.map { min(max($0, 0), 5) }
    }

    static func readSidecar(for imageURL: URL) -> Int? {
        let candidates = [
            URL(fileURLWithPath: imageURL.path + ".xmp"),
            imageURL.deletingPathExtension().appendingPathExtension("xmp"),
        ]
        for url in candidates {
            if let xml = try? String(contentsOf: url, encoding: .utf8), let r = parse(xml) { return r }
        }
        return nil
    }

    /// 名前空間処理を無効にしているため、要素名・属性名は "xmp:Rating" の修飾名のまま届く。
    private final class Delegate: NSObject, XMLParserDelegate {
        var rating: Int?
        private var inRating = false
        private var buffer = ""

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            if let v = attributes["xmp:Rating"], let r = Int(v.trimmingCharacters(in: .whitespaces)) {
                rating = r
                parser.abortParsing()
                return
            }
            if name == "xmp:Rating" { inRating = true; buffer = "" }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            if inRating { buffer += string }
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            guard name == "xmp:Rating" else { return }
            inRating = false
            if let r = Int(buffer.trimmingCharacters(in: .whitespacesAndNewlines)) {
                rating = r
                parser.abortParsing()
            }
        }
    }
}
