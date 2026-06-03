import Foundation
import OSLog

/// Manages audit/security events: receives from WebSocket, fetches from API, provides to UI.
@MainActor @Observable
final class AuditService {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "audit-service")
    private var api: ClawNetAPI?

    private(set) var events: [AuditEvent] = []
    private(set) var isLoading = false

    var unreadCount: Int {
        events.filter { !$0.isRead }.count
    }

    func configure(api: ClawNetAPI) {
        self.api = api
    }

    // MARK: - WebSocket Event Handling

    /// Called by ChatService when an audit-related WebSocket event is received.
    func handleAuditEvent(type: String, data: [String: Any]) {
        // boundary_violation uses "tag_name" instead of "tag_role"
        let tagRole = data["tag_role"] as? String ?? data["tag_name"] as? String
        let event = AuditEvent(
            id: data["audit_id"] as? String ?? UUID().uuidString,
            eventType: type,
            agentId: data["agent_id"] as? String,
            agentName: data["agent_name"] as? String,
            tagRole: tagRole,
            details: extractStringDetails(data),
            timestamp: Date(),
            isRead: false
        )
        events.insert(event, at: 0)
        // Cap local cache at 500 events
        if events.count > 500 {
            events = Array(events.prefix(500))
        }
    }

    /// Handle dialog approval request as an audit event.
    func handleDialogApprovalEvent(data: [String: Any]) {
        let initiatorAgent = data["initiator_agent"] as? [String: Any]
        let initiatorOwner = data["initiator_owner"] as? [String: Any]
        let sessionId = data["session_id"] as? String ?? ""
        let topic = data["topic"] as? String ?? ""

        let event = AuditEvent(
            id: "dialog-\(sessionId)",
            eventType: "dialog.approval_request",
            agentId: initiatorAgent?["id"] as? String,
            agentName: initiatorAgent?["display_name"] as? String,
            details: [
                "session_id": sessionId,
                "topic": topic,
                "initiator_owner": initiatorOwner?["display_name"] as? String ?? "",
            ],
            timestamp: Date(),
            isRead: false
        )
        events.insert(event, at: 0)
    }

    // MARK: - API Fetch

    func loadEvents() async {
        guard let api else { return }
        isLoading = true
        do {
            let fetched = try await api.getAuditEvents()
            // Merge: keep local unread status for events we already have
            let existingIds = Set(events.map(\.id))
            for event in fetched where !existingIds.contains(event.id) {
                events.append(event)
            }
            events.sort { $0.timestamp > $1.timestamp }
        } catch {
            logger.error("Failed to load audit events: \(error.localizedDescription)")
        }
        isLoading = false
    }

    // MARK: - Actions

    func markAllAsRead() {
        for i in events.indices {
            events[i].isRead = true
        }
    }

    func markAsRead(id: String) {
        if let idx = events.firstIndex(where: { $0.id == id }) {
            events[idx].isRead = true
        }
    }

    func clearAll() {
        events = []
    }

    // MARK: - Helpers

    private func extractStringDetails(_ data: [String: Any]) -> [String: String] {
        let metaKeys: Set<String> = ["audit_id", "agent_id", "agent_name", "tag_role", "tag_name"]
        var result: [String: String] = [:]
        for (key, value) in data {
            if metaKeys.contains(key) { continue }
            if let str = value as? String {
                result[key] = str
            }
        }
        return result
    }
}
