import Foundation
import OSLog

/// Handles node.invoke.request events from the gateway.
/// Dispatches to specialized command handlers with policy enforcement.
@MainActor @Observable
final class NodeEventHandler {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "node-events")

    private(set) var pendingInvokes: Int = 0
    private(set) var completedInvokes: Int = 0

    /// Blob endpoint for uploading/downloading large files via HTTP.
    var blobEndpoint: GatewayBlobUploader.Endpoint?

    /// Command and file access policy.
    let policy = CommandPolicy.shared

    /// Active tag ACL for the current conversation (defense-in-depth).
    /// Set by the server-side flow or resolved locally from conversation context.
    var currentTagAcl: Tag.NodeAcl?

    func handleInvokeRequest(_ frame: EventFrame, connection: UnifiedGatewayConnection) async {
        guard let payload = frame.payload?.value as? [String: Any] else {
            logger.warning("node.invoke.request with no payload")
            return
        }

        let invokeId = payload["id"] as? String ?? "unknown"
        let command = payload["command"] as? String ?? ""
        let paramsJSON = payload["paramsJSON"] as? String

        // Extract server-provided workspace root hint
        if let wsRootStr = payload["workspaceRoot"] as? String {
            ClawNetDataManager.setWorkspaceRootHint(URL(fileURLWithPath: wsRootStr))
        }

        // Extract tag ACL allowed paths as workspace root hints (Mac-local paths)
        if let aclDict = payload["tagNodeAcl"] as? [String: Any],
           let allowed = aclDict["allowedPaths"] as? [String] {
            for path in allowed where !path.contains("*") && !path.contains("?") {
                ClawNetDataManager.setWorkspaceRootHint(URL(fileURLWithPath: path))
            }
        }

        logger.info("Node invoke: id=\(invokeId, privacy: .public) command=\(command, privacy: .public)")
        self.pendingInvokes += 1

        let result: String
        do {
            result = try await dispatchCommand(command: command, paramsJSON: paramsJSON)
        } catch {
            result = errorJSON(error.localizedDescription)
        }

        do {
            try await connection.sendNodeInvokeResult(id: invokeId, resultJSON: result)
            self.completedInvokes += 1
        } catch {
            logger.error("Failed to send invoke result: \(error.localizedDescription, privacy: .public)")
        }
        self.pendingInvokes -= 1
    }

    // MARK: - Direct Command Execution (Server WebSocket flow)

    /// Execute a node command directly (called from server WebSocket flow).
    /// Returns the result JSON string.
    func executeCommand(command: String, paramsJSON: String?, blobEndpoint: GatewayBlobUploader.Endpoint? = nil, tagNodeAcl: Tag.NodeAcl? = nil, workspaceRoot: String? = nil) async -> String {
        if let ep = blobEndpoint {
            self.blobEndpoint = ep
        }
        if let acl = tagNodeAcl {
            self.currentTagAcl = acl
            // Use tag ACL allowed paths as workspace root hints (these are Mac-local paths)
            for allowed in acl.allowedPaths where !allowed.contains("*") && !allowed.contains("?") {
                ClawNetDataManager.setWorkspaceRootHint(URL(fileURLWithPath: allowed))
            }
        }
        if let wsRoot = workspaceRoot {
            ClawNetDataManager.setWorkspaceRootHint(URL(fileURLWithPath: wsRoot))
        }
        self.pendingInvokes += 1
        defer { self.pendingInvokes -= 1 }

        do {
            return try await dispatchCommand(command: command, paramsJSON: paramsJSON)
        } catch {
            return errorJSON(error.localizedDescription)
        }
    }

    // MARK: - Command Dispatch

    private func dispatchCommand(command: String, paramsJSON: String?) async throws -> String {
        let params = paramsJSON.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]

        // Tag ACL enforcement (defense-in-depth) for file operations
        if let tagAcl = currentTagAcl, command.hasPrefix("file.") {
            if let path = params["path"] as? String {
                let operation: CommandPolicy.FileOperation = command == "file.write" ? .write : .read
                let check = policy.validateFileAccessWithTagAcl(path: path, operation: operation, tagAcl: tagAcl)
                if !check.allowed {
                    return errorJSON("Tag ACL denied: \(check.reason)")
                }
            }
            // For commands with source/destination, also check those paths
            if let tagAcl = currentTagAcl {
                if let source = params["source"] as? String {
                    let check = policy.validateFileAccessWithTagAcl(path: source, operation: .read, tagAcl: tagAcl)
                    if !check.allowed { return errorJSON("Tag ACL denied (source): \(check.reason)") }
                }
                if let destination = params["destination"] as? String {
                    let check = policy.validateFileAccessWithTagAcl(path: destination, operation: .write, tagAcl: tagAcl)
                    if !check.allowed { return errorJSON("Tag ACL denied (destination): \(check.reason)") }
                }
            }
        }

        // Eagerly ensure .clawnet exists when workspace root is known
        if command.hasPrefix("file.") {
            let candidatePaths = [
                params["path"] as? String,
                params["source"] as? String,
                params["destination"] as? String,
            ].compactMap { $0 }
            for path in candidatePaths {
                if let wsRoot = ClawNetDataManager.workspaceRoot(for: path) {
                    try? ClawNetDataManager.ensureDirectory(ClawNetDataManager.clawnetDir(wsRoot: wsRoot))
                    break
                }
            }
        }

        let needsLog = OperationLogger.loggableCommands.contains(command)
        var opId: String?

        // Pre-execute: backup for file.write overwrites
        if needsLog {
            opId = OperationLogger.generateId()
            if command == "file.write" {
                preWriteBackup(params: params, opId: opId!)
            }
        }

        // Execute the actual command handler
        let result = try await executeHandler(command: command, params: params)

        // Post-execute: write operation log
        if needsLog, let opId {
            let isSuccess: Bool = {
                guard let data = result.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
                return obj["error"] == nil
            }()
            let wsRoot = resolveWsRoot(command: command, params: params)
            if let wsRoot {
                let reverseAction = isSuccess ? buildReverseAction(command: command, params: params, result: result, opId: opId, wsRoot: wsRoot) : nil
                let entry = OperationLogger.LogEntry(
                    id: opId,
                    timestamp: Int64(Date().timeIntervalSince1970 * 1000),
                    sessionId: currentSessionId,
                    command: command,
                    params: paramsToJSONValues(params),
                    result: isSuccess ? "success" : "error",
                    errorMessage: isSuccess ? nil : result,
                    reversible: reverseAction != nil,
                    reverseAction: reverseAction,
                    type: nil,
                    undoTargetId: nil
                )
                OperationLogger.shared.log(entry, wsRoot: wsRoot)

                // Inject operationId into successful responses so LLM can undo directly
                if isSuccess,
                   let resultData = result.data(using: .utf8),
                   var obj = try? JSONSerialization.jsonObject(with: resultData) as? [String: Any] {
                    obj["operationId"] = opId
                    if let enriched = try? JSONSerialization.data(withJSONObject: obj),
                       let enrichedStr = String(data: enriched, encoding: .utf8) {
                        return enrichedStr
                    }
                }
            }
        }

        return result
    }

    // MARK: - Command Router

    private func executeHandler(command: String, params: [String: Any]) async throws -> String {
        switch command {
        case "file.read":
            return try await FileCommandHandler.handleFileRead(params, policy: policy, blobEndpoint: blobEndpoint)
        case "file.write":
            return try await FileCommandHandler.handleFileWrite(params, policy: policy, blobEndpoint: blobEndpoint)
        case "file.stat":
            return try await FileCommandHandler.handleFileStat(params, policy: policy)
        case "file.list":
            return try await FileCommandHandler.handleFileList(params, policy: policy)
        case "file.search":
            return try await FileSearchHandler.handleFileSearch(params, policy: policy, blobEndpoint: blobEndpoint)
        case "file.move":
            return try await FileCommandHandler.handleFileMove(params, policy: policy)
        case "file.rename":
            return try await FileCommandHandler.handleFileRename(params, policy: policy)
        case "file.copy":
            return try await FileCommandHandler.handleFileCopy(params, policy: policy)
        case "file.mkdir":
            return try await FileCommandHandler.handleFileMkdir(params, policy: policy)
        case "file.trash":
            return try await FileTrashHandler.handleFileTrash(params, policy: policy)
        case "ops.log":
            return await OpsCommandHandler.handleOpsLog(params, policy: policy, currentSessionId: currentSessionId)
        case "ops.undo":
            return await OpsCommandHandler.handleOpsUndo(params, policy: policy, currentSessionId: currentSessionId)
        case "ops.rollback":
            return await OpsCommandHandler.handleOpsRollback(params, policy: policy, currentSessionId: currentSessionId)
        default:
            return errorJSON("unsupported command: \(command)")
        }
    }

    // MARK: - Session ID

    /// Current session ID, set by ChatService when a conversation is active.
    var currentSessionId: String?

    // MARK: - Workspace Root Resolution

    private func resolveWsRoot(command: String, params: [String: Any]) -> URL? {
        // Try to find a relevant path from params to determine workspace root
        let candidatePaths = [
            params["path"] as? String,
            params["source"] as? String,
            params["destination"] as? String,
        ].compactMap { $0 }

        for path in candidatePaths {
            if let wsRoot = ClawNetDataManager.workspaceRoot(for: path) {
                return wsRoot
            }
        }
        return nil
    }

    // MARK: - Pre-write Backup

    private func preWriteBackup(params: [String: Any], opId: String) {
        guard let path = params["path"] as? String else { return }
        let isAppend = params["append"] as? Bool ?? false
        guard !isAppend else { return } // Only backup on overwrite, not append

        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else { return } // New file, no backup needed

        guard let wsRoot = ClawNetDataManager.workspaceRoot(for: path) else { return }

        do {
            let snapshotDir = ClawNetDataManager.snapshotsDir(wsRoot: wsRoot)
                .appendingPathComponent(opId, isDirectory: true)
            try ClawNetDataManager.ensureDirectory(snapshotDir)

            let fileName = URL(fileURLWithPath: path).lastPathComponent
            let destURL = snapshotDir.appendingPathComponent(fileName)
            try fm.copyItem(at: URL(fileURLWithPath: path), to: destURL)
        } catch {
            logger.warning("Pre-write backup failed for \(path, privacy: .public): \(error.localizedDescription)")
        }
    }

    // MARK: - Reverse Action Builder

    private func buildReverseAction(command: String, params: [String: Any], result: String, opId: String, wsRoot: URL) -> OperationLogger.ReverseAction? {
        switch command {
        case "file.move":
            guard let source = params["source"] as? String,
                  let dest = params["destination"] as? String else { return nil }
            return OperationLogger.ReverseAction(
                command: "file.move",
                params: ["source": .string(dest), "destination": .string(source)]
            )

        case "file.rename":
            guard let path = params["path"] as? String,
                  let newName = params["newName"] as? String else { return nil }
            let parentDir = URL(fileURLWithPath: path).deletingLastPathComponent().path
            let oldName = URL(fileURLWithPath: path).lastPathComponent
            let newPath = parentDir + "/" + newName
            return OperationLogger.ReverseAction(
                command: "file.rename",
                params: ["path": .string(newPath), "newName": .string(oldName)]
            )

        case "file.copy":
            guard let dest = params["destination"] as? String else { return nil }
            return OperationLogger.ReverseAction(
                command: "file.trash",
                params: ["path": .string(dest)]
            )

        case "file.mkdir":
            guard let path = params["path"] as? String else { return nil }
            return OperationLogger.ReverseAction(
                command: "_internal.rmdir",
                params: ["path": .string(path)]
            )

        case "file.write":
            guard let path = params["path"] as? String else { return nil }
            let isAppend = params["append"] as? Bool ?? false
            if isAppend { return nil } // Append writes are not reversible

            let snapshotDir = ClawNetDataManager.snapshotsDir(wsRoot: wsRoot)
                .appendingPathComponent(opId, isDirectory: true)
            if FileManager.default.fileExists(atPath: snapshotDir.path) {
                // Overwrite: restore from snapshot
                return OperationLogger.ReverseAction(
                    command: "_internal.restore_snapshot",
                    params: ["path": .string(path), "opId": .string(opId)]
                )
            } else {
                // New file: trash it
                return OperationLogger.ReverseAction(
                    command: "file.trash",
                    params: ["path": .string(path)]
                )
            }

        case "file.trash":
            // Extract trashId from result JSON
            if let data = result.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let trashId = json["trashId"] as? String,
               let originalPath = params["path"] as? String {
                return OperationLogger.ReverseAction(
                    command: "_internal.restore_trash",
                    params: ["trashId": .string(trashId), "originalPath": .string(originalPath)]
                )
            }
            return nil

        default:
            return nil
        }
    }
}
