import Foundation
import OSLog

/// WebSocket connection to clawnet-server.
/// Replaces the direct gateway connection with a simpler server-proxied approach.
actor ServerConnection {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "server-conn")

    private var task: URLSessionWebSocketTask?
    private var isConnected = false
    private var shouldReconnect = true
    private var backoffSeconds: Double = 1.0
    private var listenTask: Task<Void, Never>?
    private var keepaliveTask: Task<Void, Never>?

    private let messageHandler: @Sendable (ServerMessage) async -> Void
    private let disconnectHandler: @Sendable (String) async -> Void

    init(
        messageHandler: @escaping @Sendable (ServerMessage) async -> Void,
        disconnectHandler: @escaping @Sendable (String) async -> Void
    ) {
        self.messageHandler = messageHandler
        self.disconnectHandler = disconnectHandler
    }

    func connect(serverURL: URL, token: String) async throws {
        // Build WebSocket URL: ws(s)://host:port/ws/v1/messages?token=xxx
        var components = URLComponents(url: serverURL.appendingPathComponent("ws/v1/messages"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "token", value: token)]

        // Convert http(s) to ws(s)
        if components.scheme == "http" { components.scheme = "ws" }
        else if components.scheme == "https" { components.scheme = "wss" }

        guard let wsURL = components.url else {
            throw ServerConnectionError.invalidURL
        }

        logger.info("Connecting to server WebSocket: \(wsURL.absoluteString, privacy: .public)")

        let session = URLSession(configuration: .default)
        let wsTask = session.webSocketTask(with: wsURL)
        wsTask.maximumMessageSize = 16 * 1024 * 1024
        self.task = wsTask
        wsTask.resume()

        // Wait for auth_success message
        let msg = try await wsTask.receive()
        guard let data = messageData(from: msg),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["type"] as? String == "auth_success" else {
            wsTask.cancel(with: .protocolError, reason: nil)
            throw ServerConnectionError.authFailed
        }

        self.isConnected = true
        self.backoffSeconds = 1.0
        self.shouldReconnect = true
        startListening()
        startKeepalive()
        logger.info("Server WebSocket connected and authenticated")
    }

    func disconnect() {
        shouldReconnect = false
        isConnected = false
        listenTask?.cancel()
        listenTask = nil
        keepaliveTask?.cancel()
        keepaliveTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    func send(_ message: [String: Any]) async throws {
        guard let task, isConnected else {
            throw ServerConnectionError.notConnected
        }
        let data = try JSONSerialization.data(withJSONObject: message)
        try await task.send(.data(data))
    }

    // MARK: - Private

    private func startListening() {
        listenTask = Task { [weak self] in
            guard let self else { return }
            await self.listenLoop()
        }
    }

    private func listenLoop() async {
        guard let task else { return }
        while isConnected && !Task.isCancelled {
            do {
                let msg = try await task.receive()
                guard let data = messageData(from: msg),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    continue
                }
                let serverMsg = ServerMessage(rawJSON: data, parsed: json)
                await messageHandler(serverMsg)
            } catch {
                guard shouldReconnect else { return }
                isConnected = false
                logger.warning("Server WebSocket receive error: \(error.localizedDescription, privacy: .public)")
                await disconnectHandler("receive error: \(error.localizedDescription)")
                return
            }
        }
        // Fallback: if loop exited without error (e.g. Task cancelled or isConnected
        // set to false externally), still notify so ConnectionManager can reconnect.
        if shouldReconnect && !isConnected {
            logger.warning("Listen loop exited without error — notifying disconnect")
            await disconnectHandler("connection lost")
        }
    }

    private func startKeepalive() {
        keepaliveTask = Task { [weak self] in
            while let self = self, await self.isConnected {
                try? await Task.sleep(for: .seconds(25))
                guard await self.isConnected else { return }
                try? await self.send(["type": "ping"])
            }
        }
    }

    private nonisolated func messageData(from msg: URLSessionWebSocketTask.Message) -> Data? {
        switch msg {
        case .data(let d): return d
        case .string(let s): return s.data(using: .utf8)
        @unknown default: return nil
        }
    }
}

// MARK: - Server Message

/// Parsed server WebSocket message.
/// Uses `@unchecked Sendable` because the underlying JSON data is immutable
/// and only contains JSON-safe value types (String, Number, Array, Dictionary).
struct ServerMessage: @unchecked Sendable {
    let type: String
    let requestId: String?

    /// Raw JSON bytes for the entire message.
    private let rawJSON: Data

    /// Lazily-parsed top-level "data" dictionary.
    let data: [String: Any]

    init(rawJSON: Data, parsed: [String: Any]) {
        self.rawJSON = rawJSON
        self.type = parsed["type"] as? String ?? ""
        self.requestId = parsed["request_id"] as? String
        self.data = parsed["data"] as? [String: Any] ?? [:]
    }

    /// The "data" field as serialized JSON bytes.
    var dataJSON: Data? {
        guard !data.isEmpty else { return nil }
        return try? JSONSerialization.data(withJSONObject: data)
    }
}

// MARK: - Errors

enum ServerConnectionError: LocalizedError {
    case invalidURL
    case authFailed
    case notConnected

    var errorDescription: String? {
        switch self {
        case .invalidURL: "Invalid server URL"
        case .authFailed: "Server authentication failed"
        case .notConnected: "Not connected to server"
        }
    }
}
