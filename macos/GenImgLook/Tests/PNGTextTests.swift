import XCTest

final class PNGTextTests: XCTestCase {
    func testReadsDimensionsAndTEXt() {
        let data = PNGBuilder.png(width: 512, height: 768, chunks: [PNGBuilder.tEXt("parameters", "a dog\nSteps: 12")])
        XCTAssertEqual(PNGText.read(data), PNGText(width: 512, height: 768, texts: ["parameters": "a dog\nSteps: 12"]))
    }

    func testReadsZTXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.zTXt("prompt", #"{"a":1}"#)])
        XCTAssertEqual(PNGText.read(data)?.texts["prompt"], #"{"a":1}"#)
    }

    func testReadsUncompressedJapaneseITXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.iTXt("parameters", "猫、桜", compressed: false)])
        XCTAssertEqual(PNGText.read(data)?.texts["parameters"], "猫、桜")
    }

    func testReadsCompressedJapaneseITXt() {
        let data = PNGBuilder.png(width: 1, height: 1, chunks: [PNGBuilder.iTXt("parameters", "猫、桜", compressed: true)])
        XCTAssertEqual(PNGText.read(data)?.texts["parameters"], "猫、桜")
    }

    func testRejectsNonPNG() {
        XCTAssertNil(PNGText.read(Data("not a png".utf8)))
    }

    func testIgnoresTextAfterIDAT() {
        var data = PNGBuilder.png(width: 1, height: 1, chunks: [])
        let iendLength = 12
        let iend = data.suffix(iendLength)
        data.removeLast(iendLength)
        let (type, body) = PNGBuilder.tEXt("late", "x")
        var late = Data([0, 0, 0, UInt8(body.count)])
        late.append(type.data(using: .ascii)!); late.append(body); late.append(contentsOf: [0, 0, 0, 0])
        data.append(late); data.append(iend)
        XCTAssertEqual(PNGText.read(data)?.texts, [:])
    }

    func testTruncatedChunkReturnsWhatWasRead() {
        let full = PNGBuilder.png(width: 3, height: 4, chunks: [
            PNGBuilder.tEXt("parameters", "ok"),
            ("tEXt", Data(repeating: 0x41, count: 100)),
        ])
        // シグネチャ8 + IHDR 25 + tEXt("parameters","ok") 25 + 2つ目の tEXt の途中まで
        let r = PNGText.read(full.prefix(8 + 25 + 25 + 20))
        XCTAssertEqual(r?.width, 3)
        XCTAssertEqual(r?.texts, ["parameters": "ok"])
    }
}
