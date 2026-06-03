import Foundation
import OSLog

@MainActor @Observable
final class TagService {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "tag-service")
    private var api: ClawNetAPI?

    private(set) var tags: [Tag] = []

    func configure(api: ClawNetAPI) { self.api = api }

    func loadTags() async {
        guard let api else { return }
        do {
            tags = try await api.getTags()
            logger.info("Loaded \(self.tags.count) tags")
        } catch {
            logger.error("Failed to load tags: \(error)")
        }
    }

    func createTag(displayName: String, icon: String? = nil, color: String? = nil, nodeAcl: Tag.NodeAcl? = nil) async throws -> Tag {
        guard let api else { throw URLError(.badURL) }
        let tag = try await api.createTag(displayName: displayName, icon: icon, color: color, nodeAcl: nodeAcl)
        tags.append(tag)
        return tag
    }

    func updateTag(id: String, displayName: String? = nil, icon: String? = nil, color: String? = nil, nodeAcl: Tag.NodeAcl? = nil) async throws {
        guard let api else { return }
        let updated = try await api.updateTag(id: id, displayName: displayName, icon: icon, color: color, nodeAcl: nodeAcl)
        if let idx = tags.firstIndex(where: { $0.id == id }) {
            tags[idx] = updated
        }
    }

    func deleteTag(id: String) async throws {
        guard let api else { return }
        try await api.deleteTag(id: id)
        tags.removeAll { $0.id == id }
    }

    var defaultTag: Tag? { tags.first(where: { $0.isDefault }) }
}
