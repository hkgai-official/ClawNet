import SwiftUI

/// Toast notification system — shows transient messages as overlays.
@MainActor @Observable
final class ToastManager {
    struct Toast: Identifiable {
        let id = UUID()
        let message: String
        let type: ToastType
        var isVisible = true

        enum ToastType {
            case success, error, info, warning

            var icon: String {
                switch self {
                case .success: "checkmark.circle.fill"
                case .error: "xmark.circle.fill"
                case .info: "info.circle.fill"
                case .warning: "exclamationmark.triangle.fill"
                }
            }

            var color: Color {
                switch self {
                case .success: .green
                case .error: .red
                case .info: .blue
                case .warning: .orange
                }
            }
        }
    }

    var toasts: [Toast] = []

    func show(_ message: String, type: Toast.ToastType = .info) {
        let toast = Toast(message: message, type: type)
        toasts.append(toast)

        Task {
            try? await Task.sleep(for: .seconds(3))
            withAnimation(.easeOut(duration: 0.3)) {
                toasts.removeAll { $0.id == toast.id }
            }
        }
    }

    func success(_ message: String) { show(message, type: .success) }
    func error(_ message: String) { show(message, type: .error) }
    func warning(_ message: String) { show(message, type: .warning) }
}

/// Overlay view that displays toast notifications.
struct ToastOverlay: View {
    let toastManager: ToastManager

    var body: some View {
        VStack(spacing: 8) {
            ForEach(toastManager.toasts) { toast in
                HStack(spacing: 8) {
                    Image(systemName: toast.type.icon)
                        .foregroundStyle(toast.type.color)
                    Text(toast.message)
                        .font(.subheadline)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
                .transition(.move(edge: .top).combined(with: .opacity))
                .frame(maxWidth: 360)
            }
        }
        .animation(.spring(duration: 0.3), value: toastManager.toasts.count)
        .padding(.top, 8)
    }
}
