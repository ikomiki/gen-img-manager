import XCTest

final class A1111ParserTests: XCTestCase {
    func testParsesFullExample() {
        let raw = "masterpiece, 1girl, forest\nNegative prompt: blurry, lowres\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7.5, Seed: 12345, Size: 512x768, Model: sdxl_base"
        let f = A1111Parser.parse(raw)
        XCTAssertEqual(f.positive, "masterpiece, 1girl, forest")
        XCTAssertEqual(f.negative, "blurry, lowres")
        XCTAssertEqual(f.steps, 28)
        XCTAssertEqual(f.sampler, "DPM++ 2M")
        XCTAssertEqual(f.cfg, 7.5)
        XCTAssertEqual(f.seed, 12345)
        XCTAssertEqual(f.model, "sdxl_base")
    }

    func testHandlesMissingNegativePrompt() {
        let f = A1111Parser.parse("a cat\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Model: m")
        XCTAssertEqual(f.positive, "a cat")
        XCTAssertNil(f.negative)
        XCTAssertEqual(f.steps, 20)
    }

    func testHandlesPlainPromptWithoutParams() {
        let f = A1111Parser.parse("just a prompt with no settings")
        XCTAssertEqual(f.positive, "just a prompt with no settings")
        XCTAssertNil(f.steps)
        XCTAssertNil(f.sampler)
    }

    func testMultilinePositivePrompt() {
        let f = A1111Parser.parse("line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9")
        XCTAssertEqual(f.positive, "line one\nline two")
        XCTAssertEqual(f.negative, "bad")
        XCTAssertEqual(f.seed, 9)
    }

    func testSingleLineParamsOnly() {
        let f = A1111Parser.parse("Steps: 5, Seed: 3")
        XCTAssertNil(f.positive)
        XCTAssertEqual(f.steps, 5)
        XCTAssertEqual(f.seed, 3)
    }

    func testCRLFMatchesLF() {
        let lf = "line one\nline two\nNegative prompt: bad\nSteps: 10, Seed: 9"
        let crlf = lf.replacingOccurrences(of: "\n", with: "\r\n")
        XCTAssertEqual(A1111Parser.parse(crlf), A1111Parser.parse(lf))
    }
}
