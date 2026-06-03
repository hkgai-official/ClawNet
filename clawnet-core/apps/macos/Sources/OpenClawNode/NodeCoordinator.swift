import Foundation
import OpenClawKit
import OSLog

/// Manages the node's connection lifecycle to the gateway.
/// This is the equivalent of MacNodeModeCoordinator for the standalone node app.
@MainActor
final class NodeCoordinator {
    private let logger = Logger(subsystem: NodeConstants.subsystem, category: "coordinator")
    private var task: Task<Void, Never>?
    private let runtime = NodeRuntime()
    private let session = GatewayNodeSession()

    func start() {
        guard self.task == nil else { return }
        self.task = Task { [weak self] in
            await self?.run()
        }
    }

    func stop() {
        self.task?.cancel()
        self.task = nil
        Task { await self.session.disconnect() }
    }

    private func run() async {
        var retryDelay: UInt64 = 1_000_000_000

        while !Task.isCancelled {
            if await MainActor.run(body: { NodeAppState.shared.isPaused }) {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }

            do {
                guard let config = NodeConfigReader.resolveGateway() else {
                    await MainActor.run {
                        NodeAppState.shared.connectionStatus = .error(message: "No gateway configured")
                    }
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    continue
                }

                await MainActor.run {
                    NodeAppState.shared.connectionStatus = .connecting
                }

                let caps = self.currentCaps()
                let commands = self.currentCommands(caps: caps)
                let connectOptions = GatewayConnectOptions(
                    role: "node",
                    scopes: [],
                    caps: caps,
                    commands: commands,
                    permissions: [:],
                    clientId: "openclaw-node-app",
                    clientMode: "node",
                    clientDisplayName: InstanceIdentity.displayName)

                let sessionBox = self.buildSessionBox(url: config.url)

                try await self.session.connect(
                    url: config.url,
                    token: config.token,
                    password: config.password,
                    connectOptions: connectOptions,
                    sessionBox: sessionBox,
                    onConnected: { [weak self] in
                        guard let self else { return }
                        self.logger.info("node connected to gateway")
                        await MainActor.run {
                            let host = config.url.host ?? "gateway"
                            NodeAppState.shared.connectionStatus = .connected(gateway: host)
                        }
                        await self.runtime.setEventSender { [weak self] event, payload in
                            guard let self else { return }
                            await self.session.sendEvent(event: event, payloadJSON: payload)
                        }
                        let blobEndpoint = GatewayBlobUploader.Endpoint.fromWebSocketURL(config.url, token: config.token)
                        await self.runtime.setBlobEndpoint(blobEndpoint)
                    },
                    onDisconnected: { [weak self] reason in
                        guard let self else { return }
                        await self.runtime.setEventSender(nil)
                        await self.runtime.setBlobEndpoint(nil)
                        self.logger.error("node disconnected: \(reason, privacy: .public)")
                        await MainActor.run {
                            NodeAppState.shared.connectionStatus = .disconnected
                        }
                    },
                    onInvoke: { [weak self] req in
                        guard let self else {
                            return BridgeInvokeResponse(
                                id: req.id,
                                ok: false,
                                error: OpenClawNodeError(
                                    code: .unavailable,
                                    message: "UNAVAILABLE: node not ready"))
                        }
                        return await self.runtime.handleInvoke(req)
                    })

                retryDelay = 1_000_000_000
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                self.logger.error("gateway connect failed: \(error.localizedDescription, privacy: .public)")
                await MainActor.run {
                    NodeAppState.shared.connectionStatus = .error(message: error.localizedDescription)
                }
                try? await Task.sleep(nanoseconds: min(retryDelay, 10_000_000_000))
                retryDelay = min(retryDelay * 2, 10_000_000_000)
            }
        }
    }

    private func currentCaps() -> [String] {
        var caps: [String] = [OpenClawCapability.screen.rawValue]
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: NodeConstants.cameraEnabledKey) {
            caps.append(OpenClawCapability.camera.rawValue)
        }
        let rawLocation = defaults.string(forKey: NodeConstants.locationModeKey) ?? "off"
        if OpenClawLocationMode(rawValue: rawLocation) != .off {
            caps.append(OpenClawCapability.location.rawValue)
        }
        return caps
    }

    private func currentCommands(caps: [String]) -> [String] {
        var commands: [String] = [
            OpenClawSystemCommand.notify.rawValue,
            OpenClawSystemCommand.which.rawValue,
            OpenClawSystemCommand.run.rawValue,
            OpenClawFileCommand.read.rawValue,
            OpenClawFileCommand.write.rawValue,
            OpenClawFileCommand.stat.rawValue,
            OpenClawFileCommand.list.rawValue,
            OpenClawFileCommand.search.rawValue,
        ]

        let capsSet = Set(caps)
        if capsSet.contains(OpenClawCapability.camera.rawValue) {
            commands.append(OpenClawCameraCommand.list.rawValue)
            commands.append(OpenClawCameraCommand.snap.rawValue)
            commands.append(OpenClawCameraCommand.clip.rawValue)
        }
        if capsSet.contains(OpenClawCapability.location.rawValue) {
            commands.append(OpenClawLocationCommand.get.rawValue)
        }

        return commands
    }

    private func buildSessionBox(url: URL) -> WebSocketSessionBox? {
        guard url.scheme?.lowercased() == "wss" else { return nil }
        let host = url.host ?? "gateway"
        let port = url.port ?? 443
        let stableID = "\(host):\(port)"
        let stored = GatewayTLSStore.loadFingerprint(stableID: stableID)
        let params = GatewayTLSParams(
            required: true,
            expectedFingerprint: stored,
            allowTOFU: stored == nil,
            storeKey: stableID)
        let session = GatewayTLSPinningSession(params: params)
        return WebSocketSessionBox(session: session)
    }
}
