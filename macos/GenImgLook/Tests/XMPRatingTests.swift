import XCTest

final class XMPRatingTests: XCTestCase {
    func testReadsRatingAsElement() {
        let xml = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
            <rdf:Description><xmp:Rating>4</xmp:Rating></rdf:Description>
          </rdf:RDF></x:xmpmeta>
        """
        XCTAssertEqual(XMPRating.parse(xml), 4)
    }

    func testReadsRatingAsAttribute() {
        let xml = #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"/>"#
        XCTAssertEqual(XMPRating.parse(xml), 5)
    }

    func testClampsOutOfRange() {
        let xml = #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="9"/>"#
        XCTAssertEqual(XMPRating.parse(xml), 5)
        XCTAssertEqual(XMPRating.parse(xml.replacingOccurrences(of: "\"9\"", with: "\"-1\"")), 0)
    }

    func testNoRatingReturnsNil() {
        XCTAssertNil(XMPRating.parse("<x>nothing</x>"))
    }

    func testEmptyRatingTagDoesNotLeakIntoSiblingText() {
        XCTAssertNil(XMPRating.parse(#"<root xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:Rating/><foo>3</foo></root>"#))
    }

    func testSidecarPrefersSuffixedThenFallsBack() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let img = dir.appendingPathComponent("pic.png")
        let xmp = { (r: Int) in #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="\#(r)"/>"# }

        XCTAssertNil(XMPRating.readSidecar(for: img))
        try xmp(2).write(to: dir.appendingPathComponent("pic.xmp"), atomically: true, encoding: .utf8)
        XCTAssertEqual(XMPRating.readSidecar(for: img), 2)
        try xmp(3).write(to: dir.appendingPathComponent("pic.png.xmp"), atomically: true, encoding: .utf8)
        XCTAssertEqual(XMPRating.readSidecar(for: img), 3)
    }
}
