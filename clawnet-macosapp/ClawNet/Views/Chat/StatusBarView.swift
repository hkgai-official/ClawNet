import SwiftUI

/// Connection status bar — only visible when not connected or actively streaming.
struct StatusBarView: View {
    let connectionStatus: AppState.ConnectionStatus
    let isStreaming: Bool
    let needsManualReconnect: Bool
    let lastError: String?
    let onReconnect: () -> Void

    /// Hide entirely when connected and not streaming (zero noise).
    private var shouldShow: Bool {
        connectionStatus != .connected || isStreaming
    }

    var body: some View {
        if shouldShow {
            VStack(spacing: 0) {
                // Error banner (gateway unreachable)
                if connectionStatus == .disconnected, let lastError, !lastError.isEmpty {
                    HStack(spacing: SDSpacing.md) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(SDColor.warning)
                        Text("\(L.gatewayUnreachable): \(lastError)")
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer()
                        Button(L.retry) { onReconnect() }
                            .font(SDFont.small)
                            .foregroundStyle(.white)
                            .padding(.horizontal, SDSpacing.lg)
                            .padding(.vertical, SDSpacing.xs)
                            .background(SDColor.warning, in: RoundedRectangle(cornerRadius: SDRadius.sm))
                            .buttonStyle(.plain)
                    }
                    .padding(.horizontal, SDSpacing.xl)
                    .padding(.vertical, SDSpacing.sm)
                    .background(SDColor.warning.opacity(0.08))
                }

                // Status row
                HStack(spacing: SDSpacing.sm) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                    Text(statusText)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textTertiary)

                    if needsManualReconnect && (lastError == nil || lastError?.isEmpty == true) {
                        Button(L.reconnect) {
                            onReconnect()
                        }
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.primary)
                        .buttonStyle(.plain)
                    }

                    if isStreaming {
                        ProgressView()
                            .controlSize(.mini)
                        Text(L.generating)
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.primary)
                    }

                    Spacer()
                }
                .padding(.horizontal, SDSpacing.xl)
                .padding(.vertical, SDSpacing.sm)
                .background(SDColor.bgWhite)

                Rectangle()
                    .fill(SDColor.divider)
                    .frame(height: 1)
            }
        }
    }

    private var statusColor: Color {
        switch connectionStatus {
        case .connected: SDColor.success
        case .connecting, .reconnecting: SDColor.warning
        case .disconnected: SDColor.error
        }
    }

    private var statusText: String {
        switch connectionStatus {
        case .connected: L.connected
        case .connecting: L.connecting
        case .reconnecting: L.reconnecting
        case .disconnected: needsManualReconnect ? L.disconnectedLost : L.disconnected
        }
    }
}

#Preview("Connected – hidden") {
    StatusBarView(
        connectionStatus: .connected,
        isStreaming: false,
        needsManualReconnect: false,
        lastError: nil,
        onReconnect: {}
    )
}

#Preview("Needs Reconnect") {
    StatusBarView(
        connectionStatus: .disconnected,
        isStreaming: false,
        needsManualReconnect: true,
        lastError: nil,
        onReconnect: {}
    )
}

#Preview("Gateway Error") {
    StatusBarView(
        connectionStatus: .disconnected,
        isStreaming: false,
        needsManualReconnect: false,
        lastError: "connect to gateway: Could not connect to the server.",
        onReconnect: {}
    )
}

#Preview("Streaming") {
    StatusBarView(
        connectionStatus: .connected,
        isStreaming: true,
        needsManualReconnect: false,
        lastError: nil,
        onReconnect: {}
    )
}
