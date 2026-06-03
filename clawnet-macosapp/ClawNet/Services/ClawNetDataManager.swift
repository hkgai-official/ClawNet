import Foundation
import OSLog

/// Manages the `.clawnet/` directory structure within each workspace root.
/// Each BookmarkStore granted path maintains its own independent `.clawnet/` directory.
@MainActor
enum ClawNetDataManager {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "clawnet-data")

    static let clawnetDirName = ".clawnet"
    static let logsDirName = "logs"
    static let trashDirName = "trash"
    static let snapshotsDirName = "snapshots"

    // MARK: - Server-Provided Workspace Root Hints

    /// Cache of server-provided workspace root hints.
    /// Key: normalized file path prefix, Value: workspace root URL.
    private static var _wsRootHints: [String: URL] = [:]

    /// Store a server-provided workspace root hint for a given path prefix.
    static func setWorkspaceRootHint(_ wsRoot: URL) {
        let key = wsRoot.standardizedFileURL.path
        _wsRootHints[key] = wsRoot
    }

    /// Try to resolve workspace root from server-provided hints.
    /// Returns the hint root if the given path falls within any hinted workspace.
    static func workspaceRootFromHint(for path: String) -> URL? {
        let resolved = URL(fileURLWithPath: path).standardizedFileURL.path
        var bestMatch: (String, URL)?
        for (prefix, root) in _wsRootHints {
            let dir = prefix.hasSuffix("/") ? prefix : prefix + "/"
            if resolved.hasPrefix(dir) || resolved == prefix {
                if bestMatch == nil || prefix.count > bestMatch!.0.count {
                    bestMatch = (prefix, root)
                }
            }
        }
        return bestMatch?.1
    }

    // MARK: - Workspace Root Resolution

    /// Find the workspace root for a given path.
    /// 1. Match against BookmarkStore granted paths (longest match)
    /// 2. Fallback: walk up from file path looking for existing .clawnet directory
    /// 3. Fallback: match against CommandPolicy allowed paths
    static func workspaceRoot(for path: String) -> URL? {
        // 0. Server-provided hint (highest priority)
        if let hinted = workspaceRootFromHint(for: path) {
            return hinted
        }

        let resolved = URL(fileURLWithPath: path).standardizedFileURL.path

        // 1. BookmarkStore match (preferred)
        var bestMatch: String?
        for granted in BookmarkStore.shared.grantedPaths {
            let dir = granted.hasSuffix("/") ? granted : granted + "/"
            if resolved.hasPrefix(dir) || resolved == granted {
                if bestMatch == nil || granted.count > bestMatch!.count {
                    bestMatch = granted
                }
            }
        }
        if let root = bestMatch {
            return URL(fileURLWithPath: root)
        }

        // 2. Walk up from file path looking for existing .clawnet
        var current = URL(fileURLWithPath: resolved).deletingLastPathComponent()
        let fm = FileManager.default
        for _ in 0..<20 {
            let candidate = current.appendingPathComponent(clawnetDirName)
            if fm.fileExists(atPath: candidate.path) {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
            current = parent
        }

        // 3. CommandPolicy allowed paths match
        for allowed in CommandPolicy.shared.allowedPaths {
            let dir = allowed.hasSuffix("/") ? allowed : allowed + "/"
            if !allowed.contains("*") && !allowed.contains("?") {
                if resolved.hasPrefix(dir) || resolved == allowed {
                    if bestMatch == nil || allowed.count > bestMatch!.count {
                        bestMatch = allowed
                    }
                }
            }
        }
        if let root = bestMatch {
            return URL(fileURLWithPath: root)
        }

        return nil
    }

    // MARK: - Directory Paths

    static func clawnetDir(wsRoot: URL) -> URL {
        wsRoot.appendingPathComponent(clawnetDirName, isDirectory: true)
    }

    static func logsDir(wsRoot: URL) -> URL {
        clawnetDir(wsRoot: wsRoot).appendingPathComponent(logsDirName, isDirectory: true)
    }

    static func trashDir(wsRoot: URL) -> URL {
        clawnetDir(wsRoot: wsRoot).appendingPathComponent(trashDirName, isDirectory: true)
    }

    static func snapshotsDir(wsRoot: URL) -> URL {
        clawnetDir(wsRoot: wsRoot).appendingPathComponent(snapshotsDirName, isDirectory: true)
    }

    // MARK: - Directory Creation

    /// Ensure a directory exists, creating it and intermediate directories if needed.
    @discardableResult
    static func ensureDirectory(_ url: URL) throws -> URL {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) {
            try fm.createDirectory(at: url, withIntermediateDirectories: true)
            logger.info("Created directory: \(url.path, privacy: .public)")
        }
        return url
    }

    // MARK: - ID Generation

    /// Generate a unique trash entry ID: yyyyMMdd_HHmmss_xxxx (4-digit hex).
    static func generateTrashId() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        formatter.timeZone = TimeZone.current
        let timestamp = formatter.string(from: Date())
        let hex = String(format: "%04x", UInt16.random(in: 0...UInt16.max))
        return "\(timestamp)_\(hex)"
    }

    // MARK: - .clawnet Visibility

    /// Check if a path is inside a `.clawnet` directory (should be hidden from file.list).
    static func isClawNetInternalPath(_ path: String) -> Bool {
        path.contains("/\(clawnetDirName)/") || path.hasSuffix("/\(clawnetDirName)")
    }
}
