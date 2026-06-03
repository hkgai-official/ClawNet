import Foundation
import OSLog

/// Handles file.read, file.write, file.stat, file.list, file.move, file.rename, file.copy, file.mkdir commands.
@MainActor
enum FileCommandHandler {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "file-commands")
    private static let blobReadMaxBytes = 100 * 1024 * 1024  // 100 MB

    // MARK: - file.read

    static func handleFileRead(
        _ params: [String: Any],
        policy: CommandPolicy,
        blobEndpoint: GatewayBlobUploader.Endpoint?
    ) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        let accessCheck = policy.validateFileAccess(path: path, operation: .read)
        guard accessCheck.allowed else {
            return errorJSON(accessCheck.reason)
        }

        // Try security-scoped bookmark; fall back to raw path (works in dev / non-sandbox).
        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let targetURL = scopedURL ?? URL(fileURLWithPath: path)

        let fm = FileManager.default
        guard fm.fileExists(atPath: targetURL.path) else {
            return errorJSON("NOT_FOUND: \(path)")
        }

        let attrs = try fm.attributesOfItem(atPath: targetURL.path)
        let fileSize = (attrs[.size] as? Int) ?? 0

        let handle = try FileHandle(forReadingFrom: targetURL)
        defer { try? handle.close() }

        let offset = max(0, (params["offset"] as? Int) ?? 0)
        if offset > 0 {
            try handle.seek(toOffset: UInt64(offset))
        }

        let maxRead = blobReadMaxBytes
        let limit = min((params["limit"] as? Int) ?? maxRead, maxRead)
        let data = handle.readData(ofLength: limit)
        let bytesRead = data.count
        let hasMore = (offset + bytesRead) < fileSize

        let encoding = (params["encoding"] as? String) ?? "utf8"
        let isText = encoding != "base64" && String(data: data, encoding: .utf8) != nil

        guard let endpoint = blobEndpoint else {
            return errorJSON("BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.read")
        }

        guard let blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint) else {
            return errorJSON("BLOB_UPLOAD_FAILED: failed to upload file data to gateway")
        }

        return okJSON([
            "transfer": "blob",
            "blobId": blobId,
            "encoding": isText ? "utf8" : "base64",
            "size": fileSize,
            "offset": offset,
            "bytesRead": bytesRead,
            "hasMore": hasMore,
        ])
    }

    // MARK: - file.write

    static func handleFileWrite(
        _ params: [String: Any],
        policy: CommandPolicy,
        blobEndpoint: GatewayBlobUploader.Endpoint?
    ) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        let accessCheck = policy.validateFileAccess(path: path, operation: .write)
        guard accessCheck.allowed else {
            return errorJSON(accessCheck.reason)
        }

        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let targetURL = scopedURL ?? URL(fileURLWithPath: path)

        if params["createDirs"] as? Bool == true {
            let dir = targetURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        guard let blobId = params["blobId"] as? String, !blobId.isEmpty else {
            return errorJSON("missing blobId: file.write requires blob transfer")
        }
        guard let endpoint = blobEndpoint else {
            return errorJSON("BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.write")
        }
        guard let writeData = await GatewayBlobDownloader.download(blobId: blobId, endpoint: endpoint) else {
            return errorJSON("BLOB_DOWNLOAD_FAILED: \(blobId)")
        }

        if params["append"] as? Bool == true {
            if FileManager.default.fileExists(atPath: targetURL.path) {
                let handle = try FileHandle(forWritingTo: targetURL)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(writeData)
            } else {
                try writeData.write(to: targetURL, options: [.atomic])
            }
        } else {
            try writeData.write(to: targetURL, options: [.atomic])
        }

        return okJSON(["path": path, "bytesWritten": writeData.count])
    }

    // MARK: - file.stat

    static func handleFileStat(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        let accessCheck = policy.validateFileAccess(path: path, operation: .read)
        guard accessCheck.allowed else {
            return errorJSON(accessCheck.reason)
        }

        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let targetURL = scopedURL ?? URL(fileURLWithPath: path)

        let fm = FileManager.default
        guard fm.fileExists(atPath: targetURL.path) else {
            return errorJSON("NOT_FOUND: \(path)")
        }

        let attrs = try fm.attributesOfItem(atPath: targetURL.path)
        let fileType = attrs[.type] as? FileAttributeType
        let typeStr: String
        switch fileType {
        case .typeDirectory: typeStr = "directory"
        case .typeSymbolicLink: typeStr = "symlink"
        default: typeStr = "file"
        }

        var result: [String: Any] = [
            "path": path,
            "type": typeStr,
            "size": (attrs[.size] as? UInt64) ?? 0,
            "permissions": (attrs[.posixPermissions] as? Int) ?? 0,
            "readable": fm.isReadableFile(atPath: targetURL.path),
            "writable": fm.isWritableFile(atPath: targetURL.path),
        ]

        if let created = attrs[.creationDate] as? Date {
            result["createdAt"] = created.timeIntervalSince1970 * 1000
        }
        if let modified = attrs[.modificationDate] as? Date {
            result["modifiedAt"] = modified.timeIntervalSince1970 * 1000
        }

        return okJSON(result)
    }

    // MARK: - file.list

    private static let resourceKeys: Set<URLResourceKey> = [
        .fileSizeKey, .isDirectoryKey, .creationDateKey, .contentModificationDateKey,
    ]

    static func handleFileList(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        let accessCheck = policy.validateFileAccess(path: path, operation: .read)
        guard accessCheck.allowed else {
            return errorJSON(accessCheck.reason)
        }

        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let targetURL = scopedURL ?? URL(fileURLWithPath: path)

        let fm = FileManager.default
        let recursive = params["recursive"] as? Bool ?? false
        let maxDepth = params["maxDepth"] as? Int ?? 5
        let maxEntries = min(params["maxEntries"] as? Int ?? 1000, 10000)
        let sortBy = params["sortBy"] as? String ?? "name"
        let sortOrder = params["sortOrder"] as? String ?? "asc"

        var entries: [[String: Any]] = []

        if recursive {
            // Recursive enumeration with depth control
            guard let enumerator = fm.enumerator(
                at: targetURL,
                includingPropertiesForKeys: Array(resourceKeys),
                options: [.skipsHiddenFiles]
            ) else {
                return errorJSON("ENUM_FAILED: cannot enumerate '\(path)'")
            }

            let basePath = targetURL.path
            for case let itemURL as URL in enumerator {
                // Calculate depth
                let relativePath = String(itemURL.path.dropFirst(basePath.count + 1))
                let depth = relativePath.components(separatedBy: "/").count
                if depth > maxDepth {
                    enumerator.skipDescendants()
                    continue
                }

                // Skip .clawnet internal directories
                if ClawNetDataManager.isClawNetInternalPath(itemURL.path) {
                    enumerator.skipDescendants()
                    continue
                }

                let values = try itemURL.resourceValues(forKeys: resourceKeys)
                var entry: [String: Any] = [
                    "name": itemURL.lastPathComponent,
                    "type": values.isDirectory == true ? "directory" : "file",
                    "size": values.fileSize ?? 0,
                    "relativePath": relativePath,
                ]
                if let created = values.creationDate {
                    entry["createdAt"] = Int64(created.timeIntervalSince1970 * 1000)
                }
                if let modified = values.contentModificationDate {
                    entry["modifiedAt"] = Int64(modified.timeIntervalSince1970 * 1000)
                }
                entries.append(entry)

                if entries.count >= maxEntries { break }
            }
        } else {
            // Non-recursive: original behavior + time fields
            let contents = try fm.contentsOfDirectory(
                at: targetURL,
                includingPropertiesForKeys: Array(resourceKeys),
                options: [.skipsHiddenFiles])

            for item in contents {
                // Skip .clawnet directory
                if item.lastPathComponent == ClawNetDataManager.clawnetDirName { continue }

                let values = try item.resourceValues(forKeys: resourceKeys)
                var entry: [String: Any] = [
                    "name": item.lastPathComponent,
                    "type": values.isDirectory == true ? "directory" : "file",
                    "size": values.fileSize ?? 0,
                ]
                if let created = values.creationDate {
                    entry["createdAt"] = Int64(created.timeIntervalSince1970 * 1000)
                }
                if let modified = values.contentModificationDate {
                    entry["modifiedAt"] = Int64(modified.timeIntervalSince1970 * 1000)
                }
                entries.append(entry)

                if entries.count >= maxEntries { break }
            }
        }

        // Sort
        entries.sort { a, b in
            let result: ComparisonResult
            switch sortBy {
            case "modifiedAt":
                let aVal = a["modifiedAt"] as? Int64 ?? 0
                let bVal = b["modifiedAt"] as? Int64 ?? 0
                result = aVal < bVal ? .orderedAscending : (aVal > bVal ? .orderedDescending : .orderedSame)
            case "createdAt":
                let aVal = a["createdAt"] as? Int64 ?? 0
                let bVal = b["createdAt"] as? Int64 ?? 0
                result = aVal < bVal ? .orderedAscending : (aVal > bVal ? .orderedDescending : .orderedSame)
            case "size":
                let aVal = a["size"] as? Int ?? 0
                let bVal = b["size"] as? Int ?? 0
                result = aVal < bVal ? .orderedAscending : (aVal > bVal ? .orderedDescending : .orderedSame)
            default: // "name"
                let aVal = a["name"] as? String ?? ""
                let bVal = b["name"] as? String ?? ""
                result = aVal.localizedStandardCompare(bVal)
            }
            return sortOrder == "desc" ? result == .orderedDescending : result == .orderedAscending
        }

        return okJSON([
            "path": path,
            "entries": entries,
            "count": entries.count,
        ])
    }

    // MARK: - file.move

    static func handleFileMove(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let source = params["source"] as? String, !source.isEmpty else {
            return errorJSON("missing source")
        }
        guard let destination = params["destination"] as? String, !destination.isEmpty else {
            return errorJSON("missing destination")
        }

        let readCheck = policy.validateFileAccess(path: source, operation: .read)
        guard readCheck.allowed else { return errorJSON(readCheck.reason) }
        let writeCheck = policy.validateFileAccess(path: destination, operation: .write)
        guard writeCheck.allowed else { return errorJSON(writeCheck.reason) }

        let scopedSource = BookmarkStore.shared.startAccessing(path: source)
        defer { if scopedSource != nil { BookmarkStore.shared.stopAccessing(path: source) } }
        let sourceURL = scopedSource ?? URL(fileURLWithPath: source)

        let scopedDest = BookmarkStore.shared.startAccessing(path: destination)
        defer { if scopedDest != nil { BookmarkStore.shared.stopAccessing(path: destination) } }
        let destURL = scopedDest ?? URL(fileURLWithPath: destination)

        let fm = FileManager.default

        guard fm.fileExists(atPath: sourceURL.path) else {
            return errorJSON("NOT_FOUND: \(source)")
        }

        // Check destination parent directory exists
        let destParent = destURL.deletingLastPathComponent()
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: destParent.path, isDirectory: &isDir), isDir.boolValue else {
            return errorJSON("PARENT_NOT_FOUND: parent directory '\(destParent.path)' does not exist. Use file.mkdir first.")
        }

        // Check conflict
        let overwrite = params["overwrite"] as? Bool ?? false
        if fm.fileExists(atPath: destURL.path) {
            if !overwrite {
                return errorJSON("CONFLICT: destination '\(destination)' already exists")
            }
            try fm.removeItem(at: destURL)
        }

        try fm.moveItem(at: sourceURL, to: destURL)

        return okJSON(["source": source, "destination": destination])
    }

    // MARK: - file.rename

    static func handleFileRename(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }
        guard let newName = params["newName"] as? String, !newName.isEmpty else {
            return errorJSON("missing newName")
        }

        // newName must not contain path separator
        guard !newName.contains("/") else {
            return errorJSON("INVALID_NAME: newName must not contain '/'")
        }

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

        let destURL = sourceURL.deletingLastPathComponent().appendingPathComponent(newName)
        let newPath = destURL.path

        // Check conflict
        let overwrite = params["overwrite"] as? Bool ?? false
        if fm.fileExists(atPath: destURL.path) {
            if !overwrite {
                return errorJSON("CONFLICT: '\(newName)' already exists in the same directory")
            }
            try fm.removeItem(at: destURL)
        }

        try fm.moveItem(at: sourceURL, to: destURL)

        return okJSON(["oldPath": path, "newPath": newPath])
    }

    // MARK: - file.copy

    static func handleFileCopy(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let source = params["source"] as? String, !source.isEmpty else {
            return errorJSON("missing source")
        }
        guard let destination = params["destination"] as? String, !destination.isEmpty else {
            return errorJSON("missing destination")
        }

        let readCheck = policy.validateFileAccess(path: source, operation: .read)
        guard readCheck.allowed else { return errorJSON(readCheck.reason) }
        let writeCheck = policy.validateFileAccess(path: destination, operation: .write)
        guard writeCheck.allowed else { return errorJSON(writeCheck.reason) }

        let scopedSource = BookmarkStore.shared.startAccessing(path: source)
        defer { if scopedSource != nil { BookmarkStore.shared.stopAccessing(path: source) } }
        let sourceURL = scopedSource ?? URL(fileURLWithPath: source)

        let scopedDest = BookmarkStore.shared.startAccessing(path: destination)
        defer { if scopedDest != nil { BookmarkStore.shared.stopAccessing(path: destination) } }
        let destURL = scopedDest ?? URL(fileURLWithPath: destination)

        let fm = FileManager.default

        guard fm.fileExists(atPath: sourceURL.path) else {
            return errorJSON("NOT_FOUND: \(source)")
        }

        // Check destination parent directory exists
        let destParent = destURL.deletingLastPathComponent()
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: destParent.path, isDirectory: &isDir), isDir.boolValue else {
            return errorJSON("PARENT_NOT_FOUND: parent directory '\(destParent.path)' does not exist. Use file.mkdir first.")
        }

        // Check conflict
        let overwrite = params["overwrite"] as? Bool ?? false
        if fm.fileExists(atPath: destURL.path) {
            if !overwrite {
                return errorJSON("CONFLICT: destination '\(destination)' already exists")
            }
            try fm.removeItem(at: destURL)
        }

        try fm.copyItem(at: sourceURL, to: destURL)

        return okJSON(["source": source, "destination": destination])
    }

    // MARK: - file.mkdir

    static func handleFileMkdir(_ params: [String: Any], policy: CommandPolicy) async throws -> String {
        guard let path = params["path"] as? String, !path.isEmpty else {
            return errorJSON("missing path")
        }

        let writeCheck = policy.validateFileAccess(path: path, operation: .write)
        guard writeCheck.allowed else { return errorJSON(writeCheck.reason) }

        let scopedURL = BookmarkStore.shared.startAccessing(path: path)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: path) } }
        let targetURL = scopedURL ?? URL(fileURLWithPath: path)

        let fm = FileManager.default
        let recursive = params["recursive"] as? Bool ?? true

        // Check if path already exists
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: targetURL.path, isDirectory: &isDir) {
            if isDir.boolValue {
                // Already a directory — idempotent success
                return okJSON(["path": path, "created": false])
            } else {
                return errorJSON("CONFLICT: path '\(path)' exists and is a file, not a directory")
            }
        }

        try fm.createDirectory(at: targetURL, withIntermediateDirectories: recursive)

        return okJSON(["path": path, "created": true])
    }
}

// MARK: - JSON Helpers (shared)

func jsonEncode(_ value: Any) -> String {
    if let data = try? JSONSerialization.data(withJSONObject: value),
       let str = String(data: data, encoding: .utf8) {
        return str
    }
    return "{}"
}

func okJSON(_ dict: [String: Any]) -> String {
    jsonEncode(dict)
}

func errorJSON(_ message: String) -> String {
    jsonEncode(["error": message])
}
