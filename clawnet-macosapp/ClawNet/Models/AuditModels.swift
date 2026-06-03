import Foundation

/// A security/audit event displayed in the Security Event Center.
struct AuditEvent: Identifiable, Codable, Sendable {
    let id: String
    let eventType: String       // "audit.access_denied", "dialog.approval_request", etc.
    let agentId: String?
    let agentName: String?
    let tagRole: String?
    let details: [String: String]
    let timestamp: Date
    var isRead: Bool

    init(
        id: String = UUID().uuidString,
        eventType: String,
        agentId: String? = nil,
        agentName: String? = nil,
        tagRole: String? = nil,
        details: [String: String] = [:],
        timestamp: Date = Date(),
        isRead: Bool = false
    ) {
        self.id = id
        self.eventType = eventType
        self.agentId = agentId
        self.agentName = agentName
        self.tagRole = tagRole
        self.details = details
        self.timestamp = timestamp
        self.isRead = isRead
    }

    /// Human-readable category for UI filtering.
    var category: AuditCategory {
        if eventType == "audit.boundary_violation" { return .boundaryViolation }
        if eventType.hasPrefix("audit.access") { return .accessDenied }
        if eventType.hasPrefix("dialog.approval") { return .dialogApproval }
        if eventType.hasPrefix("approval.") { return .approval }
        return .other
    }

    enum AuditCategory: String, CaseIterable, Identifiable {
        case boundaryViolation = "越界访问"
        case accessDenied = "访问拒绝"
        case dialogApproval = "对话审批"
        case approval = "授权请求"
        case other = "其他"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .boundaryViolation: "exclamationmark.triangle"
            case .accessDenied: "exclamationmark.shield"
            case .dialogApproval: "bubble.left.and.bubble.right"
            case .approval: "checkmark.shield"
            case .other: "info.circle"
            }
        }

        var color: String {
            switch self {
            case .boundaryViolation: "red"
            case .accessDenied: "orange"
            case .dialogApproval: "blue"
            case .approval: "purple"
            case .other: "gray"
            }
        }
    }
}
