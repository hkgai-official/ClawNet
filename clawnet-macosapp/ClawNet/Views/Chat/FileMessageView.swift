import SwiftUI

/// Renders a file attachment card with icon, name, size, and download action.
struct FileMessageView: View {
    @Environment(AppState.self) private var appState
    let content: MessageContent
    let isUser: Bool
    @State private var showDownloadConfirm = false
    @State private var isDownloading = false

    var body: some View {
        Button(action: { showDownloadConfirm = true }) {
            HStack(spacing: 10) {
                fileIcon
                    .font(.system(size: 24))
                    .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text(content.name ?? L.unnamedFile)
                        .font(.subheadline.bold())
                        .lineLimit(1)
                    if let size = content.formattedSize {
                        Text(size)
                            .font(.caption)
                            .foregroundStyle(SDColor.textSecondary)
                    }
                }

                Spacer(minLength: 0)

                if isDownloading {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 18))
                        .foregroundStyle(SDColor.textSecondary)
                }
            }
            .padding(10)
            .frame(width: 220)
            .background(isUser ? SDColor.primary.opacity(0.08) : SDColor.textSecondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(isDownloading)
        .confirmationDialog(L.downloadFile, isPresented: $showDownloadConfirm, titleVisibility: .visible) {
            Button(L.saveToDownloads) {
                downloadFile()
            }
            Button(L.cancel, role: .cancel) {}
        } message: {
            Text("\(content.name ?? L.file) (\(content.formattedSize ?? ""))")
        }
    }

    private var fileIcon: some View {
        let (icon, color) = fileIconAndColor(mimeType: content.mimeType)
        return Image(systemName: icon)
            .foregroundStyle(color)
    }

    private func downloadFile() {

        guard let fileId = content.id else { return }
        let fileName = content.name ?? "download"
        isDownloading = true
        Task {
            defer { isDownloading = false }
            guard let api = appState.api else { return }
            do {
                let destination = try await api.downloadFile(id: fileId, fileName: fileName)
                NSWorkspace.shared.selectFile(destination.path, inFileViewerRootedAtPath: "")
            } catch {
                // Download failed silently for now
            }
        }
    }
}

/// Returns SF Symbol name and color for a given MIME type.
func fileIconAndColor(mimeType: String?) -> (String, Color) {
    guard let mime = mimeType?.lowercased() else { return ("doc", SDColor.textTertiary) }
    if mime.hasPrefix("image/") { return ("photo", SDColor.success) }
    if mime.hasPrefix("video/") { return ("film", SDColor.info) }
    if mime.hasPrefix("audio/") { return ("music.note", SDColor.agentPrimary) }
    if mime.contains("pdf") { return ("doc.richtext", SDColor.error) }
    if mime.contains("word") || mime.contains("document") { return ("doc.text", SDColor.info) }
    if mime.contains("sheet") || mime.contains("excel") { return ("tablecells", SDColor.success) }
    if mime.contains("text") || mime.contains("json") || mime.contains("xml") { return ("doc.plaintext", SDColor.textTertiary) }
    if mime.contains("zip") || mime.contains("tar") || mime.contains("compress") { return ("doc.zipper", SDColor.warning) }
    return ("doc", SDColor.textTertiary)
}
