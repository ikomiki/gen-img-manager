import AppKit

/// ビューアのキー操作。修飾キーが完全に無いときだけ成立させ、Shift+矢印などの別操作を奪わない。
enum KeyCommand: Equatable {
    case move(FileList.Move)
    case close

    init?(keyCode: UInt16, modifiers: NSEvent.ModifierFlags) {
        // .function / .numericPad は矢印・Home・End に OS が付ける印で、ユーザーの修飾キーではない
        guard modifiers.intersection([.shift, .control, .option, .command]).isEmpty else { return nil }
        switch keyCode {
        case 126, 123: self = .move(.previous)
        case 125, 124: self = .move(.next)
        case 115: self = .move(.first)
        case 119: self = .move(.last)
        case 53: self = .close
        default: return nil
        }
    }
}
