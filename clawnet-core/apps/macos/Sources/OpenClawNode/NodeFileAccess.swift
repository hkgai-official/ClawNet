import AppKit
import Foundation
import Observation
import OSLog

// MARK: - File Access Types

enum NodeFileOperation: String, Sendable {
    case read
    case write
}

struct NodeFileAccessResult: Sendable {
    var allowed: Bool
    var reason: String
}

enum NodeFileAccessMode: String, Codable, CaseIterable, Identifiable {
    case deny
    case scoped
    case full

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .deny: "Deny All"
        case .scoped: "Scoped (Allowlist)"
        case .full: "Allow All"
        }
    }
}

struct NodeFileAccessAllowedPath: Codable, Identifiable, Equatable {
    var id: UUID
    var pattern: String
    var operations: [String]
    var addedAt: Double?
    var lastUsedAt: Double?

    init(pattern: String, operations: [String] = ["read", "write"]) {
        self.id = UUID()
        self.pattern = pattern
        self.operations = operations
        self.addedAt = Date().timeIntervalSince1970 * 1000
    }
}

struct NodeFileAccessConfig: Codable {
    var version: Int
    var mode: NodeFileAccessMode
    var allowedPaths: [NodeFileAccessAllowedPath]
    var deniedPaths: [String]

    static func empty() -> NodeFileAccessConfig {
        NodeFileAccessConfig(
            version: 1,
            mode: .scoped,
            allowedPaths: [],
            deniedPaths: [
                "/etc/shadow",
                "/etc/passwd",
                "**/.ssh/id_*",
                "**/.env",
                "**/.env.local",
            ])
    }
}

// MARK: - File Access Store

enum NodeFileAccessStore {
    private static let logger = Logger(subsystem: NodeConstants.subsystem, category: "file-access-store")

    static func configURL() -> URL {
        NodePaths.fileAccessConfigURL
    }

    static func load() -> NodeFileAccessConfig {
        let url = self.configURL()
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .empty()
        }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(NodeFileAccessConfig.self, from: data)
        } catch {
            self.logger.warning("config load failed: \(error.localizedDescription)")
            return .empty()
        }
    }

    static func save(_ config: NodeFileAccessConfig) {
        let url = self.configURL()
        do {
            let dir = url.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(config)
            try data.write(to: url, options: [.atomic])
        } catch {
            self.logger.error("config save failed: \(error.localizedDescription)")
        }
    }

    static func update(_ block: (inout NodeFileAccessConfig) -> Void) {
        var config = self.load()
        block(&config)
        self.save(config)
    }
}

// MARK: - File Access Log

struct NodeFileAccessLogEntry: Identifiable, Codable {
    var id: UUID
    var timestamp: Double // ms since epoch
    var path: String
    var operation: String // "read" or "write"
    var allowed: Bool
    var reason: String

    init(path: String, operation: String, allowed: Bool, reason: String) {
        self.id = UUID()
        self.timestamp = Date().timeIntervalSince1970 * 1000
        self.path = path
        self.operation = operation
        self.allowed = allowed
        self.reason = reason
    }
}

@MainActor
@Observable
final class NodeFileAccessLogger {
    static let shared = NodeFileAccessLogger()

    private static let maxEntries = 200
    private static let logger = Logger(subsystem: NodeConstants.subsystem, category: "file-access-log")

    private(set) var entries: [NodeFileAccessLogEntry] = []

    private init() {
        self.entries = Self.loadFromDisk()
    }

    func append(_ entry: NodeFileAccessLogEntry) {
        self.entries.insert(entry, at: 0)
        if self.entries.count > Self.maxEntries {
            self.entries = Array(self.entries.prefix(Self.maxEntries))
        }
        Self.saveToDisk(self.entries)
    }

    func clear() {
        self.entries.removeAll()
        Self.saveToDisk(self.entries)
    }

    // MARK: - Persistence

    private static var logFileURL: URL {
        NodePaths.stateDirURL.appendingPathComponent("file-access-log.json")
    }

