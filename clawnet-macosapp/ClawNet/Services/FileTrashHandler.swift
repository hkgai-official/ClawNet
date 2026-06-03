import Foundation
import OSLog

/// Handles file.trash command: moves files to `.clawnet/trash/` with metadata for recovery.
/// Uses "write meta first, then move" pattern for atomicity safety.
@MainActor
enum FileTrashHandler {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "file-trash")

    // MARK: - file.trash

    static func handleFileTrash(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        // Require both read and write access
        let readCheck = policy.validateFileAccess(path: path, operation: .read)
        guard readCheck.allowed else { return errorJSON(readCheck.reason) }
        let writeCheck = policy.validateFileAccess(path: path, operation: .write)
        guard writeCheck.allowed else { return errorJSON(writeCheck.reason) }

        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let sourceURL = scopedURL ?? URL(fileURLWithPath: path)

        let fm = FileManager.default
        guard fm.fileExists(atPath: sourceURL.path) else {
            return errorJSON("NOT_FOUND: \(path)")
        }

        // Resolve workspace root
        guard let wsRoot = ClawNetDataManager.workspaceRoot(for: path) else {
            return errorJSON("NO_WORKSPACE: cannot determine workspace root for path '\(path)'")
        }

        // Generate trash entry ID: yyyyMMdd_HHmmss_xxxx
        let trashId = ClawNetDataManager.generateTrashId()

        let trashEntryDir = ClawNetDataManager.trashDir(wsRoot: wsRoot)
            .appendingPathComponent(trashId, isDirectory: true)

        do {
            // Step 1: Create trash entry directory
            try ClawNetDataManager.ensureDirectory(trashEntryDir)

            // Step 2: Write _meta.json FIRST (before moving the file)
            let meta = TrashMeta(
                originalPath: path,
                trashedAt: Int64(Date().timeIntervalSince1970 * 1000),
                sessionId: nil // Could be set from context if available
            )
            let metaData = try JSONEncoder().encode(meta)
            let metaURL = trashEntryDir.appendingPathComponent("_meta.json")
            try metaData.write(to: metaURL, options: [.atomic])

            // Step 3: Move the file into the trash directory
            let fileName = sourceURL.lastPathComponent
            let trashFileURL = trashEntryDir.appendingPathComponent(fileName)
            try fm.moveItem(at: sourceURL, to: trashFileURL)

        } catch {
            // Cleanup: remove the trash entry directory if anything failed
            try? fm.removeItem(at: trashEntryDir)
            throw error
        }

        logger.info("Trashed: \(path, privacy: .public) -> \(trashId, privacy: .public)")
        return okJSON(["path": path, "trashId": trashId])
    }

    // MARK: - Restore from Trash (used by ops.undo)

    /// Restore a trashed file back to its original path.
    /// Returns the restored path on success, or throws on failure.
    static func restoreFromTrash(trashId: String, wsRoot: URL) throws -> String {
        let fm = FileManager.default
        let trashEntryDir = ClawNetDataManager.trashDir(wsRoot: wsRoot)
            .appendingPathComponent(trashId, isDirectory: true)

        guard fm.fileExists(atPath: trashEntryDir.path) else {
            throw TrashError.entryNotFound(trashId)
        }

        // Read meta
        let metaURL = trashEntryDir.appendingPathComponent("_meta.json")
        let metaData = try Data(contentsOf: metaURL)
        let meta = try JSONDecoder().decode(TrashMeta.self, from: metaData)

        let originalURL = URL(fileURLWithPath: meta.originalPath)

        // Check original path is not occupied
        guard !fm.fileExists(atPath: originalURL.path) else {
            throw TrashError.conflict("original path '\(meta.originalPath)' is occupied")
        }

        // Check parent directory exists
        let parentDir = originalURL.deletingLastPathComponent()
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: parentDir.path, isDirectory: &isDir), isDir.boolValue else {
            throw TrashError.conflict("parent directory '\(parentDir.path)' no longer exists")
        }

        // Find the actual file in trash (everything except _meta.json)
        let trashContents = try fm.contentsOfDirectory(atPath: trashEntryDir.path)
        guard let fileName = trashContents.first(where: { $0 != "_meta.json" }) else {
            throw TrashError.conflict("trash entry '\(trashId)' contains no file")
        }

        let trashFileURL = trashEntryDir.appendingPathComponent(fileName)
        try fm.moveItem(at: trashFileURL, to: originalURL)

        // Clean up the trash entry directory
        try? fm.removeItem(at: trashEntryDir)

        return meta.originalPath
    }

    // MARK: - Helpers

    // MARK: - Models

    struct TrashMeta: Codable {
        let originalPath: String
        let trashedAt: Int64
        let sessionId: String?
    }

    enum TrashError: LocalizedError {
        case entryNotFound(String)
        case conflict(String)

        var errorDescription: String? {
            switch self {
            case .entryNotFound(let id): return "TRASH_NOT_FOUND: trash entry '\(id)' not found"
            case .conflict(let reason): return "CONFLICT: \(reason)"
            }
        }
    }
}
