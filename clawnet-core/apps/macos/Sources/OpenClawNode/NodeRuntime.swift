import AppKit
import Foundation
import OpenClawKit
import OSLog
import PDFKit
import UniformTypeIdentifiers
import UserNotifications
import Vision

/// Handles incoming command invocations from the gateway.
/// Self-contained runtime for the standalone node app.
actor NodeRuntime {
    private let logger = Logger(subsystem: NodeConstants.subsystem, category: "runtime")
    private var eventSender: (@Sendable (String, String?) async -> Void)?
    private var blobEndpoint: GatewayBlobUploader.Endpoint?

    func setEventSender(_ sender: (@Sendable (String, String?) async -> Void)?) {
        self.eventSender = sender
    }

    func setBlobEndpoint(_ endpoint: GatewayBlobUploader.Endpoint?) {
        self.blobEndpoint = endpoint
    }

    func handleInvoke(_ req: BridgeInvokeRequest) async -> BridgeInvokeResponse {
        do {
            switch req.command {
            case OpenClawFileCommand.read.rawValue:
                return try await self.handleFileRead(req)
            case OpenClawFileCommand.write.rawValue:
                return try await self.handleFileWrite(req)
            case OpenClawFileCommand.stat.rawValue:
                return try await self.handleFileStat(req)
            case OpenClawFileCommand.list.rawValue:
                return try await self.handleFileList(req)
            case OpenClawFileCommand.search.rawValue:
                return try await self.handleFileSearch(req)
            case OpenClawSystemCommand.notify.rawValue:
                return try await self.handleSystemNotify(req)
            case OpenClawSystemCommand.which.rawValue:
                return try await self.handleSystemWhich(req)
            case OpenClawSystemCommand.run.rawValue:
                return try await self.handleSystemRun(req)
            default:
                return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: unknown command \(req.command)")
            }
        } catch {
            return Self.errorResponse(req, code: .unavailable, message: error.localizedDescription)
        }
    }

    // MARK: - Helpers

    private static func decodeParams<T: Decodable>(_ type: T.Type, from json: String?) throws -> T {
        guard let json, let data = json.data(using: .utf8) else {
            throw NSError(domain: "Gateway", code: 20, userInfo: [
                NSLocalizedDescriptionKey: "INVALID_REQUEST: paramsJSON required",
            ])
        }
        return try JSONDecoder().decode(type, from: data)
    }

    static func errorResponse(_ req: BridgeInvokeRequest, code: OpenClawNodeErrorCode, message: String) -> BridgeInvokeResponse {
        BridgeInvokeResponse(
            id: req.id,
            ok: false,
            error: OpenClawNodeError(code: code, message: message))
    }

    static func okResponse(_ req: BridgeInvokeRequest, data: [String: Any]) -> BridgeInvokeResponse {
        let jsonData = (try? JSONSerialization.data(withJSONObject: data)) ?? Data()
        let jsonString = String(data: jsonData, encoding: .utf8) ?? "{}"
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: jsonString)
    }
}

// MARK: - File Operations

extension NodeRuntime {
    // Max bytes for blob upload via HTTP (no WS payload constraint)
    private static let blobReadMaxBytes = 100 * 1024 * 1024 // 100 MB
    // Threshold for inline text responses via WS (avoid blob overhead for small text)
    private static let inlineTextMaxBytes = 1 * 1024 * 1024 // 1 MB

