import Foundation

// JSONDecoder.api uses .convertFromSnakeCase so no custom CodingKeys needed.

struct Tag: Identifiable, Codable, Sendable {
    let id: String
    let ownerId: String
    let name: String
    let displayName: String
    let icon: String?
    let color: String?
    let isDefault: Bool
    let isMain: Bool?
    let workspaceId: String
    let nodeAcl: NodeAcl
    let createdAt: Date
    let updatedAt: Date

    struct NodeAcl: Codable, Sendable {
        var allowedPaths: [String] = []
        var deniedPaths: [String] = []
        var accessMode: String?  // "rw" (default) or "ro" (read-only for delegate agents)
    }
}
