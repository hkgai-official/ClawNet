import SwiftUI
import AppKit

/// Renders an image message with thumbnail preview and fullscreen viewer.
struct ImageMessageView: View {
    @Environment(AppState.self) private var appState
    let content: MessageContent
    let isUser: Bool
    @State private var showFullscreen = false
    @State private var authenticatedImageURL: URL?
    @State private var localImage: NSImage?

    private var isLocalFile: Bool {
        content.url?.hasPrefix("file://") == true
    }

    var body: some View {
        Button(action: { showFullscreen = true }) {
            Group {
                if let localImage {
                    Image(nsImage: localImage)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } else if let url = authenticatedImageURL {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        case .failure:
                            imagePlaceholder(icon: "exclamationmark.triangle", text: L.loadFailed)
                        case .empty:
                            ProgressView()
                                .frame(width: 160, height: 120)
                        @unknown default:
                            imagePlaceholder(icon: "photo", text: L.image)
                        }
                    }
                } else {
                    imagePlaceholder(icon: "photo", text: content.name ?? L.image)
                }
            }
            .frame(maxWidth: 240, maxHeight: 180)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showFullscreen) {
            ImageViewerOverlay(content: content, authenticatedURL: authenticatedImageURL, localImage: localImage, isPresented: $showFullscreen)
                .frame(minWidth: 600, minHeight: 500)
        }
        .task {
            await resolveAuthenticatedURL()
        }
    }

    private func resolveAuthenticatedURL() async {
        // Try explicit URL first, then fall back to file ID preview URL
        let url: URL
        if let urlString = content.url ?? content.thumbnailUrl,
           let parsed = URL(string: urlString) {
            url = parsed
        } else if let fileId = content.id,
                  let api = appState.api {
            url = await api.filePreviewURL(id: fileId)
        } else {
            return
        }

        if url.isFileURL {
            localImage = NSImage(contentsOf: url)
            return
        }

        if let api = appState.api {
            authenticatedImageURL = await api.authenticatedURL(for: url) ?? url
        } else {
            authenticatedImageURL = url
        }
    }

    private func imagePlaceholder(icon: String, text: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: 160, height: 120)
        .background(.secondary.opacity(0.1))
    }
}

/// Fullscreen image viewer with zoom and rotate controls.
struct ImageViewerOverlay: View {
    let content: MessageContent
    let authenticatedURL: URL?
    var localImage: NSImage?
    @Binding var isPresented: Bool
    @State private var scale: CGFloat = 1.0
    @State private var rotation: Angle = .zero

    var body: some View {
        ZStack {
            Color.black.opacity(0.85)
                .ignoresSafeArea()
                .onTapGesture { isPresented = false }

            if let localImage {
                Image(nsImage: localImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(scale)
                    .rotationEffect(rotation)
                    .animation(.easeInOut(duration: 0.2), value: scale)
                    .animation(.easeInOut(duration: 0.2), value: rotation)
                    .padding(40)
            } else if let url = authenticatedURL {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .scaleEffect(scale)
                            .rotationEffect(rotation)
                            .animation(.easeInOut(duration: 0.2), value: scale)
                            .animation(.easeInOut(duration: 0.2), value: rotation)
                    } else {
                        ProgressView()
                            .tint(.white)
                    }
                }
                .padding(40)
            }

            // Toolbar
            VStack {
                HStack {
                    Spacer()
                    HStack(spacing: 12) {
                        toolbarButton("minus.magnifyingglass") {
                            scale = max(0.25, scale - 0.25)
                        }
                        toolbarButton("plus.magnifyingglass") {
                            scale = min(3.0, scale + 0.25)
                        }
                        toolbarButton("rotate.right") {
                            rotation += .degrees(90)
                        }
                        toolbarButton("xmark") {
                            isPresented = false
                        }
                    }
                    .padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding()
                }
                Spacer()
            }
        }
        .onExitCommand { isPresented = false }
    }

    private func toolbarButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 28, height: 28)
                .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
    }
}