    private func handleFileRead(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileReadParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let access = await NodeFileAccessManager.shared.checkAccess(path: path, operation: .read)
        guard access.allowed else {
            return Self.errorResponse(req, code: .unauthorized, message: access.reason)
        }

        let url = URL(fileURLWithPath: path)
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "NOT_FOUND: \(path)")
        }

        let attrs = try fm.attributesOfItem(atPath: url.path)
        let fileSize = (attrs[.size] as? Int) ?? 0

        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        let offset = max(0, params.offset ?? 0)
        if offset > 0 {
            try handle.seek(toOffset: UInt64(offset))
        }

        let maxRead = Self.blobReadMaxBytes
        let limit = min(params.limit ?? maxRead, maxRead)
        let data = handle.readData(ofLength: limit)
        let bytesRead = data.count
        let hasMore = (offset + bytesRead) < fileSize

        let encoding = params.encoding ?? "utf8"

        // Determine if the data is valid UTF-8 text
        let isText = encoding != "base64" && String(data: data, encoding: .utf8) != nil
        let isSmallText = isText && bytesRead <= Self.inlineTextMaxBytes && !hasMore

        // Small text files: return inline via WS
        if isSmallText {
            return Self.okResponse(req, data: [
                "content": String(data: data, encoding: .utf8)!,
                "encoding": "utf8",
                "size": fileSize,
                "offset": offset,
                "bytesRead": bytesRead,
                "hasMore": false,
            ])
        }

        // Binary or large files: upload via HTTP blob
        guard let endpoint = self.blobEndpoint else {
            return Self.errorResponse(req, code: .unavailable, message: "BLOB_ENDPOINT_UNAVAILABLE: gateway blob endpoint not configured")
        }

        guard let blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint) else {
            return Self.errorResponse(req, code: .unavailable, message: "BLOB_UPLOAD_FAILED: failed to upload file data to gateway")
        }

        return Self.okResponse(req, data: [
            "transfer": "blob",
            "blobId": blobId,
            "encoding": isText ? "utf8" : "base64",
            "size": fileSize,
            "offset": offset,
            "bytesRead": bytesRead,
            "hasMore": hasMore,
        ])
    }

    private func handleFileWrite(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileWriteParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let access = await NodeFileAccessManager.shared.checkAccess(path: path, operation: .write)
        guard access.allowed else {
            return Self.errorResponse(req, code: .unauthorized, message: access.reason)
        }

        let url = URL(fileURLWithPath: path)

        if params.createDirs == true {
            let dir = url.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        // Resolve write data: blobId (download from gateway) or inline content
        let writeData: Data
        if let blobId = params.blobId, !blobId.isEmpty {
            guard let endpoint = self.blobEndpoint else {
                return Self.errorResponse(req, code: .invalidRequest, message: "BLOB_ENDPOINT_UNAVAILABLE")
            }
            guard let downloaded = await GatewayBlobDownloader.download(blobId: blobId, endpoint: endpoint) else {
                return Self.errorResponse(req, code: .invalidRequest, message: "BLOB_DOWNLOAD_FAILED: \(blobId)")
            }
            writeData = downloaded
        } else if let content = params.content {
            if params.encoding == "base64" {
                guard let decoded = Data(base64Encoded: content) else {
                    return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_BASE64")
                }
                writeData = decoded
            } else {
                guard let utf8 = content.data(using: .utf8) else {
                    return Self.errorResponse(req, code: .invalidRequest, message: "ENCODE_FAILED")
                }
                writeData = utf8
            }
        } else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: content or blobId required")
        }

        if params.append == true {
            if FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(writeData)
            } else {
                try writeData.write(to: url, options: [.atomic])
            }
        } else {
            try writeData.write(to: url, options: [.atomic])
        }

        return Self.okResponse(req, data: [
            "path": path,
            "bytesWritten": writeData.count,
        ])
    }

    private func handleFileStat(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileStatParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let access = await NodeFileAccessManager.shared.checkAccess(path: path, operation: .read)
        guard access.allowed else {
            return Self.errorResponse(req, code: .unauthorized, message: access.reason)
        }

        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "NOT_FOUND: \(path)")
        }

        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
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
            "readable": FileManager.default.isReadableFile(atPath: url.path),
            "writable": FileManager.default.isWritableFile(atPath: url.path),
        ]

        if let created = attrs[.creationDate] as? Date {
            result["createdAt"] = created.timeIntervalSince1970 * 1000
        }
        if let modified = attrs[.modificationDate] as? Date {
            result["modifiedAt"] = modified.timeIntervalSince1970 * 1000
        }

        return Self.okResponse(req, data: result)
    }

    private func handleFileList(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileListParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let access = await NodeFileAccessManager.shared.checkAccess(path: path, operation: .read)
        guard access.allowed else {
            return Self.errorResponse(req, code: .unauthorized, message: access.reason)
        }

        let url = URL(fileURLWithPath: path)
        let contents = try FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.fileSizeKey, .isDirectoryKey],
            options: [.skipsHiddenFiles])

        var entries: [[String: Any]] = []
        for item in contents.prefix(500) {
            let values = try item.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
            entries.append([
                "name": item.lastPathComponent,
                "type": values.isDirectory == true ? "directory" : "file",
                "size": values.fileSize ?? 0,
            ])
        }

        return Self.okResponse(req, data: [
            "path": path,
            "entries": entries,
            "count": entries.count,
        ])
    }
}

// MARK: - File Parse (text extraction embedded in search results)

extension NodeRuntime {
    /// Max extracted text size returned inline via WS.
    private static let parseMaxTextLength = 500_000

