import Foundation
import OSLog

/// Handles ops.log, ops.undo, ops.rollback commands for operation history and rollback.
@MainActor
enum OpsCommandHandler {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "ops-commands")

    // MARK: - ops.log

    static func handleOpsLog(_ params: [String: Any], policy: CommandPolicy, currentSessionId: String? = nil) async -> String {
        guard let wsRoot = resolveWsRoot(from: params, policy: policy) else {
            return errorJSON("NO_WORKSPACE: cannot determine workspace. Provide a 'path' parameter or ensure a workspace is configured.")
        }

        // Default to current session — agent only sees its own operations unless explicitly overridden
        let filter = OperationLogger.LogFilter(
            sessionId: params["sessionId"] as? String ?? currentSessionId,
            command: params["command"] as? String,
            since: (params["since"] as? NSNumber)?.int64Value,
            until: (params["until"] as? NSNumber)?.int64Value,
            limit: params["limit"] as? Int ?? 50,
            offset: params["offset"] as? Int ?? 0
        )

        let result = OperationLogger.shared.query(filter: filter, wsRoot: wsRoot)

        // Convert entries to JSON-serializable dicts
        let entriesJSON: [[String: Any]] = result.entries.map { entry in
            var dict: [String: Any] = [
                "id": entry.id,
                "timestamp": entry.timestamp,
                "command": entry.command,
                "result": entry.result,
                "reversible": entry.reversible,
            ]
            if let sid = entry.sessionId { dict["sessionId"] = sid }
            if let err = entry.errorMessage { dict["errorMessage"] = err }
            if let type = entry.type { dict["type"] = type }
            if let target = entry.undoTargetId { dict["undoTargetId"] = target }

            // Convert params
            var paramsDict: [String: Any] = [:]
            for (k, v) in entry.params {
                switch v {
                case .string(let s): paramsDict[k] = s
                case .int(let i): paramsDict[k] = i
                case .double(let d): paramsDict[k] = d
                case .bool(let b): paramsDict[k] = b
                case .null: break
                }
            }
            dict["params"] = paramsDict

            return dict
        }

        return okJSON([
            "entries": entriesJSON,
            "total": result.total,
            "hasMore": result.hasMore,
        ])
    }

    // MARK: - ops.undo

    static func handleOpsUndo(_ params: [String: Any], policy: CommandPolicy, currentSessionId: String? = nil) async -> String {
        guard let operationId = params["operationId"] as? String, !operationId.isEmpty else {
            return errorJSON("missing operationId")
        }

        guard let wsRoot = resolveWsRoot(from: params, policy: policy) else {
            return errorJSON("NO_WORKSPACE: cannot determine workspace")
        }

        // 1. Find the operation
        guard let entry = OperationLogger.shared.findEntry(operationId: operationId, wsRoot: wsRoot) else {
            return errorJSON("NOT_FOUND: operation '\(operationId)' not found")
        }

        // 1.5. Check session ownership — agent can only undo its own session's operations
        if let currentSid = currentSessionId, entry.sessionId != currentSid {
            return errorJSON("NOT_FOUND: operation '\(operationId)' not found")
        }

        // 2. Check reversible
        guard entry.reversible, let reverseAction = entry.reverseAction else {
            return errorJSON("NOT_REVERSIBLE: operation '\(operationId)' cannot be undone")
        }

        // 3. Check not already undone
        if OperationLogger.shared.isUndone(operationId: operationId, wsRoot: wsRoot) {
            return errorJSON("ALREADY_UNDONE: operation '\(operationId)' has already been undone")
        }

        // 4. Validate preconditions
        let validation = UndoValidator.validate(entry: entry, wsRoot: wsRoot)
        guard validation.canUndo else {
            return errorJSON(validation.reason ?? "CONFLICT: cannot undo operation")
        }

        // 5. Execute the reverse action
        do {
            try UndoValidator.performUndo(entry: entry, wsRoot: wsRoot)
        } catch {
            return errorJSON("UNDO_FAILED: \(error.localizedDescription)")
        }

        // 6. Log the undo operation
        let undoEntry = OperationLogger.LogEntry(
            id: OperationLogger.generateId(),
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            sessionId: nil,
            command: entry.command,
            params: entry.params,
            result: "success",
            errorMessage: nil,
            reversible: false,
            reverseAction: nil,
            type: "undo",
            undoTargetId: operationId
        )
        OperationLogger.shared.log(undoEntry, wsRoot: wsRoot)

        // Build response
        var reverseActionDict: [String: Any] = ["command": reverseAction.command]
        var reverseParams: [String: Any] = [:]
        for (k, v) in reverseAction.params {
            switch v {
            case .string(let s): reverseParams[k] = s
            case .int(let i): reverseParams[k] = i
            case .double(let d): reverseParams[k] = d
            case .bool(let b): reverseParams[k] = b
            case .null: break
            }
        }
        reverseActionDict["params"] = reverseParams

        return okJSON([
            "operationId": operationId,
            "undone": true,
            "reverseAction": reverseActionDict,
        ])
    }

    // MARK: - ops.rollback

    static func handleOpsRollback(_ params: [String: Any], policy: CommandPolicy, currentSessionId: String? = nil) async -> String {
        guard let wsRoot = resolveWsRoot(from: params, policy: policy) else {
            return errorJSON("NO_WORKSPACE: cannot determine workspace")
        }

        let dryRun = params["dryRun"] as? Bool ?? true
        // Default to current session — agent can only rollback its own operations
        let sessionId = params["sessionId"] as? String ?? currentSessionId
        let since = (params["since"] as? NSNumber)?.int64Value

        guard sessionId != nil || since != nil else {
            return errorJSON("missing sessionId or since parameter (one is required)")
        }

        // Query all operations matching the criteria
        let filter = OperationLogger.LogFilter(
            sessionId: sessionId,
            since: since,
            limit: 10000,
            offset: 0
        )
        let queryResult = OperationLogger.shared.query(filter: filter, wsRoot: wsRoot)

        // Filter to only normal operations (not undo/rollback entries) that haven't been undone
        let candidates = queryResult.entries.filter { entry in
            entry.type == nil && !OperationLogger.shared.isUndone(operationId: entry.id, wsRoot: wsRoot)
        }

        // Already sorted by timestamp desc (most recent first) from query

        if dryRun {
            let reversibleCount = candidates.filter(\.reversible).count
            let irreversibleCount = candidates.count - reversibleCount

            let operations: [[String: Any]] = candidates.map { entry in
                var dict: [String: Any] = [
                    "id": entry.id,
                    "command": entry.command,
                    "reversible": entry.reversible,
                ]
                if let ra = entry.reverseAction {
                    var raDict: [String: Any] = ["command": ra.command]
                    var raParams: [String: Any] = [:]
                    for (k, v) in ra.params {
                        switch v {
                        case .string(let s): raParams[k] = s
                        case .int(let i): raParams[k] = i
                        case .double(let d): raParams[k] = d
                        case .bool(let b): raParams[k] = b
                        case .null: break
                        }
                    }
                    raDict["params"] = raParams
                    dict["reverseAction"] = raDict
                }
                return dict
            }

            return okJSON([
                "dryRun": true,
                "operations": operations,
                "totalOperations": candidates.count,
                "reversibleCount": reversibleCount,
                "irreversibleCount": irreversibleCount,
            ])
        }

        // Execute mode: undo each reversible operation in order (most recent first)
        var undoneCount = 0
        var failedOperations: [[String: Any]] = []

        for entry in candidates {
            guard entry.reversible, entry.reverseAction != nil else {
                failedOperations.append(["id": entry.id, "reason": "NOT_REVERSIBLE"])
                break // Stop on first failure
            }

            let validation = UndoValidator.validate(entry: entry, wsRoot: wsRoot)
            guard validation.canUndo else {
                failedOperations.append(["id": entry.id, "reason": validation.reason ?? "CONFLICT"])
                break
            }

            do {
                try UndoValidator.performUndo(entry: entry, wsRoot: wsRoot)

                // Log the undo
                let undoEntry = OperationLogger.LogEntry(
                    id: OperationLogger.generateId(),
                    timestamp: Int64(Date().timeIntervalSince1970 * 1000),
                    sessionId: nil,
                    command: entry.command,
                    params: entry.params,
                    result: "success",
                    errorMessage: nil,
                    reversible: false,
                    reverseAction: nil,
                    type: "undo",
                    undoTargetId: entry.id
                )
                OperationLogger.shared.log(undoEntry, wsRoot: wsRoot)
                undoneCount += 1
            } catch {
                failedOperations.append(["id": entry.id, "reason": error.localizedDescription])
                break
            }
        }

        // Log the rollback itself
        let rollbackEntry = OperationLogger.LogEntry(
            id: OperationLogger.generateId(),
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            sessionId: sessionId,
            command: "ops.rollback",
            params: paramsToJSONValues(params),
            result: failedOperations.isEmpty ? "success" : "partial",
            errorMessage: failedOperations.isEmpty ? nil : "stopped at failed operation",
            reversible: false,
            reverseAction: nil,
            type: "rollback",
            undoTargetId: nil
        )
        OperationLogger.shared.log(rollbackEntry, wsRoot: wsRoot)

        return okJSON([
            "dryRun": false,
            "undone": undoneCount,
            "failed": failedOperations.count,
            "failedOperations": failedOperations,
        ])
    }

    // MARK: - Helpers

    /// Resolve workspace root from params.
    /// 1. Try explicit path param
    /// 2. Scan all bookmark roots for one that has .clawnet/logs/ (find where logs actually live)
    /// 3. Fall back to first granted bookmark
    private static func resolveWsRoot(from params: [String: Any], policy: CommandPolicy) -> URL? {
        if let path = params["path"] as? String,
           let wsRoot = ClawNetDataManager.workspaceRoot(for: path) {
            return wsRoot
        }
        // Scan all bookmark roots — find the one that actually has .clawnet/logs/
        let fm = FileManager.default
        for granted in BookmarkStore.shared.grantedPaths {
            let root = URL(fileURLWithPath: granted)
            let logsDir = ClawNetDataManager.logsDir(wsRoot: root)
            if fm.fileExists(atPath: logsDir.path) {
                return root
            }
        }
        // Fall back to first granted bookmark
        if let firstGranted = BookmarkStore.shared.grantedPaths.first {
            return URL(fileURLWithPath: firstGranted)
        }
        return nil
    }
}

