import Foundation

struct ImageMetadata: Equatable {
    var filename: String
    var width: Int
    var height: Int
    var sourceTool = "unknown"
    var positive: String?
    var negative: String?
    var rawParameters: String?
    var model: String?
    var sampler: String?
    var steps: Int?
    var seed: Int?
    var cfg: Double?
    var rating: Int?

    var hasGenerationInfo: Bool { positive != nil || negative != nil || rawParameters != nil }

    static func load(url: URL) -> ImageMetadata? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe),
              let png = PNGText.read(data) else { return nil }
        var m = ImageMetadata(filename: url.lastPathComponent, width: png.width, height: png.height)
        if let params = png.texts["parameters"] {
            let f = A1111Parser.parse(params)
            m.sourceTool = "a1111"
            m.rawParameters = params
            m.positive = f.positive
            m.negative = f.negative
            m.model = f.model
            m.sampler = f.sampler
            m.steps = f.steps
            m.seed = f.seed
            m.cfg = f.cfg
        } else if let prompt = png.texts["prompt"] {
            m.sourceTool = "comfyui"
            m.rawParameters = prompt
            m.positive = ComfyParser.extractText(prompt)
        }
        m.rating = XMPRating.readSidecar(for: url)
        return m
    }
}
