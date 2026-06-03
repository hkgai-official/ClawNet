import SwiftUI
import AVKit

/// Renders a video message with thumbnail and inline/fullscreen playback.
struct VideoMessageView: View {
    let content: MessageContent
    let isUser: Bool
    @State private var showPlayer = false

    var body: some View {
        Button(action: { showPlayer = true }) {
            ZStack {
                if let thumbnailURL = thumbnailURL {
                    AsyncImage(url: thumbnailURL) { phase in
                        if case .success(let image) = phase {
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } else {
                            videoPoster
                        }
                    }
                } else {
                    videoPoster
                }

                // Play button overlay
                Circle()
                    .fill(.black.opacity(0.5))
                    .frame(width: 44, height: 44)
                    .overlay {
                        Image(systemName: "play.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.white)
                            .offset(x: 2) // Visual centering for play icon
                    }
            }
            .frame(maxWidth: 240, maxHeight: 180)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showPlayer) {
            VideoPlayerSheet(content: content)
        }
    }

    private var thumbnailURL: URL? {
        if let url = content.thumbnailUrl { return URL(string: url) }
        return nil
    }

    private var videoPoster: some View {
        VStack(spacing: 6) {
            Image(systemName: "film")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            if let name = content.name {
                Text(name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: 200, height: 140)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

/// Sheet wrapping AVKit VideoPlayer for playback.
struct VideoPlayerSheet: View {
    let content: MessageContent
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(content.name ?? L.video)
                    .font(.headline)
                Spacer()
                Button(L.close) { dismiss() }
            }
            .padding()

            if let urlString = content.url, let url = URL(string: urlString) {
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(minWidth: 480, minHeight: 360)
            } else {
                ContentUnavailableView(L.cannotPlay, systemImage: "exclamationmark.triangle", description: Text(L.invalidVideoURL))
                    .frame(minWidth: 480, minHeight: 360)
            }
        }
        .frame(minWidth: 520, minHeight: 420)
    }
}
