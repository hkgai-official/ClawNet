import AppKit
import SwiftUI

struct NodeMenuContent: View {
    @Bindable var state: NodeAppState
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("OpenClaw Node")
                .font(.headline)

            Divider()

            self.statusSection

            Divider()

            self.controlsSection

            Divider()

            Button("Settings…") {
                NSApp.activate(ignoringOtherApps: true)
                self.openSettings()
            }
            .keyboardShortcut(",", modifiers: [.command])

            Button("Quit OpenClaw Node") {
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Circle()
                    .fill(self.statusColor)
                    .frame(width: 8, height: 8)
                Text(self.state.connectionStatus.label)
                    .font(.callout)
                    .lineLimit(1)
            }
        }
    }

    private var controlsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle("Paused", isOn: self.$state.isPaused)

            Button("Reconnect") {
                self.state.restart()
            }
            .disabled(self.state.isPaused)
        }
    }

    private var statusColor: Color {
        switch self.state.connectionStatus {
        case .connected: .green
        case .connecting: .yellow
        case .disconnected: .gray
        case .error: .red
        }
    }
}