    /// Parses a file and returns structured content dict to merge into search results.
    private static func parseFile(url: URL, ext: String, fileSize: Int) async -> [String: Any] {
        let uti = UTType(filenameExtension: ext)

        if ext == "pdf" || uti?.conforms(to: .pdf) == true {
            return parsePDF(url: url, fileSize: fileSize)
        } else if ["docx", "doc", "rtf", "rtfd"].contains(ext)
            || uti?.conforms(to: .rtf) == true
            || uti?.conforms(to: .rtfd) == true
        {
            return parseRichText(url: url, fileSize: fileSize)
        } else if ["html", "htm"].contains(ext) || uti?.conforms(to: .html) == true {
            return parseRichText(url: url, fileSize: fileSize)
        } else if ["png", "jpg", "jpeg", "tiff", "bmp", "heic", "webp"].contains(ext)
            || uti?.conforms(to: .image) == true
        {
            return await parseImageOCR(url: url, fileSize: fileSize)
        } else if let data = FileManager.default.contents(atPath: url.path),
            let text = String(data: data, encoding: .utf8)
        {
            let clamped = String(text.prefix(parseMaxTextLength))
            return [
                "parsed": true,
                "format": "text",
                "text": clamped,
                "truncated": text.count > parseMaxTextLength,
            ]
        } else {
            return ["parsed": false, "parseError": "cannot extract text from .\(ext) files"]
        }
    }

    // MARK: PDF via PDFKit

    private static func parsePDF(url: URL, fileSize: Int) -> [String: Any] {
        guard let doc = PDFDocument(url: url) else {
            return ["parsed": false, "error": "PARSE_FAILED: could not open PDF"]
        }
        let pageCount = doc.pageCount
        var pages: [[String: Any]] = []
        var fullText = ""

        for i in 0..<pageCount {
            guard let page = doc.page(at: i) else { continue }
            let pageText = page.string ?? ""
            pages.append(["page": i + 1, "text": pageText])
            if !fullText.isEmpty { fullText += "\n\n" }
            fullText += pageText
            // Stop early if we've extracted enough text
            if fullText.count > parseMaxTextLength { break }
        }

        let clamped = String(fullText.prefix(parseMaxTextLength))
        return [
            "parsed": true,
            "format": "pdf",
            "text": clamped,
            "pages": pages.count,
            "totalPages": pageCount,
            "size": fileSize,
            "truncated": fullText.count > parseMaxTextLength,
        ]
    }

    // MARK: Rich text (docx/doc/rtf/html) via NSAttributedString

    private static func parseRichText(url: URL, fileSize: Int) -> [String: Any] {
        var docType: NSAttributedString.DocumentType?
        let ext = url.pathExtension.lowercased()

        // Hint the document type for better parsing.
        // .docx is auto-detected by NSAttributedString — no explicit type needed.
        switch ext {
        case "doc": docType = .docFormat
        case "rtf": docType = .rtf
        case "rtfd": docType = .rtfd
        case "html", "htm": docType = .html
        default: break
        }

        var docAttributes: NSDictionary?
        let options: [NSAttributedString.DocumentReadingOptionKey: Any]
        if let docType {
            options = [.documentType: docType]
        } else {
            options = [:]
        }

        guard let attrStr = try? NSAttributedString(
            url: url,
            options: options,
            documentAttributes: &docAttributes)
        else {
            return ["parsed": false, "error": "PARSE_FAILED: could not read document"]
        }

        let text = attrStr.string
        let clamped = String(text.prefix(parseMaxTextLength))

        var result: [String: Any] = [
            "parsed": true,
            "format": ext,
            "text": clamped,
            "size": fileSize,
            "truncated": text.count > parseMaxTextLength,
        ]

        // Extract title from document attributes if available
        if let title = (docAttributes?[NSAttributedString.DocumentAttributeKey.titleDocumentAttribute]) as? String,
            !title.isEmpty
        {
            result["title"] = title
        }

        return result
    }

    // MARK: Image OCR via Vision framework

    private static func parseImageOCR(url: URL, fileSize: Int) async -> [String: Any] {
        guard let image = CIImage(contentsOf: url) else {
            return ["parsed": false, "error": "PARSE_FAILED: could not open image"]
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return ["parsed": false, "error": "PARSE_FAILED: OCR failed: \(error.localizedDescription)"]
        }

        guard let observations = request.results else {
            return ["parsed": true, "format": "image", "text": "", "size": fileSize, "ocrResults": 0]
        }

        let lines = observations.compactMap { observation -> String? in
            observation.topCandidates(1).first?.string
        }
        let text = lines.joined(separator: "\n")
        let avgConfidence = observations.isEmpty ? 0.0 :
            observations.reduce(0.0) { $0 + Double($1.topCandidates(1).first?.confidence ?? 0) }
            / Double(observations.count)

        let clamped = String(text.prefix(parseMaxTextLength))
        return [
            "parsed": true,
            "format": "image",
            "text": clamped,
            "size": fileSize,
            "ocrResults": observations.count,
            "ocrConfidence": round(avgConfidence * 100) / 100,
            "truncated": text.count > parseMaxTextLength,
        ]
    }
}

