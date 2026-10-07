import AppKit
import SwiftUI

struct PreviewView: View {
    let image: NSImage
    let meta: ImageMetadata?
    @Binding var maximized: String?

    @AppStorage("sidePanelVisible") private var panelVisible = true

    var body: some View {
        HStack(spacing: 0) {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if panelVisible, let meta {
                Divider()
                MetadataPanel(meta: meta, maximized: $maximized).frame(width: 320)
            }
        }
    }
}
