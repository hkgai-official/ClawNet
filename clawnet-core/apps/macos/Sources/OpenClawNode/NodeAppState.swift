import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class NodeAppState {
    static let shared = NodeAppState()

    enum ConnectionStatus: Equatable {
        case disconnected
        case connecting
        case connected(gateway: String)
        case error(message: String)

        var label: String {
            switch self {
            case .disconnected: "Disconnected"
            case .connecting: "Connecting…"
            case let .connected(gateway): "Connected to \(gateway)"
            case let .error(message): "Error: \(message)"
            }
        }

        var isConnected: Bool {
            if case .connected = self { return true }
            return false
        }
    }

    var connectionStatus: ConnectionStatus = .disconnected
    var isPaused: Bool = false {
        didSet { UserDefaults.standard.set(self.isPaused, forKey: NodeConstants.pauseKey) }
    }

    private let logger = Logger(subsystem: "ai.openclaw.node", category: "state")
    private var coordinator: NodeCoordinator?

    private init() {
        self.isPaused = UserDefaults.standard.bool(forKey: NodeConstants.pauseKey)
    }

    func start() {
        guard self.coordinator == nil else { return }
        let coordinator = NodeCoordinator()
        self.coordinator = coordinator
        coordinator.start()
        self.logger.info("node coordinator started")
    }

    func stop() {
        self.coordinator?.stop()
        self.coordinator = nil
        self.connectionStatus = .disconnected
        self.logger.info("node coordinator stopped")
    }

    func restart() {
        self.stop()
        self.start()
    }
}
