import Foundation
import OSLog

/// Manages Security-Scoped Bookmarks so the sandboxed app can persist
/// user-granted folder access across launches.
@MainActor
final class BookmarkStore {
    static let shared = BookmarkStore()

    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "bookmark-store")

    /// path → bookmark Data
    private var bookmarks: [String: Data] = [:]

    /// URLs currently being accessed (need stopAccessing on removal).
    private var activeURLs: [String: URL] = [:]

    private let storageURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ClawNet", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("bookmarks.json")
    }()

    private init() { load() }

    // MARK: - Public API

    /// Grant access to a URL obtained from NSOpenPanel. Returns the resolved path.
    @discardableResult
    func grantAccess(url: URL) -> String? {
        do {
            let data = try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            let path = url.path
            bookmarks[path] = data
            save()
            logger.info("Bookmark saved for: \(path, privacy: .public)")
            return path
        } catch {
            logger.error("Failed to create bookmark: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    /// Begin accessing a sandboxed path. Returns the security-scoped URL if successful.
    /// Caller MUST call `stopAccessing(url:)` (or use the returned URL's
    /// `stopAccessingSecurityScopedResource()`) when done.
    func startAccessing(path: String) -> URL? {
        // Already active — return cached URL.
        if let url = activeURLs[path] { return url }

        // Try to find a bookmark whose directory covers this path.
        guard let (_, data) = bookmarks.first(where: { path.hasPrefix($0.key) }) else {
            return nil
        }

        var isStale = false
        do {
            let url = try URL(
                resolvingBookmarkData: data,
                options: .withSecurityScope,
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )

            if isStale {
                // Re-save refreshed bookmark.
                if let refreshed = try? url.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                ) {
                    bookmarks[url.path] = refreshed
                    save()
                }
            }

            guard url.startAccessingSecurityScopedResource() else {
                logger.warning("startAccessingSecurityScopedResource failed for: \(path, privacy: .public)")
                return nil
            }

            // Build the actual target URL relative to the bookmarked directory.
            let targetURL = URL(fileURLWithPath: path)
            activeURLs[url.path] = url
            return targetURL
        } catch {
            logger.error("Failed to resolve bookmark for \(path, privacy: .public): \(error.localizedDescription)")
            return nil
        }
    }

    /// Stop accessing a previously started URL.
    func stopAccessing(path: String) {
        // Find the bookmarked ancestor directory that covers this path.
        if let (key, url) = activeURLs.first(where: { path.hasPrefix($0.key) }) {
            url.stopAccessingSecurityScopedResource()
            activeURLs.removeValue(forKey: key)
        }
    }

    /// Remove a bookmarked path and revoke access.
    func revoke(path: String) {
        stopAccessing(path: path)
        bookmarks.removeValue(forKey: path)
        save()
        logger.info("Bookmark revoked for: \(path, privacy: .public)")
    }

    /// All currently bookmarked paths (for UI display).
    var grantedPaths: [String] {
        Array(bookmarks.keys).sorted()
    }

    /// Validate all bookmarks on launch; remove any that are stale and unresolvable.
    func restoreAll() {
        var toRemove: [String] = []
        for (path, data) in bookmarks {
            var isStale = false
            do {
                let url = try URL(
                    resolvingBookmarkData: data,
                    options: .withSecurityScope,
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                if isStale {
                    if let refreshed = try? url.bookmarkData(
                        options: .withSecurityScope,
                        includingResourceValuesForKeys: nil,
                        relativeTo: nil
                    ) {
                        bookmarks[path] = refreshed
                    } else {
                        toRemove.append(path)
                    }
                }
            } catch {
                logger.warning("Bookmark invalid, removing: \(path, privacy: .public)")
                toRemove.append(path)
            }
        }
        for path in toRemove {
            bookmarks.removeValue(forKey: path)
        }
        if !toRemove.isEmpty { save() }
        logger.info("Restored \(self.bookmarks.count) bookmark(s), removed \(toRemove.count) stale")
    }

    // MARK: - Persistence

    private func load() {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return }
        do {
            let data = try Data(contentsOf: storageURL)
            // Stored as [String: [UInt8]] for JSON compatibility (Data isn't directly Codable in dict).
            let dict = try JSONDecoder().decode([String: [UInt8]].self, from: data)
            bookmarks = dict.mapValues { Data($0) }
            logger.info("Loaded \(self.bookmarks.count) bookmark(s)")
        } catch {
            logger.error("Failed to load bookmarks: \(error.localizedDescription)")
        }
    }

    private func save() {
        do {
            let dict = bookmarks.mapValues { Array($0) }
            let data = try JSONEncoder().encode(dict)
            try data.write(to: storageURL, options: .atomic)
        } catch {
            logger.error("Failed to save bookmarks: \(error.localizedDescription)")
        }
    }
}
