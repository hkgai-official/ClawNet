import AppKit
import Foundation
import OSLog
import PDFKit
import UniformTypeIdentifiers
import Vision

/// Handles file.search with built-in text parsing (always enabled).
/// Heavy work (file I/O, PDF parsing, OCR) is offloaded from the main actor.
enum FileSearchHandler {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "file-search")

    private static let defaultSearchDepth = 2
    private static let maxSearchDepth = 5
    private static let defaultMaxResults = 50
    private static let absoluteMaxResults = 200
    private static let parseMaxTextLength = 500_000
    private static let textSearchChunkBytes = 256 * 1024  // read head + tail 256 KB each for keyword matching
    private static let maxFilesToScan = 5_000

    // MARK: - file.search

    @MainActor
    static func handleFileSearch(
        _ params: [String: Any],
        policy: CommandPolicy,
        blobEndpoint: GatewayBlobUploader.Endpoint?
    ) async throws -> String {
        guard let rawPath = params["path"] as? String, !rawPath.isEmpty else {
            return errorJSON("missing path")
        }
        guard let keywords = params["keywords"] as? [String], !keywords.isEmpty else {
            return errorJSON("missing keywords")
        }

        let accessCheck = policy.validateFileAccess(path: rawPath, operation: .read)
        guard accessCheck.allowed else {
            return errorJSON(accessCheck.reason)
        }

        let scopedURL = BookmarkStore.shared.startAccessing(path: rawPath)
        defer { if scopedURL != nil { BookmarkStore.shared.stopAccessing(path: rawPath) } }
        let resolvedURL = scopedURL ?? URL(fileURLWithPath: rawPath)

        var isDir: ObjCBool = false
        let pathExists = FileManager.default.fileExists(atPath: resolvedURL.path, isDirectory: &isDir)
        let baseURL = (pathExists && isDir.boolValue) ? resolvedURL : resolvedURL.deletingLastPathComponent()

        guard FileManager.default.fileExists(atPath: baseURL.path) else {
            return errorJSON("NOT_FOUND: \(baseURL.path)")
        }

        let depth = min((params["depth"] as? Int) ?? defaultSearchDepth, maxSearchDepth)
        let maxResults = min((params["maxResults"] as? Int) ?? defaultMaxResults, absoluteMaxResults)
        let lowercasedKeywords = keywords.map { $0.lowercased() }

        let result = await Task.detached(priority: .userInitiated) {
            await searchFiles(
                baseURL: baseURL,
                depth: depth,
                maxResults: maxResults,
                keywords: lowercasedKeywords,
                blobEndpoint: blobEndpoint
            )
        }.value

        return okJSON([
            "basePath": baseURL.path,
            "results": result,
            "count": result.count,
            "maxResults": maxResults,
        ])
    }

    // MARK: - Core Search (off main thread)

    private static func searchFiles(
        baseURL: URL,
        depth: Int,
        maxResults: Int,
        keywords: [String],
        blobEndpoint: GatewayBlobUploader.Endpoint?
    ) async -> [[String: Any]] {
        let fm = FileManager.default
        let files = enumerateFiles(at: baseURL, maxDepth: depth)
        var entries: [[String: Any]] = []

        for fileURL in files {
            if entries.count >= maxResults { break }

            let name = fileURL.lastPathComponent
            let ext = fileURL.pathExtension.lowercased()

            guard let attrs = try? fm.attributesOfItem(atPath: fileURL.path),
                  let fileSize = attrs[.size] as? Int else { continue }
            guard fileSize < 500 * 1024 * 1024 else { continue }

            let matchResult = matchKeywords(url: fileURL, name: name, ext: ext, fileSize: fileSize, keywords: keywords)
            guard !matchResult.hits.isEmpty else { continue }

            var entry: [String: Any] = [
                "path": fileURL.path,
                "name": name,
                "size": fileSize,
                "format": matchResult.format,
                "keywordHits": matchResult.hits,
            ]

            if let text = matchResult.text {
                let clamped = String(text.prefix(parseMaxTextLength))
                entry["parsed"] = true
                entry["text"] = clamped
                entry["truncated"] = text.count > parseMaxTextLength
            }

            if let endpoint = blobEndpoint, let data = fm.contents(atPath: fileURL.path) {
                if let blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint) {
                    entry["blobId"] = blobId
                }
            }

            entries.append(entry)
        }

        return entries
    }

    // MARK: - Keyword Matching (single pass, no OCR during search)

    private struct MatchResult {
        let hits: [String]
        let format: String
        let text: String?
    }

    private static func matchKeywords(
        url: URL, name: String, ext: String, fileSize: Int, keywords: [String]
    ) -> MatchResult {
        let nameLower = name.lowercased()
        var nameHits: [String] = []
        var remainingKeywords: [String] = []

        for kw in keywords {
            if nameLower.contains(kw) {
                nameHits.append(kw)
            } else {
                remainingKeywords.append(kw)
            }
        }

        if remainingKeywords.isEmpty {
            return MatchResult(hits: nameHits, format: formatForExt(ext), text: nil)
        }

        let (text, format) = extractTextLight(url: url, ext: ext, fileSize: fileSize)
        guard let text else {
            return MatchResult(hits: nameHits, format: format, text: nil)
        }

        let textLower = text.lowercased()
        var contentHits: [String] = []
        for kw in remainingKeywords {
            if textLower.contains(kw) {
                contentHits.append(kw)
            }
        }

        let allHits = nameHits + contentHits
        return MatchResult(hits: allHits, format: format, text: allHits.isEmpty ? nil : text)
    }

    /// Lightweight text extraction — skips OCR for images, limits read size for text files.
    private static func extractTextLight(url: URL, ext: String, fileSize: Int) -> (String?, String) {
        let uti = UTType(filenameExtension: ext)

        if ext == "pdf" || uti?.conforms(to: .pdf) == true {
            guard let doc = PDFDocument(url: url) else { return (nil, "pdf") }
            var text = ""
            for i in 0..<min(doc.pageCount, 20) {
                if let page = doc.page(at: i), let s = page.string {
                    if !text.isEmpty { text += "\n" }
                    text += s
                }
                if text.count > textSearchChunkBytes { break }
            }
            return (text.isEmpty ? nil : text, "pdf")
        }

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
                return (attrStr.string, ext)
            }
            return (nil, ext)
        }

        // Skip OCR for images — only match by filename
        if uti?.conforms(to: .image) == true { return (nil, "image") }

        // Text files: read head 256KB + tail 256KB
        guard let handle = try? FileHandle(forReadingFrom: url) else { return (nil, "binary") }
        defer { try? handle.close() }

        let chunk = textSearchChunkBytes
        if fileSize <= chunk * 2 {
            let data = handle.readData(ofLength: fileSize)
            guard let text = String(data: data, encoding: .utf8) else { return (nil, "binary") }
            return (text, "text")
        }

        let headData = handle.readData(ofLength: chunk)
        guard let headText = String(data: headData, encoding: .utf8) else { return (nil, "binary") }

        try? handle.seek(toOffset: UInt64(fileSize - chunk))
        let tailData = handle.readData(ofLength: chunk)
        let tailText = String(data: tailData, encoding: .utf8) ?? ""

        return (headText + "\n…\n" + tailText, "text")
    }

    private static func formatForExt(_ ext: String) -> String {
        let uti = UTType(filenameExtension: ext)
        if ext == "pdf" || uti?.conforms(to: .pdf) == true { return "pdf" }
        if uti?.conforms(to: .image) == true { return "image" }
        return "text"
    }

    // MARK: - Directory Traversal

    private static let skippedDirectories: Set<String> = [
        "node_modules", ".git", ".svn", "DerivedData", "__pycache__",
        ".build", ".swiftpm", "Pods", "Carthage", ".gradle",
        "build", "dist", ".next", ".nuxt", ".output", "vendor",
    ]

    private static let bundleExtensions: Set<String> = [
        "app", "framework", "bundle", "xcodeproj", "xcworkspace",
        "playground", "plugin", "kext", "xpc", "qlgenerator",
    ]

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
                options: [.skipsHiddenFiles]) else { continue }

            for item in contents {
                let name = item.lastPathComponent
                let ext = item.pathExtension.lowercased()

                if bundleExtensions.contains(ext) { continue }
                if skippedDirectories.contains(name) { continue }

                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if currentDepth < maxDepth {
                        queue.append((item, currentDepth + 1))
                    }
                } else {
                    result.append(item)
                    if result.count >= maxFilesToScan { return result }
                }
            }
        }
        return result
    }
}