// MARK: - File Search (directory walk + keyword match + parse + blob)

extension NodeRuntime {
    private static let defaultSearchDepth = 2
    private static let maxSearchDepth = 5
    private static let defaultMaxResults = 50
    private static let absoluteMaxResults = 200

    private func handleFileSearch(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileSearchParams.self, from: req.paramsJSON)
        let rawPath = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawPath.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }
        guard !params.keywords.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: keywords required")
        }

        let pathURL = URL(fileURLWithPath: rawPath)
        var isDir: ObjCBool = false
        let pathExists = FileManager.default.fileExists(atPath: pathURL.path, isDirectory: &isDir)
        let baseURL = (pathExists && isDir.boolValue) ? pathURL : pathURL.deletingLastPathComponent()

        let access = await NodeFileAccessManager.shared.checkAccess(path: baseURL.path, operation: .read)
        guard access.allowed else {
            return Self.errorResponse(req, code: .unauthorized, message: access.reason)
        }

        let fm = FileManager.default
        guard fm.fileExists(atPath: baseURL.path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "NOT_FOUND: \(baseURL.path)")
        }

        let depth = min(params.depth ?? Self.defaultSearchDepth, Self.maxSearchDepth)
        let maxResults = min(params.maxResults ?? Self.defaultMaxResults, Self.absoluteMaxResults)

        // Lowercase keywords for case-insensitive matching
        let keywords = params.keywords.map { $0.lowercased() }

        // Walk directory tree and collect matching files
        var entries: [[String: Any]] = []
        let files = Self.enumerateFiles(at: baseURL, maxDepth: depth)

        for fileURL in files {
            if entries.count >= maxResults { break }

            let name = fileURL.lastPathComponent
            let ext = fileURL.pathExtension.lowercased()

            // Check access for each file
            let fileAccess = await NodeFileAccessManager.shared.checkAccess(
                path: fileURL.path, operation: .read)
            guard fileAccess.allowed else { continue }

            guard let attrs = try? fm.attributesOfItem(atPath: fileURL.path),
                let fileSize = attrs[.size] as? Int
            else { continue }

            // Skip very large files (>500 MB) to avoid memory pressure
            guard fileSize < 500 * 1024 * 1024 else { continue }

            // Determine file format and extract text for keyword search + preview
            let textResult = await Self.extractTextForSearch(url: fileURL, ext: ext, fileSize: fileSize)
            let extractedText = textResult.text

            // Keyword matching: check filename and extracted text
            var hits: [String] = []
            let nameLower = name.lowercased()
            for kw in keywords {
                if nameLower.contains(kw) {
                    hits.append(kw)
                } else if let text = extractedText, text.lowercased().contains(kw) {
                    hits.append(kw)
                }
            }

            // No keyword match → skip
            guard !hits.isEmpty else { continue }

            // Always parse: embed full parsed content in results
            let parsed = await Self.parseFile(url: fileURL, ext: ext, fileSize: fileSize)

            // Upload file as blob
            var blobId: String?
            if let endpoint = self.blobEndpoint {
                if let data = fm.contents(atPath: fileURL.path) {
                    blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint)
                }
            }

            var entry: [String: Any] = [
                "path": fileURL.path,
                "name": name,
                "size": fileSize,
                "format": textResult.format,
                "keywordHits": hits,
            ]
            // Merge parsed content into entry
            for (key, value) in parsed {
                entry[key] = value
            }
            if let b = blobId { entry["blobId"] = b }

            entries.append(entry)
        }

        return Self.okResponse(req, data: [
            "basePath": baseURL.path,
            "results": entries,
            "count": entries.count,
            "maxResults": maxResults,
        ])
    }

    // MARK: Directory traversal (breadth-first, depth-limited)

    private static func enumerateFiles(at root: URL, maxDepth: Int) -> [URL] {
        var result: [URL] = []
        var queue: [(url: URL, depth: Int)] = [(root, 0)]
        let fm = FileManager.default

        while !queue.isEmpty {
            let (dir, currentDepth) = queue.removeFirst()
            guard currentDepth <= maxDepth else { continue }

            guard let contents = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
                options: [.skipsHiddenFiles])
            else { continue }

            for item in contents {
                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if currentDepth < maxDepth {
                        queue.append((item, currentDepth + 1))
                    }
                } else {
                    result.append(item)
                }
            }
        }
        return result
    }

    // MARK: Text extraction for search (reuses parse logic)

    private struct SearchTextResult {
        let text: String?
        let format: String
    }

    private static func extractTextForSearch(url: URL, ext: String, fileSize: Int) async -> SearchTextResult {
        let uti = UTType(filenameExtension: ext)

        // PDF
        if ext == "pdf" || uti?.conforms(to: .pdf) == true {
            if let doc = PDFDocument(url: url) {
                var text = ""
                for i in 0..<doc.pageCount {
                    if let page = doc.page(at: i), let s = page.string {
                        if !text.isEmpty { text += "\n" }
                        text += s
                    }
                    if text.count > parseMaxTextLength { break }
                }
                return SearchTextResult(text: text, format: "pdf")
            }
            return SearchTextResult(text: nil, format: "pdf")
        }

        // Rich text: docx/doc/rtf/html
        if ["docx", "doc", "rtf", "rtfd", "html", "htm"].contains(ext)
            || uti?.conforms(to: .rtf) == true
            || uti?.conforms(to: .rtfd) == true
            || uti?.conforms(to: .html) == true
        {
            var docType: NSAttributedString.DocumentType?
            switch ext {
            case "doc": docType = .docFormat
            case "rtf": docType = .rtf
            case "rtfd": docType = .rtfd
            case "html", "htm": docType = .html
            default: break
            }
            let options: [NSAttributedString.DocumentReadingOptionKey: Any] =
                docType.map { [.documentType: $0] } ?? [:]
            if let attrStr = try? NSAttributedString(url: url, options: options, documentAttributes: nil) {
                return SearchTextResult(text: attrStr.string, format: ext)
            }
            return SearchTextResult(text: nil, format: ext)
        }

        // Images: OCR
        if ["png", "jpg", "jpeg", "tiff", "bmp", "heic", "webp"].contains(ext)
            || uti?.conforms(to: .image) == true
        {
            if let ciImage = CIImage(contentsOf: url) {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
                if (try? handler.perform([request])) != nil, let observations = request.results {
                    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
                    return SearchTextResult(text: lines.joined(separator: "\n"), format: "image")
                }
            }
            return SearchTextResult(text: nil, format: "image")
        }

        // Fallback: try UTF-8 text
        if let data = FileManager.default.contents(atPath: url.path),
            let text = String(data: data, encoding: .utf8)
        {
            return SearchTextResult(text: text, format: "text")
        }

        return SearchTextResult(text: nil, format: "binary")
    }
}