// MARK: - Undo Validator

/// Validates and executes reverse actions for operation undo.
@MainActor
enum UndoValidator {
    struct UndoCheck {
        let canUndo: Bool
        let reason: String?
    }

    static func validate(entry: OperationLogger.LogEntry, wsRoot: URL) -> UndoCheck {
        guard let reverseAction = entry.reverseAction else {
            return UndoCheck(canUndo: false, reason: "NOT_REVERSIBLE: no reverse action defined")
        }

        let fm = FileManager.default

        switch reverseAction.command {
        case "file.move":
            // Reverse of file.move or file.rename: move destination back to source
            guard let source = reverseAction.params["source"]?.stringValue,
                  let dest = reverseAction.params["destination"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing source/destination")
            }
            if !fm.fileExists(atPath: source) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: file no longer at '\(source)'")
            }
            if fm.fileExists(atPath: dest) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: original path '\(dest)' is occupied")
            }
            return UndoCheck(canUndo: true, reason: nil)

        case "file.rename":
            // Reverse of file.rename: rename back
            guard let path = reverseAction.params["path"]?.stringValue,
                  let newName = reverseAction.params["newName"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing path/newName")
            }
            if !fm.fileExists(atPath: path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: renamed file '\(path)' no longer exists")
            }
            let destURL = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent(newName)
            if fm.fileExists(atPath: destURL.path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: original name '\(newName)' is occupied")
            }
            return UndoCheck(canUndo: true, reason: nil)

