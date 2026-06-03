import Foundation
import OSLog

/// Manages Agent CRUD operations and dialog sessions.
@MainActor @Observable
final class AgentService {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "agent-service")
    private var api: ClawNetAPI?

    private(set) var agents: [Agent] = []
    private(set) var contactableAgents: [Agent] = []
    private(set) var dialogs: [DialogSession] = []
    private(set) var isLoading = false

    func configure(api: ClawNetAPI) {
        self.api = api
    }

    // MARK: - Agents

    func loadAgents() async {
        guard let api else { return }
        isLoading = true
        do {
            agents = try await api.getAgents()
        } catch {
            logger.error("Failed to load agents: \(error.localizedDescription)")
        }
        isLoading = false
    }

    func loadContactableAgents() async {
        guard let api else { return }
        do {
            contactableAgents = try await api.getContactableAgents()
        } catch {
            logger.error("Failed to load contactable agents: \(error.localizedDescription)")
        }
    }

    func createAgent(config: AgentConfig, tagId: String? = nil, tagRole: String? = nil) async throws -> Agent {
        guard let api else { throw APIError.notAuthenticated }
        let agent = try await api.createAgent(config: config, tagId: tagId, tagRole: tagRole)
        agents.insert(agent, at: 0)
        return agent
    }

    func updateAgent(id: String, config: AgentConfig, tagId: String? = nil, tagRole: String? = nil) async throws {
        guard let api else { throw APIError.notAuthenticated }
        let updated = try await api.updateAgent(id: id, config: config, tagId: tagId, tagRole: tagRole)
        if let idx = agents.firstIndex(where: { $0.id == id }) {
            agents[idx] = updated
        }
    }

    func deleteAgent(id: String) async throws {
        guard let api else { throw APIError.notAuthenticated }
        try await api.deleteAgent(id: id)
        agents.removeAll { $0.id == id }
    }

    // MARK: - Dialogs

    func loadDialogs() async {
        guard let api else { return }
        do {
            dialogs = try await api.getDialogs()
        } catch {
            logger.error("Failed to load dialogs: \(error.localizedDescription)")
        }
    }

    func createDialog(initiatorAgentId: String, responderAgentId: String, topic: String, maxRounds: Int = 5) async throws -> DialogSession {
        guard let api else { throw APIError.notAuthenticated }
        let session = try await api.createDialog(
            initiatorAgentId: initiatorAgentId,
            responderAgentId: responderAgentId,
            topic: topic,
            maxRounds: maxRounds
        )
        dialogs.insert(session, at: 0)
        return session
    }

    func approveDialog(sessionId: String, approved: Bool, reason: String? = nil) async throws {
        guard let api else { throw APIError.notAuthenticated }
        try await api.approveDialog(sessionId: sessionId, approved: approved, reason: reason)
        if let idx = dialogs.firstIndex(where: { $0.id == sessionId }) {
            dialogs[idx].status = approved ? .active : .terminated
        }
    }

    func terminateDialog(sessionId: String, reason: String? = nil) async throws {
        guard let api else { throw APIError.notAuthenticated }
        try await api.terminateDialog(sessionId: sessionId, reason: reason)
        if let idx = dialogs.firstIndex(where: { $0.id == sessionId }) {
            dialogs[idx].status = .terminated
            dialogs[idx].terminationReason = reason
        }
    }

    func extendDialog(sessionId: String, additionalRounds: Int) async throws {
        guard let api else { throw APIError.notAuthenticated }
        try await api.extendDialog(sessionId: sessionId, additionalRounds: additionalRounds)
        if let idx = dialogs.firstIndex(where: { $0.id == sessionId }) {
            dialogs[idx].maxRounds += additionalRounds
        }
    }

    func dialogForConversation(_ conversationId: String) -> DialogSession? {
        dialogs.first(where: { $0.conversationId == conversationId })
    }

    /// Fetch dialog session from server if not in local cache, then cache it.
    func ensureDialogForConversation(_ conversationId: String) async {
        guard dialogForConversation(conversationId) == nil else { return }
        guard let api else { return }
        do {
            if let session = try await api.getDialogByConversation(conversationId: conversationId) {
                if !dialogs.contains(where: { $0.id == session.id }) {
                    dialogs.append(session)
                }
            }
        } catch {
            logger.error("Failed to fetch dialog for conversation \(conversationId): \(error.localizedDescription)")
        }
    }

    /// Incrementally update a dialog session from a WebSocket event payload.
    func updateDialogSession(sessionId: String, status: DialogStatus? = nil, currentRound: Int? = nil, maxRounds: Int? = nil, terminationReason: String? = nil) {
        guard let idx = dialogs.firstIndex(where: { $0.id == sessionId }) else {
            Task { await loadDialogs() }
            return
        }
        if let status { dialogs[idx].status = status }
        if let currentRound { dialogs[idx].currentRound = currentRound }
        if let maxRounds { dialogs[idx].maxRounds = maxRounds }
        if let terminationReason { dialogs[idx].terminationReason = terminationReason }
    }

    func clearAll() {
        agents = []
        contactableAgents = []
        dialogs = []
    }
}
