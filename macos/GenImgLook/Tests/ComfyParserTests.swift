import XCTest

final class ComfyParserTests: XCTestCase {
    func testExtractsClipTextEncodeNodesInNodeOrder() {
        let json = """
        {"10": {"class_type": "CLIPTextEncode", "inputs": {"text": "second"}},
         "3": {"class_type": "KSampler", "inputs": {"seed": 1}},
         "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "first"}}}
        """
        XCTAssertEqual(ComfyParser.extractText(json), "first\nsecond")
    }

    func testNoTextNodesReturnsNil() {
        XCTAssertNil(ComfyParser.extractText(#"{"3": {"class_type": "KSampler", "inputs": {"seed": 1}}}"#))
    }

    func testInvalidJSONReturnsNil() {
        XCTAssertNil(ComfyParser.extractText("not json"))
    }

    func testWhitespaceOnlyTextIsFiltered() {
        XCTAssertNil(ComfyParser.extractText(#"{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "   "}}}"#))
    }

    func testNonObjectJSONReturnsNil() {
        XCTAssertNil(ComfyParser.extractText("[1, 2, 3]"))
        XCTAssertNil(ComfyParser.extractText("42"))
    }
}