        case "file.trash":
            // Reverse of file.copy or file.write(new): trash the created file
            guard let path = reverseAction.params["path"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing path")
            }
            if !fm.fileExists(atPath: path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: file '\(path)' no longer exists")
            }
            return UndoCheck(canUndo: true, reason: nil)

        case "_internal.rmdir":
            guard let path = reverseAction.params["path"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing path")
            }
            var isDir: ObjCBool = false
            if !fm.fileExists(atPath: path, isDirectory: &isDir) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: directory '\(path)' no longer exists")
            }
            if !isDir.boolValue {
                return UndoCheck(canUndo: false, reason: "CONFLICT: '\(path)' is not a directory")
            }
            let contents = (try? fm.contentsOfDirectory(atPath: path)) ?? []
            if !contents.isEmpty {
                return UndoCheck(canUndo: false, reason: "CONFLICT: directory '\(path)' is not empty (\(contents.count) items)")
            }
            return UndoCheck(canUndo: true, reason: nil)

        case "_internal.restore_snapshot":
            guard let path = reverseAction.params["path"]?.stringValue,
                  let opId = reverseAction.params["opId"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing path/opId")
            }
            let snapshotDir = ClawNetDataManager.snapshotsDir(wsRoot: wsRoot).appendingPathComponent(opId)
            if !fm.fileExists(atPath: snapshotDir.path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: snapshot '\(opId)' not found")
            }
            if !fm.fileExists(atPath: path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: file '\(path)' no longer exists")
            }
            return UndoCheck(canUndo: true, reason: nil)

        case "_internal.restore_trash":
            guard let trashId = reverseAction.params["trashId"]?.stringValue else {
                return UndoCheck(canUndo: false, reason: "INVALID: reverse action missing trashId")
            }
            let trashDir = ClawNetDataManager.trashDir(wsRoot: wsRoot).appendingPathComponent(trashId)
            if !fm.fileExists(atPath: trashDir.path) {
                return UndoCheck(canUndo: false, reason: "CONFLICT: trash entry '\(trashId)' not found")
            }
            if let originalPath = reverseAction.params["originalPath"]?.stringValue {
                if fm.fileExists(atPath: originalPath) {
                    return UndoCheck(canUndo: false, reason: "CONFLICT: original path '\(originalPath)' is occupied")
                }
                let parentDir = URL(fileURLWithPath: originalPath).deletingLastPathComponent()
                var isDir: ObjCBool = false
                if !fm.fileExists(atPath: parentDir.path, isDirectory: &isDir) || !isDir.boolValue {
                    return UndoCheck(canUndo: false, reason: "CONFLICT: parent directory '\(parentDir.path)' no longer exists")
                }
            }
            return UndoCheck(canUndo: true, reason: nil)

        default:
            return UndoCheck(canUndo: false, reason: "NOT_REVERSIBLE: unknown reverse command '\(reverseAction.command)'")
        }
    }

    static func performUndo(entry: OperationLogger.LogEntry, wsRoot: URL) throws {
        guard let reverseAction = entry.reverseAction else {
            throw NSError(domain: "OpsUndo", code: 1, userInfo: [NSLocalizedDescriptionKey: "no reverse action"])
        }

        let fm = FileManager.default

        switch reverseAction.command {
        case "file.move":
            guard let source = reverseAction.params["source"]?.stringValue,
                  let dest = reverseAction.params["destination"]?.stringValue else { throw undoError("missing params") }
            try fm.moveItem(at: URL(fileURLWithPath: source), to: URL(fileURLWithPath: dest))

        case "file.rename":
            guard let path = reverseAction.params["path"]?.stringValue,
                  let newName = reverseAction.params["newName"]?.stringValue else { throw undoError("missing params") }
            let sourceURL = URL(fileURLWithPath: path)
            let destURL = sourceURL.deletingLastPathComponent().appendingPathComponent(newName)
            try fm.moveItem(at: sourceURL, to: destURL)

        case "file.trash":
            guard let path = reverseAction.params["path"]?.stringValue else { throw undoError("missing path") }
            // Use the trash handler to properly trash the file
            guard let trashWsRoot = ClawNetDataManager.workspaceRoot(for: path) else {
                throw undoError("cannot determine workspace root")
            }
            let trashId = ClawNetDataManager.generateTrashId()
            let trashEntryDir = ClawNetDataManager.trashDir(wsRoot: trashWsRoot)
                .appendingPathComponent(trashId, isDirectory: true)
            try ClawNetDataManager.ensureDirectory(trashEntryDir)

            let meta = FileTrashHandler.TrashMeta(
                originalPath: path,
                trashedAt: Int64(Date().timeIntervalSince1970 * 1000),
                sessionId: nil
            )
            let metaData = try JSONEncoder().encode(meta)
            try metaData.write(to: trashEntryDir.appendingPathComponent("_meta.json"), options: [.atomic])

            let fileName = URL(fileURLWithPath: path).lastPathComponent
            try fm.moveItem(at: URL(fileURLWithPath: path), to: trashEntryDir.appendingPathComponent(fileName))

        case "_internal.rmdir":
            guard let path = reverseAction.params["path"]?.stringValue else { throw undoError("missing path") }
            try fm.removeItem(at: URL(fileURLWithPath: path))

        case "_internal.restore_snapshot":
            guard let path = reverseAction.params["path"]?.stringValue,
                  let opId = reverseAction.params["opId"]?.stringValue else { throw undoError("missing params") }
            let snapshotDir = ClawNetDataManager.snapshotsDir(wsRoot: wsRoot).appendingPathComponent(opId)
            let snapshotContents = try fm.contentsOfDirectory(atPath: snapshotDir.path)
            guard let fileName = snapshotContents.first else { throw undoError("snapshot is empty") }
            let snapshotFile = snapshotDir.appendingPathComponent(fileName)

            // Overwrite current file with snapshot
            try fm.removeItem(at: URL(fileURLWithPath: path))
            try fm.copyItem(at: snapshotFile, to: URL(fileURLWithPath: path))

            // Clean up snapshot
            try? fm.removeItem(at: snapshotDir)

        case "_internal.restore_trash":
            guard let trashId = reverseAction.params["trashId"]?.stringValue else { throw undoError("missing trashId") }
            _ = try FileTrashHandler.restoreFromTrash(trashId: trashId, wsRoot: wsRoot)

        default:
            throw undoError("unknown reverse command: \(reverseAction.command)")
        }
    }

    // MARK: - Helpers

    private static func undoError(_ message: String) -> NSError {
        NSError(domain: "OpsUndo", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

}
