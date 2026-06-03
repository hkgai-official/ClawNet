import Foundation
import OSLog

/// Reads the shared openclaw.json config file to resolve gateway connection parameters.
enum NodeConfigReader {
    private static let logger = Logger(subsystem: NodeConstants.subsystem, category: "config")

    struct GatewayConfig: Sendable {
        let url: URL
        let token: String?
        let password: String?
    }

    /// Resolve the gateway URL, token, and password from the config file and environment.
    static func resolveGateway() -> GatewayConfig? {
        let root = self.loadConfigDict()
        let gateway = root["gateway"] as? [String: Any] ?? [:]
        let mode = (gateway["mode"] as? String)?.lowercased() ?? "local"
        let isRemote = mode == "remote"

        let url: URL
        if isRemote {
            guard let remote = gateway["remote"] as? [String: Any],
                  let host = remote["host"] as? String,
                  !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                self.logger.warning("remote mode but no gateway.remote.host configured")
                return nil
            }
            let port = remote["port"] as? Int ?? 18789
            let scheme = remote["tls"] as? Bool == true ? "wss" : "ws"
            guard let resolved = URL(string: "\(scheme)://\(host):\(port)") else {
                self.logger.error("invalid remote URL: \(host):\(port)")
                return nil
            }
            url = resolved
        } else {
            let port = self.resolveLocalPort(gateway: gateway)
            let host = self.resolveLocalHost(gateway: gateway)
            guard let resolved = URL(string: "ws://\(host):\(port)") else {
                self.logger.error("invalid local URL: \(host):\(port)")
                return nil
            }
            url = resolved
        }

        let token = self.resolveToken(isRemote: isRemote, gateway: gateway)
        let password = self.resolvePassword(isRemote: isRemote, gateway: gateway)
        return GatewayConfig(url: url, token: token, password: password)
    }

    private static func resolveLocalPort(gateway: [String: Any]) -> Int {
        if let envPort = ProcessInfo.processInfo.environment["OPENCLAW_GATEWAY_PORT"],
           let port = Int(envPort)
        {
            return port
        }
        return gateway["port"] as? Int ?? 18789
    }

    private static func resolveLocalHost(gateway: [String: Any]) -> String {
        let bind = (gateway["bind"] as? String)?.lowercased() ?? "loopback"
        switch bind {
        case "loopback": return "127.0.0.1"
        case "lan", "auto", "tailnet": return "0.0.0.0"
        default:
            if let custom = gateway["bindHost"] as? String, !custom.isEmpty {
                return custom
            }
            return "127.0.0.1"
        }
    }

    private static func resolveToken(isRemote: Bool, gateway: [String: Any]) -> String? {
        // Environment override
        if let envToken = ProcessInfo.processInfo.environment["OPENCLAW_GATEWAY_TOKEN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !envToken.isEmpty
        {
            return envToken
        }
        if isRemote {
            if let remote = gateway["remote"] as? [String: Any],
               let token = remote["token"] as? String
            {
                let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            }
        } else {
            if let auth = gateway["auth"] as? [String: Any],
               let token = auth["token"] as? String
            {
                let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            }
        }
        return nil
    }

    private static func resolvePassword(isRemote: Bool, gateway: [String: Any]) -> String? {
        if let envPw = ProcessInfo.processInfo.environment["OPENCLAW_GATEWAY_PASSWORD"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !envPw.isEmpty
        {
            return envPw
        }
        let section = isRemote ? "remote" : "auth"
        if let sub = gateway[section] as? [String: Any],
           let password = sub["password"] as? String
        {
            let pw = password.trimmingCharacters(in: .whitespacesAndNewlines)
            return pw.isEmpty ? nil : pw
        }
        return nil
    }

    private static func loadConfigDict() -> [String: Any] {
        let url = NodePaths.configURL
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        do {
            let data = try Data(contentsOf: url)
            return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        } catch {
            self.logger.warning("failed to read config: \(error.localizedDescription)")
            return [:]
        }
    }
}