    private static func loadFromDisk() -> [NodeFileAccessLogEntry] {
        let url = self.logFileURL
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            let data = try Data(contentsOf: url)
            let entries = try JSONDecoder().decode([NodeFileAccessLogEntry].self, from: data)
            return Array(entries.prefix(self.maxEntries))
        } catch {
            self.logger.warning("log load failed: \(error.localizedDescription)")
            return []
        }
    }

    private static func saveToDisk(_ entries: [NodeFileAccessLogEntry]) {
        let url = self.logFileURL
        do {
            let dir = url.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(entries)
            try data.write(to: url, options: [.atomic])
        } catch {
            self.logger.error("log save failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - File Access Manager (with interactive prompt)

@MainActor
final class NodeFileAccessManager {
    static let shared = NodeFileAccessManager()
    private let logger = Logger(subsystem: NodeConstants.subsystem, category: "file-access")

    func checkAccess(path: String, operation: NodeFileOperation) async -> NodeFileAccessResult {
        let config = NodeFileAccessStore.load()
        let result: NodeFileAccessResult

        switch config.mode {
        case .deny:
            result = NodeFileAccessResult(allowed: false, reason: "file access denied (mode=deny)")
        case .full:
            if self.matchesDeniedPath(path, denied: config.deniedPaths) {
                result = NodeFileAccessResult(allowed: false, reason: "path explicitly denied")
            } else {
                result = NodeFileAccessResult(allowed: true, reason: "allowed (mode=full)")
            }
        case .scoped:
            if self.matchesDeniedPath(path, denied: config.deniedPaths) {
                result = NodeFileAccessResult(allowed: false, reason: "path explicitly denied")
            } else if self.matchesAllowedPath(path, operation: operation, allowed: config.allowedPaths) {
                result = NodeFileAccessResult(allowed: true, reason: "path in allowlist")
            } else {
                let decision = await self.promptForAccess(path: path, operation: operation)
                switch decision {
                case .deny:
                    result = NodeFileAccessResult(allowed: false, reason: "user denied access")
                case .allowOnce:
                    result = NodeFileAccessResult(allowed: true, reason: "user allowed once")
                case .allowAlways:
                    self.persistAllowedPath(path: path, operation: operation)
                    result = NodeFileAccessResult(allowed: true, reason: "user allowed always")
                }
            }
        }

        NodeFileAccessLogger.shared.append(NodeFileAccessLogEntry(
            path: path,
            operation: operation.rawValue,
            allowed: result.allowed,
            reason: result.reason))

        return result
    }

    private func matchesDeniedPath(_ path: String, denied: [String]) -> Bool {
        for pattern in denied {
            if Self.globMatch(path: path, pattern: pattern) {
                return true
            }
        }
        return false
    }

    private func matchesAllowedPath(_ path: String, operation: NodeFileOperation, allowed: [NodeFileAccessAllowedPath]) -> Bool {
        for entry in allowed {
            guard entry.operations.contains(operation.rawValue) else { continue }
            if Self.globMatch(path: path, pattern: entry.pattern) {
                Self.recordUsage(entryId: entry.id)
                return true
            }
            // For directory listing: if the allowlist covers children of this
            // path (e.g. pattern "/dir/*"), allow listing the directory itself.
            if Self.globMatch(path: path + "/probe", pattern: entry.pattern) {
                Self.recordUsage(entryId: entry.id)
                return true
            }
        }
        return false
    }

    private static func recordUsage(entryId: UUID) {
        NodeFileAccessStore.update { config in
            if let idx = config.allowedPaths.firstIndex(where: { $0.id == entryId }) {
                config.allowedPaths[idx].lastUsedAt = Date().timeIntervalSince1970 * 1000
            }
        }
    }

    private func persistAllowedPath(path: String, operation: NodeFileOperation) {
        let url = URL(fileURLWithPath: path)
        let dir = url.deletingLastPathComponent().path
        let pattern = dir + "/*"
        NodeFileAccessStore.update { config in
            if !config.allowedPaths.contains(where: { $0.pattern == pattern }) {
                config.allowedPaths.append(NodeFileAccessAllowedPath(
                    pattern: pattern,
                    operations: ["read", "write"]))
            }
        }
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

    enum FileAccessDecision {
        case deny
        case allowOnce
        case allowAlways
    }

    @MainActor
    private func promptForAccess(path: String, operation: NodeFileOperation) async -> FileAccessDecision {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Allow file \(operation.rawValue)?"
        alert.informativeText = "An agent is requesting to \(operation.rawValue) a file on this machine."

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 6
        stack.alignment = .leading
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.widthAnchor.constraint(greaterThanOrEqualToConstant: 380).isActive = true

        let pathLabel = NSTextField(labelWithString: "Path")
        pathLabel.font = NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)
        stack.addArrangedSubview(pathLabel)

        let pathValue = NSTextField(wrappingLabelWithString: path)
        pathValue.font = NSFont.monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
        pathValue.isSelectable = true
        pathValue.maximumNumberOfLines = 3
        stack.addArrangedSubview(pathValue)

        let opLabel = NSTextField(labelWithString: "Operation: \(operation.rawValue)")
        opLabel.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        opLabel.textColor = .secondaryLabelColor
        stack.addArrangedSubview(opLabel)

        let dirNote = NSTextField(
            labelWithString: "\"Always Allow\" will allow all files in \(URL(fileURLWithPath: path).deletingLastPathComponent().path)/")
        dirNote.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        dirNote.textColor = .tertiaryLabelColor
        dirNote.maximumNumberOfLines = 2
        stack.addArrangedSubview(dirNote)

        alert.accessoryView = stack
        alert.addButton(withTitle: "Allow Once")
        alert.addButton(withTitle: "Always Allow")
        alert.addButton(withTitle: "Don't Allow")
        if alert.buttons.indices.contains(2) {
            alert.buttons[2].hasDestructiveAction = true
        }

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            return .allowOnce
        case .alertSecondButtonReturn:
            return .allowAlways
        default:
            return .deny
        }
    }
}
