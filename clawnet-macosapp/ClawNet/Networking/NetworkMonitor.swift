import AppKit
import Foundation
import Network
import OSLog

/// Monitors network reachability and macOS sleep/wake events.
/// Posts notifications so ConnectionManager can react immediately.
@MainActor
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "network-monitor")
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "ai.clawnet.network-monitor")

    /// Current network availability.
    private(set) var isNetworkAvailable = true

    /// True while the system is sleeping (between willSleep and didWake).
    private(set) var isSleeping = false

    /// Callback invoked on the main actor when conditions change.
    var onNetworkRestored: (() -> Void)?
    var onNetworkLost: (() -> Void)?
    var onSystemWake: (() -> Void)?
    var onSystemWillSleep: (() -> Void)?

    private var started = false

    private init() {}

    func start() {
        guard !started else { return }
        started = true
        startNetworkMonitor()
        startSleepWakeObservers()
        logger.info("NetworkMonitor started")
    }

    func stop() {
        guard started else { return }
        started = false
        monitor.cancel()
        let center = NSWorkspace.shared.notificationCenter
        center.removeObserver(self)
        logger.info("NetworkMonitor stopped")
    }

    // MARK: - NWPathMonitor

    private func startNetworkMonitor() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let available = path.status == .satisfied
                let previous = self.isNetworkAvailable
                self.isNetworkAvailable = available

                if available && !previous {
                    self.logger.info("Network restored (interface: \(path.availableInterfaces.map(\.name).joined(separator: ","), privacy: .public))")
                    self.onNetworkRestored?()
                } else if !available && previous {
                    self.logger.warning("Network lost")
                    self.onNetworkLost?()
                }
            }
        }
        monitor.start(queue: monitorQueue)
    }

    // MARK: - Sleep / Wake

    private func startSleepWakeObservers() {
        let center = NSWorkspace.shared.notificationCenter

        center.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isSleeping = true
                self.logger.info("System will sleep")
                self.onSystemWillSleep?()
            }
        }

        center.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isSleeping = false
                self.logger.info("System did wake")
                // Give network a moment to re-establish after wake
                try? await Task.sleep(for: .seconds(2))
                self.onSystemWake?()
            }
        }
    }
}
