import Foundation
import OSLog

/// A single WebSocket connection to the nodeclaw gateway using the "unified" role,
/// enabling both operator commands (chat.send, config.get) and node operations
/// (responding to node.invoke.request events) over one link.
final class UnifiedGatewayConnection: @unchecked Sendable {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "gateway")

    private var channel: GatewayChannelActor?
    private let nodeEventHandler: NodeEventHandler
    private let chatEventHandler: ChatEventHandler

    init(nodeEventHandler: NodeEventHandler, chatEventHandler: ChatEventHandler) {
        self.nodeEventHandler = nodeEventHandler
        self.chatEventHandler = chatEventHandler
    }

    // MARK: - Connection Lifecycle

    func connect(gatewayURL: String, token: String, clientId: String, commands: [String]) async throws {
        guard let url = URL(string: gatewayURL) else {
            throw GatewayError.invalidURL
        }

        let options = GatewayConnectOptions(
            role: "unified",
            scopes: ["operator.admin", "operator.write"],
            caps: ["screen"],
            commands: commands,
            permissions: [:],
            clientId: clientId,
            clientMode: "clawnet",
            clientDisplayName: Host.current().localizedName,
            includeDeviceIdentity: true
        )

        let channel = GatewayChannelActor(
            url: url,
            token: token,
            session: WebSocketSessionBox(session: URLSession.shared),
            pushHandler: { [weak self] push in
                guard let self else { return }
                await self.handlePush(push)
            },
            connectOptions: options
        )
        self.channel = channel

        try await channel.connect()

        // Derive blob endpoint from the WebSocket URL for HTTP blob transfers
        let endpoint = GatewayBlobUploader.Endpoint.fromWebSocketURL(url, token: token)
        await MainActor.run { nodeEventHandler.blobEndpoint = endpoint }

        logger.info("Unified gateway connection established")
    }

    func disconnect() async {
        await self.channel?.shutdown()
        self.channel = nil
        logger.info("Gateway disconnected")
    }

    // MARK: - Operator Methods (Chat)

    func chatSend(message: String, sessionId: String? = nil) async throws -> Data {
        guard let channel else { throw GatewayError.notConnected }
        var params: [String: AnyCodable] = ["text": AnyCodable(message)]
        if let sessionId {
            params["sessionId"] = AnyCodable(sessionId)
        }
        return try await channel.request(method: "chat.send", params: params)
    }

    func chatAbort(runId: String) async throws {
        guard let channel else { throw GatewayError.notConnected }
        try await channel.send(method: "chat.abort", params: ["runId": AnyCodable(runId)])
    }

    func chatHistory(sessionId: String) async throws -> Data {
        guard let channel else { throw GatewayError.notConnected }
        return try await channel.request(method: "chat.history", params: ["sessionId": AnyCodable(sessionId)])
    }

    func sessionsPreview() async throws -> Data {
        guard let channel else { throw GatewayError.notConnected }
        return try await channel.request(method: "sessions.preview", params: nil)
    }

    // MARK: - Node Methods

    func sendNodeInvokeResult(id: String, resultJSON: String) async throws {
        guard let channel else { throw GatewayError.notConnected }
        try await channel.send(
            method: "node.invoke.result",
            params: ["id": AnyCodable(id), "result": AnyCodable(resultJSON)]
        )
    }

    // MARK: - Event Handling

    @MainActor
    private func handlePush(_ push: GatewayPush) {
        switch push {
        case .event(let frame):
            switch frame.event {
            case "agent":
                chatEventHandler.handleAgentEvent(frame)
            case "heartbeat":
                chatEventHandler.handleHeartbeat(frame)
            case "node.invoke.request":
                Task {
                    await nodeEventHandler.handleInvokeRequest(frame, connection: self)
                }
            case "tick":
                break
            default:
                logger.debug("Unhandled event: \(frame.event, privacy: .public)")
            }

        case .snapshot(let helloOk):
            chatEventHandler.handleSnapshot(helloOk)

        case .seqGap(let expected, let received):
            logger.warning("Sequence gap: expected=\(expected) received=\(received)")
        }
    }
}

// MARK: - Error Types

enum GatewayError: LocalizedError {
    case notConnected
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .notConnected: "Not connected to gateway"
        case .invalidURL: "Invalid gateway URL"
        }
    }
}
