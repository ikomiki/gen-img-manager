import AppKit
import XCTest

final class KeyCommandTests: XCTestCase {
    // 矢印・Home・End のキーイベントは .function / .numericPad を伴って届く
    private let arrowFlags: NSEvent.ModifierFlags = [.function, .numericPad]

    func testPlainNavigationKeys() {
        XCTAssertEqual(KeyCommand(keyCode: 126, modifiers: arrowFlags), .move(.previous))
        XCTAssertEqual(KeyCommand(keyCode: 123, modifiers: arrowFlags), .move(.previous))
        XCTAssertEqual(KeyCommand(keyCode: 125, modifiers: arrowFlags), .move(.next))
        XCTAssertEqual(KeyCommand(keyCode: 124, modifiers: arrowFlags), .move(.next))
        XCTAssertEqual(KeyCommand(keyCode: 115, modifiers: .function), .move(.first))
        XCTAssertEqual(KeyCommand(keyCode: 119, modifiers: .function), .move(.last))
        XCTAssertEqual(KeyCommand(keyCode: 53, modifiers: []), .close)
    }

    func testIgnoresCapsLock() {
        XCTAssertEqual(KeyCommand(keyCode: 125, modifiers: arrowFlags.union(.capsLock)), .move(.next))
    }

    func testRejectsAnyModifier() {
        for extra: NSEvent.ModifierFlags in [.shift, .control, .option, .command] {
            XCTAssertNil(KeyCommand(keyCode: 124, modifiers: arrowFlags.union(extra)))
            XCTAssertNil(KeyCommand(keyCode: 119, modifiers: NSEvent.ModifierFlags.function.union(extra)))
            XCTAssertNil(KeyCommand(keyCode: 53, modifiers: extra))
        }
    }

    func testSpaceDoesNothing() {
        XCTAssertNil(KeyCommand(keyCode: 49, modifiers: []))
    }

    func testMovesYieldToSelectedTextButCloseDoesNot() {
        XCTAssertFalse(KeyCommand.move(.next).applies(whenTextSelected: true))
        XCTAssertTrue(KeyCommand.move(.next).applies(whenTextSelected: false))
        XCTAssertTrue(KeyCommand.close.applies(whenTextSelected: true))
    }
}
