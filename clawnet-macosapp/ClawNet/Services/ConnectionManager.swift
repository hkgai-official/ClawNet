import Foundation
import OSLog

/// Manages gateway connection lifecycle with automatic reconnection.
/// Before each (re)connect, ensures the access token is still valid via AuthManager.
@MainActor @Observable
final class ConnectionManager {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "connection")

    private(set) var status: AppState.ConnectionStatus = .disconnected
    var lastError: String?
    private(set) var reconnectAttempt: Int = 0
    /// True when max retries exhausted and waiting for manual intervention.
    private(set) var needsManualReconnect: Bool = false
    /// True when refresh token expired — UI should navigate to login.
    private(set) var sessionExpired: Bool = false

    private var reconnectTask: Task<Void, Never>?
    private var chatService: ChatService?
    private var serverURL: URL?
    private var accessToken: String?
    private var authManager: AuthManager?

    /// Called when reconnection succeeds so AppState can sync its connectionStatus.
    var onReconnected: (() -> Void)?

    /// Whether the current disconnect was caused by a system event (sleep/network change)
    /// rather than a genuine connection failure. System-caused disconnects get unlimited retries.
    private var isSystemCausedDisconnect = false

    /// Whether reconnection is paused because the network is unavailable.
    private var isPausedForNetwork = false

    static let maxReconnectAttempts = 20
    static let maxBackoffSeconds: Double = 30

    private let networkMonitor = NetworkMonitor.shared

    func configure(chatService: ChatService, serverURL: URL,
                   accessToken: String, authManager: AuthManager) {
        self.chatService = chatService
        self.serverURL = serverURL
        self.accessToken = accessToken
        self.authManager = authManager
        self.sessionExpired = false
        setupNetworkMonitor()
    }

    // MARK: - Network Monitor Integration

    private func setupNetworkMonitor() {
        networkMonitor.onSystemWillSleep = { [weak self] in
            guard let self else { return }
            self.logger.info("Sleep detected — marking system-caused disconnect")
            self.isSystemCausedDisconnect = true
            // Cancel any pending reconnect timer (don't waste attempts during sleep)
            self.reconnectTask?.cancel()
            self.reconnectTask = nil
        }

        networkMonitor.onSystemWake = { [weak self] in
            guard let self else { return }
            self.logger.info("Wake detected — triggering immediate reconnect")
            self.isSystemCausedDisconnect = true
            // Reset backoff and attempt counter for system-caused disconnects
            self.reconnectAttempt = 0
            self.needsManualReconnect = false
            if self.status != .connected {
                self.scheduleReconnect(immediate: true)
            }
        }

        networkMonitor.onNetworkLost = { [weak self] in
            guard let self else { return }
            self.logger.info("Network lost — pausing reconnection")
            self.isPausedForNetwork = true
            self.isSystemCausedDisconnect = true
            // Cancel pending reconnects (no point retrying without network)
            self.reconnectTask?.cancel()
            self.reconnectTask = nil
        }

        networkMonitor.onNetworkRestored = { [weak self] in
            guard let self else { return }
            self.logger.info("Network restored — resuming reconnection")
            self.isPausedForNetwork = false
            self.isSystemCausedDisconnect = true
            // Reset backoff for network-change reconnects
            self.reconnectAttempt = 0
            self.needsManualReconnect = false
            if self.status != .connected {
                self.scheduleReconnect(immediate: true)
            }
        }

        networkMonitor.start()
    }

    func connect() async {
        guard let chatService, let serverURL else { return }
        status = .connecting
        lastError = nil

        do {
            // Refresh access token before connecting if needed
            if let auth = authManager {
                let validToken = try await auth.ensureValidAccessToken()
                self.accessToken = validToken
            }

            guard let token = accessToken else {
                throw AuthError.notAuthenticated
            }

            try await chatService.connect(serverURL: serverURL, accessToken: token)
            status = .connected
            reconnectAttempt = 0
            needsManualReconnect = false
            isSystemCausedDisconnect = false
            onReconnected?()
            logger.info("Connected to server")
        } catch AuthError.tokenRefreshFailed {
            logger.warning("Session expired — refresh token invalid, requiring re-login")
            status = .disconnected
            lastError = "会话已过期，请重新登录"
            needsManualReconnect = true
            sessionExpired = true
        } catch {
            lastError = error.localizedDescription
            status = .disconnected
            logger.error("Connection failed: \(error.localizedDescription, privacy: .public)")
            scheduleReconnect()
        }
    }

    func disconnect() async {
        reconnectTask?.cancel()
        reconnectTask = nil
        await chatService?.disconnect()
        status = .disconnected
        reconnectAttempt = 0
        needsManualReconnect = false
    }

    func scheduleReconnect(immediate: Bool = false) {
        guard !sessionExpired else { return }

        // If network is down, don't attempt — will be triggered when network restores
        if isPausedForNetwork {
            status = .reconnecting
            logger.info("Reconnect deferred — waiting for network")
            return
        }

        // System-caused disconnects (sleep/wake/network change) bypass the attempt limit
        if !isSystemCausedDisconnect {
            guard reconnectAttempt < Self.maxReconnectAttempts else {
                logger.warning("Max reconnect attempts reached — waiting for manual reconnect")
                status = .disconnected
                needsManualReconnect = true
                return
            }
        }

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            let delay: Double
            if immediate {
                delay = 0.5 // Brief delay for network to stabilize
            } else {
                delay = min(
                    pow(2.0, Double(self.reconnectAttempt)) * 0.5,
                    Self.maxBackoffSeconds
                )
            }
            self.status = .reconnecting
            self.reconnectAttempt += 1
            self.logger.info("Reconnecting in \(delay)s (attempt \(self.reconnectAttempt), systemCaused=\(self.isSystemCausedDisconnect))")

            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }

            await self.connect()
        }
    }

    func handleDisconnect(reason: String) {
        logger.warning("Disconnected: \(reason, privacy: .public)")
        lastError = reason
        status = .disconnected
        scheduleReconnect()
    }

    /// Cancel any pending reconnect timer and restore connected state.
    func cancelReconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        status = .connected
        reconnectAttempt = 0
        needsManualReconnect = false
        isSystemCausedDisconnect = false
    }

    /// Reset reconnect counter for manual retry.
    func resetReconnectAttempts() {
        reconnectAttempt = 0
        needsManualReconnect = false
        sessionExpired = false
        isSystemCausedDisconnect = false
    }
}
