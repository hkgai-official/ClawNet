import SwiftUI

struct NodeStatusLabel: View {
    let state: NodeAppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: self.iconName)
                .symbolRenderingMode(.hierarchical)
            Text("Node")
                .font(.caption)
        }
    }

    private var iconName: String {
        switch self.state.connectionStatus {
        case .connected: "circle.fill"
        case .connecting: "circle.dotted"
        case .disconnected: "circle"
        case .error: "exclamationmark.circle"
        }
    }
}
