import Foundation
import OSLog

/// Manages file path access control policy.
@MainActor @Observable
final class CommandPolicy {
    static let shared = CommandPolicy()

    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "command-policy")

    /// Closure that returns the current API client, injected by AppState.
    /// Used to push settings changes to the server on every save.
    var apiProvider: (() -> ClawNetAPI?)?

    // MARK: - File Access Policy

    /// Access mode: deny, scoped, full.
    private(set) var fileAccessMode: FileAccessMode = .scoped

    /// Glob patterns for allowed paths (used in scoped mode).
    private(set) var allowedPaths: [String] = []

    /// Glob patterns for denied paths (always enforced).
    private(set) var deniedPaths: [String] = CommandPolicy.defaultDeniedPaths

    /// Server-provided default denied paths (not removable by user).
    static let defaultDeniedPaths: [String] = [
        "/etc/shadow",
        "/etc/passwd",
        "**/.ssh/id_*",
        "**/.env",
        "**/.env.local",
        "**/.env.production",
    ]

    enum FileAccessMode: String, Codable, CaseIterable, Identifiable {
        case deny
        case scoped
        case full

        var id: String { rawValue }

        var title: String {
            switch self {
            case .deny: L.fileAccessDeny
            case .scoped: L.fileAccessScoped
            case .full: L.fileAccessFull
            }
        }
    }

    // MARK: - Persistence

    private static let configURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("ClawNet")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("command-policy.json")
    }()

    init() {
        loadConfig()
    }

    // MARK: - File Access Validation

    func validateFileAccess(path: String, operation: FileOperation) -> CommandCheckResult {
        let resolvedPath = resolvePath(path)

        // Always check denied paths first
        if matchesDeniedPath(resolvedPath) {
            return CommandCheckResult(
                allowed: false,
                reason: "ACCESS_DENIED: path '\(resolvedPath)' is in denied list")
        }

        switch fileAccessMode {
        case .deny:
            return CommandCheckResult(
                allowed: false,
                reason: "ACCESS_DENIED: file access is disabled (mode=deny)")
        case .full:
            return CommandCheckResult(allowed: true, reason: "allowed (mode=full)")
        case .scoped:
            if matchesAllowedPath(resolvedPath, operation: operation) {
                return CommandCheckResult(allowed: true, reason: "path in allowlist")
            }
            return CommandCheckResult(
                allowed: false,
                reason: "ACCESS_DENIED: path '\(resolvedPath)' is not in allowed paths. Allowed: \(allowedPaths.joined(separator: ", "))")
        }
    }

    /// Validate file access with an additional tag ACL layer.
    /// The effective permission is the intersection: both global policy AND tag ACL must allow.
    func validateFileAccessWithTagAcl(
        path: String,
        operation: FileOperation,
        tagAcl: Tag.NodeAcl
    ) -> CommandCheckResult {
        // 1. Global policy first (existing) — handles its own path resolution
        let globalResult = validateFileAccess(path: path, operation: operation)
        if !globalResult.allowed {
            return globalResult  // Global deny wins
        }

        // 2. Read-only mode: reject writes for delegate agents
        if tagAcl.accessMode == "ro" && operation == .write {
            return CommandCheckResult(
                allowed: false,
                reason: "read-only mode: write operations are denied for delegate agents"
            )
        }

        // 3. Tag ACL path matching
        let resolvedPath = resolvePath(path)

        for pattern in tagAcl.deniedPaths {
            if Self.globMatch(path: resolvedPath, pattern: pattern) {
                return CommandCheckResult(allowed: false, reason: "denied by tag ACL")
            }
        }

        if tagAcl.allowedPaths.isEmpty {
            return CommandCheckResult(allowed: false, reason: "tag ACL has no allowed paths")
        }

        for pattern in tagAcl.allowedPaths {
            if Self.globMatch(path: resolvedPath, pattern: pattern) {
                return CommandCheckResult(allowed: true, reason: "allowed by tag ACL")
            }
            if !pattern.contains("*") && !pattern.contains("?") {
                let dir = pattern.hasSuffix("/") ? pattern : pattern + "/"
                if resolvedPath.hasPrefix(dir) {
                    return CommandCheckResult(allowed: true, reason: "allowed by tag ACL (dir prefix)")
                }
            }
        }

        return CommandCheckResult(allowed: false, reason: "not in tag ACL allowed paths")
    }

    enum FileOperation: String {
        case read
        case write
    }

    private func resolvePath(_ path: String) -> String {
        // Resolve ~ and symlinks
        let expanded = NSString(string: path).expandingTildeInPath
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
    }

    private func matchesDeniedPath(_ path: String) -> Bool {
        for pattern in deniedPaths {
            if Self.globMatch(path: path, pattern: pattern) {
                return true
            }
        }
        return false
    }

    private func matchesAllowedPath(_ path: String, operation: FileOperation) -> Bool {
        for pattern in allowedPaths {
            if Self.globMatch(path: path, pattern: pattern) {
                return true
            }
            // Directory listing: if allowlist covers children, allow listing the directory
            if Self.globMatch(path: path + "/probe", pattern: pattern) {
                return true
            }
            // Directory prefix: a plain directory path (no wildcards) allows all children
            if !pattern.contains("*") && !pattern.contains("?") {
                let dir = pattern.hasSuffix("/") ? pattern : pattern + "/"
                if path.hasPrefix(dir) {
                    return true
                }
            }
        }
        return false
    }

    static func globMatch(path: String, pattern: String) -> Bool {
        if pattern.contains("**") {
            let parts = pattern.components(separatedBy: "**")
            guard parts.count == 2 else {
                return fnmatch(pattern, path, FNM_PATHNAME) == 0
            }
            let prefix = parts[0]
            let suffix = parts[1]
            if !prefix.isEmpty, !path.hasPrefix(prefix) { return false }
            if !suffix.isEmpty, !path.hasSuffix(suffix.replacingOccurrences(of: "/", with: "")) {
                let remaining = String(path.dropFirst(prefix.count))
                return fnmatch(String(suffix.dropFirst()), remaining, 0) == 0
            }
            return true
        }
        return fnmatch(pattern, path, FNM_PATHNAME) == 0
    }

    // MARK: - Config Mutation

    func setFileAccessMode(_ mode: FileAccessMode) {
        fileAccessMode = mode
        saveConfig()
    }

    func setAllowedPaths(_ paths: [String]) {
        allowedPaths = paths
        saveConfig()
    }

    func addAllowedPath(_ path: String) {
        if !allowedPaths.contains(path) {
            allowedPaths.append(path)
            saveConfig()
        }
    }

    func removeAllowedPath(_ path: String) {
        allowedPaths.removeAll { $0 == path }
        saveConfig()
    }

    func setDeniedPaths(_ paths: [String]) {
        // Merge with hard defaults
        let combined = Set(Self.defaultDeniedPaths + paths)
        deniedPaths = Array(combined)
        saveConfig()
    }

    // MARK: - Server Sync

    /// Sync file access settings from the server.
    func syncFromServer(api: ClawNetAPI) async {
        do {
            let settings = try await api.getFileAccessSettings()
            if let mode = FileAccessMode(rawValue: settings.mode) {
                fileAccessMode = mode
            }
            allowedPaths = settings.allowedPaths
            let combinedDenied = Set(Self.defaultDeniedPaths + settings.deniedPaths)
            deniedPaths = Array(combinedDenied)
            persistLocally()
            logger.info("Synced file access settings from server")
        } catch {
            logger.warning("Failed to sync file access settings: \(error.localizedDescription)")
        }
    }

    /// Push local file access settings to the server.
    func syncToServer(api: ClawNetAPI) async {
        do {
            let userDenied = deniedPaths.filter { !Self.defaultDeniedPaths.contains($0) }
            try await api.updateFileAccessSettings(
                mode: fileAccessMode.rawValue,
                allowedPaths: allowedPaths,
                deniedPaths: userDenied
            )
            logger.info("Pushed file access settings to server")
        } catch {
            logger.warning("Failed to push file access settings: \(error.localizedDescription)")
        }
    }

    // MARK: - Persistence

    private struct PersistedConfig: Codable {
        var fileAccessMode: String
        var allowedPaths: [String]
        var deniedPaths: [String]
    }

    private func loadConfig() {
        let url = Self.configURL
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(PersistedConfig.self, from: data)
        else { return }

        if let mode = FileAccessMode(rawValue: config.fileAccessMode) {
            fileAccessMode = mode
        }
        allowedPaths = config.allowedPaths
        deniedPaths = Array(Set(Self.defaultDeniedPaths + config.deniedPaths))
    }

    private func persistLocally() {
        let config = PersistedConfig(
            fileAccessMode: fileAccessMode.rawValue,
            allowedPaths: allowedPaths,
            deniedPaths: deniedPaths
        )
        let url = Self.configURL
        if let data = try? JSONEncoder().encode(config) {
            try? data.write(to: url, options: [.atomic])
        }
    }

    private func saveConfig() {
        persistLocally()
        if let api = apiProvider?() {
            Task { await syncToServer(api: api) }
        } else {
            logger.warning("No API provider — settings saved locally only")
        }
    }
}

struct CommandCheckResult: Sendable {
    let allowed: Bool
    let reason: String
}
