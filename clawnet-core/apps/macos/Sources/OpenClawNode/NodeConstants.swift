import Foundation

enum NodeConstants {
    static let subsystem = "ai.openclaw.node"
    static let bundleID = "ai.openclaw.node"

    // UserDefaults keys (namespaced to avoid collision with main app)
    static let pauseKey = "openclawNode.paused"
    static let cameraEnabledKey = "openclawNode.cameraEnabled"
    static let locationModeKey = "openclawNode.locationMode"
    static let fileAccessModeKey = "openclawNode.fileAccessMode"
    static let systemRunEnabledKey = "openclawNode.systemRunEnabled"
}

enum NodePaths {
    private static let stateDirEnv = ["OPENCLAW_STATE_DIR"]
    private static let configPathEnv = ["OPENCLAW_CONFIG_PATH"]

    static var stateDirURL: URL {
        for key in self.stateDirEnv {
            if let raw = getenv(key) {
                let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    return URL(fileURLWithPath: value, isDirectory: true)
                }
            }
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".openclaw", isDirectory: true)
    }

    static var configURL: URL {
        for key in self.configPathEnv {
            if let raw = getenv(key) {
                let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    return URL(fileURLWithPath: value)
                }
            }
        }
        let stateDir = self.stateDirURL
        let candidate = stateDir.appendingPathComponent("openclaw.json")
        if FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        return candidate
    }

    static var fileAccessConfigURL: URL {
        self.stateDirURL.appendingPathComponent("file-access.json")
    }
}
