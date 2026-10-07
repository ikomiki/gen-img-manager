import XCTest

final class ImageMetadataTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func write(_ name: String, _ chunks: [(String, Data)]) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try PNGBuilder.png(width: 640, height: 480, chunks: chunks).write(to: url)
        return url
    }

    func testA1111WithRating() throws {
        let url = try write("a.png", [PNGBuilder.tEXt("parameters", "a dog\nNegative prompt: bad\nSteps: 12, Seed: 7, Model: m1")])
        try #"<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"/>"#
            .write(to: dir.appendingPathComponent("a.png.xmp"), atomically: true, encoding: .utf8)
        let m = try XCTUnwrap(ImageMetadata.load(url: url))
        XCTAssertEqual(m.filename, "a.png")
        XCTAssertEqual(m.width, 640)
        XCTAssertEqual(m.sourceTool, "a1111")
        XCTAssertEqual(m.positive, "a dog")
        XCTAssertEqual(m.negative, "bad")
        XCTAssertEqual(m.steps, 12)
        XCTAssertEqual(m.model, "m1")
        XCTAssertEqual(m.rawParameters, "a dog\nNegative prompt: bad\nSteps: 12, Seed: 7, Model: m1")
        XCTAssertEqual(m.rating, 4)
    }

    func testComfyUI() throws {
        let prompt = #"{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "sunset"}}}"#
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("c.png", [PNGBuilder.tEXt("prompt", prompt)])))
        XCTAssertEqual(m.sourceTool, "comfyui")
        XCTAssertEqual(m.positive, "sunset")
        XCTAssertNil(m.negative)
        XCTAssertEqual(m.rawParameters, prompt)
    }

    func testParametersWinsOverPrompt() throws {
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("b.png", [
            PNGBuilder.tEXt("prompt", "{}"), PNGBuilder.tEXt("parameters", "cat"),
        ])))
        XCTAssertEqual(m.sourceTool, "a1111")
        XCTAssertEqual(m.positive, "cat")
    }

    func testNoMetadata() throws {
        let m = try XCTUnwrap(ImageMetadata.load(url: try write("n.png", [])))
        XCTAssertEqual(m.sourceTool, "unknown")
        XCTAssertEqual(m.height, 480)
        XCTAssertFalse(m.hasGenerationInfo)
        XCTAssertNil(m.rating)
    }

    func testNotPNGReturnsNil() throws {
        let url = dir.appendingPathComponent("x.png")
        try Data("nope".utf8).write(to: url)
        XCTAssertNil(ImageMetadata.load(url: url))
    }
}
