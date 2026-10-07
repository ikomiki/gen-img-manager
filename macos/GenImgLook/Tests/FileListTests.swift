import XCTest

final class FileListTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func file(_ name: String) throws -> URL {
        let url = dir.appendingPathComponent(name)
        try Data().write(to: url)
        return url
    }

    private func names(_ list: FileList?) -> [String] {
        list?.urls.map(\.lastPathComponent) ?? []
    }

    func testKeepsOnlyPNGFilesInNaturalOrder() throws {
        let folder = dir.appendingPathComponent("sub.png")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let list = FileList([
            try file("10.png"), try file("b.jpg"), try file("2.png"), try file("A.PNG"), folder,
            dir.appendingPathComponent("missing.png"),
        ])
        XCTAssertEqual(names(list), ["2.png", "10.png", "A.PNG"])
        XCTAssertEqual(list?.current.lastPathComponent, "2.png")
    }

    func testReturnsNilWithoutPNG() throws {
        XCTAssertNil(FileList([try file("a.jpg")]))
        XCTAssertNil(FileList([]))
    }

    func testMoveStopsAtEnds() throws {
        var list = try XCTUnwrap(FileList([try file("1.png"), try file("2.png"), try file("3.png")]))
        list.move(.previous)
        XCTAssertEqual(list.index, 0)
        list.move(.next); list.move(.next); list.move(.next)
        XCTAssertEqual(list.index, 2)
        list.move(.first)
        XCTAssertEqual(list.index, 0)
        list.move(.last)
        XCTAssertEqual(list.current.lastPathComponent, "3.png")
    }

    func testSelect() throws {
        let b = try file("b.png")
        var list = try XCTUnwrap(FileList([try file("a.png"), b]))
        list.select(b)
        XCTAssertEqual(list.index, 1)
        list.select(dir.appendingPathComponent("other.png"))
        XCTAssertEqual(list.index, 1)
    }

    func testDropsDuplicates() throws {
        let a = try file("a.png")
        let list = FileList([a, try file("b.png"), a, URL(fileURLWithPath: a.path)])
        XCTAssertEqual(names(list), ["a.png", "b.png"])
    }
}