// MARK: - System Operations

extension NodeRuntime {
    private func handleSystemNotify(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        struct NotifyParams: Codable {
            var title: String?
            var body: String?
        }
        let params = try Self.decodeParams(NotifyParams.self, from: req.paramsJSON)
        let title = params.title ?? "OpenClaw Node"
        let body = params.body ?? ""

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)

        return Self.okResponse(req, data: ["delivered": true])
    }

    private func handleSystemWhich(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        struct WhichParams: Codable {
            var command: String
        }
        let params = try Self.decodeParams(WhichParams.self, from: req.paramsJSON)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = [params.command]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if process.terminationStatus == 0, !path.isEmpty {
            return Self.okResponse(req, data: ["path": path, "found": true])
        } else {
            return Self.okResponse(req, data: ["found": false])
        }
    }

    private func handleSystemRun(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        struct RunParams: Codable {
            var command: String
            var args: [String]?
            var cwd: String?
            var timeout: Double?
        }
        let params = try Self.decodeParams(RunParams.self, from: req.paramsJSON)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        let fullCommand: String
        if let args = params.args, !args.isEmpty {
            let escaped = args.map { "'\($0.replacingOccurrences(of: "'", with: "'\\''"))'" }
            fullCommand = "\(params.command) \(escaped.joined(separator: " "))"
        } else {
            fullCommand = params.command
        }
        process.arguments = ["-c", fullCommand]

        if let cwd = params.cwd {
            process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        }

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()

        let timeout = params.timeout ?? 30.0
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if process.isRunning {
            process.terminate()
            return Self.errorResponse(req, code: .unavailable, message: "TIMEOUT: command exceeded \(timeout)s")
        }

        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()

        return Self.okResponse(req, data: [
            "exitCode": process.terminationStatus,
            "stdout": String(data: outData, encoding: .utf8) ?? "",
            "stderr": String(data: errData, encoding: .utf8) ?? "",
        ])
    }
}
