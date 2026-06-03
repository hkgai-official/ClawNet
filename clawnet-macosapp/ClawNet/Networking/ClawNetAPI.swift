import Foundation
import OSLog

/// REST API client for clawnet-server (message persistence, conversations, etc.)
actor ClawNetAPI {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "api")
    private let baseURL: URL
    private let getAccessToken: @Sendable () async -> String?
    private let onUnauthorized: (@Sendable () async -> Bool)?

    init(
        baseURL: URL,
        getAccessToken: @escaping @Sendable () async -> String?,
        onUnauthorized: (@Sendable () async -> Bool)? = nil
    ) {
        self.baseURL = baseURL
        self.getAccessToken = getAccessToken
        self.onUnauthorized = onUnauthorized
    }

    // MARK: - Conversations

    func listConversations() async throws -> [Conversation] {
        let data = try await get("api/v1/conversations")
        let response = try JSONDecoder.api.decode(APIListResponse<Conversation>.self, from: data)
        return response.data
    }

    func getConversation(id: String) async throws -> Conversation {
        let data = try await get("api/v1/conversations/\(id)")
        let response = try JSONDecoder.api.decode(APIResponse<Conversation>.self, from: data)
        return response.data
    }

    func createConversation(type: Conversation.ConversationType, participantIds: [String], title: String? = nil) async throws -> Conversation {
        var body: [String: Any] = [
            "type": type.rawValue,
            "participant_ids": participantIds,
        ]
        if let title { body["title"] = title }
        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await post("api/v1/conversations", body: jsonData)
        let response = try JSONDecoder.api.decode(APIResponse<Conversation>.self, from: data)
        return response.data
    }

    func deleteConversation(id: String) async throws {
        _ = try await delete("api/v1/conversations/\(id)")
    }

    func markConversationRead(id: String, lastReadMessageId: String? = nil) async throws {
        var dict: [String: Any] = [:]
        if let lastReadMessageId, !lastReadMessageId.isEmpty {
            dict["last_read_message_id"] = lastReadMessageId
        }
        let body = try JSONSerialization.data(withJSONObject: dict)
        _ = try await post("api/v1/conversations/\(id)/read", body: body)
    }

    func updateConversation(id: String, title: String) async throws -> Conversation {
        let body = try JSONSerialization.data(withJSONObject: ["title": title])
        let data = try await patch("api/v1/conversations/\(id)", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<Conversation>.self, from: data)
        return response.data
    }

    func updateConversationSummary(id: String, summary: String) async throws -> Conversation {
        let body = try JSONSerialization.data(withJSONObject: ["summary": summary])
        let data = try await patch("api/v1/conversations/\(id)", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<Conversation>.self, from: data)
        return response.data
    }

    func getMembers(conversationId: String) async throws -> [Participant] {
        let data = try await get("api/v1/conversations/\(conversationId)/members")
        let response = try JSONDecoder.api.decode(APIListResponse<Participant>.self, from: data)
        return response.data
    }

    func addMembers(conversationId: String, participantIds: [String]) async throws -> [Participant] {
        let body = try JSONSerialization.data(withJSONObject: ["participant_ids": participantIds])
        let data = try await post("api/v1/conversations/\(conversationId)/members", body: body)
        let response = try JSONDecoder.api.decode(APIListResponse<Participant>.self, from: data)
        return response.data
    }

    func removeMember(conversationId: String, memberId: String) async throws {
        _ = try await delete("api/v1/conversations/\(conversationId)/members/\(memberId)")
    }

    // MARK: - Users

    func getCurrentUser() async throws -> UserInfo {
        let data = try await get("api/v1/users/me")
        let response = try JSONDecoder.api.decode(APIResponse<UserProfileResponse>.self, from: data)
        let u = response.data
        return UserInfo(id: u.id, username: u.email ?? u.displayName, displayName: u.displayName, userCode: u.userCode, email: u.email)
    }

    func updateCurrentUser(displayName: String? = nil, email: String? = nil, avatarUrl: String? = nil) async throws -> UserInfo {
        var dict: [String: Any] = [:]
        if let displayName { dict["display_name"] = displayName }
        if let email { dict["email"] = email }
        if let avatarUrl { dict["avatar_url"] = avatarUrl }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await patch("api/v1/users/me", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<UserProfileResponse>.self, from: data)
        let u = response.data
        return UserInfo(id: u.id, username: u.email ?? u.displayName, displayName: u.displayName, userCode: u.userCode, email: u.email)
    }

    func updateLanguage(_ language: String) async throws {
        struct Body: Encodable { let language: String }
        let body = try JSONEncoder().encode(Body(language: language))
        _ = try await put("api/v1/users/me/language", body: body)
    }

    // MARK: - Messages

    func getMessages(conversationId: String, page: Int = 1, pageSize: Int = 50) async throws -> (messages: [ChatMessage], meta: PaginationMeta?) {
        let data = try await get("api/v1/conversations/\(conversationId)/messages?page=\(page)&page_size=\(pageSize)")
        let response = try JSONDecoder.api.decode(APIPaginatedResponse<ChatMessage>.self, from: data)
        return (response.data, response.meta)
    }

    func getMessagesAfter(conversationId: String, afterId: String, limit: Int = 50) async throws -> (messages: [ChatMessage], meta: PaginationMeta?) {
        let data = try await get("api/v1/conversations/\(conversationId)/messages?after=\(afterId)&limit=\(limit)")
        let response = try JSONDecoder.api.decode(APIPaginatedResponse<ChatMessage>.self, from: data)
        return (response.data, response.meta)
    }

    func getMessagesBefore(conversationId: String, beforeId: String, limit: Int = 50) async throws -> (messages: [ChatMessage], meta: PaginationMeta?) {
        let data = try await get("api/v1/conversations/\(conversationId)/messages?before=\(beforeId)&limit=\(limit)")
        let response = try JSONDecoder.api.decode(APIPaginatedResponse<ChatMessage>.self, from: data)
        return (response.data, response.meta)
    }

    func sendMessage(conversationId: String, text: String) async throws -> ChatMessage {
        let body = try JSONSerialization.data(withJSONObject: [
            "content_type": "text",
            "content": ["text": text],
        ])
        let data = try await post("api/v1/conversations/\(conversationId)/messages", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<ChatMessage>.self, from: data)
        return response.data
    }

    func deleteMessage(id: String) async throws {
        _ = try await delete("api/v1/messages/\(id)")
    }

    func batchDeleteMessages(ids: [String]) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["message_ids": ids])
        _ = try await post("api/v1/messages/batch-delete", body: body)
    }

    func searchMessages(query: String, conversationId: String? = nil) async throws -> [ChatMessage] {
        var path = "api/v1/search/messages?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
        if let conversationId { path += "&conversation_id=\(conversationId)" }
        let data = try await get(path)
        let response = try JSONDecoder.api.decode(APIListResponse<ChatMessage>.self, from: data)
        return response.data
    }

    // MARK: - Files

    struct FileInfo: Codable, Sendable {
        let id: String
        let name: String
        let size: Int
        let mimeType: String
        var url: String?
        var thumbnailUrl: String?
    }

    func checkFile(hash: String) async throws -> String? {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/files/check/\(hash)"))
        request.httpMethod = "HEAD"
        try await applyAuth(&request)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        return http.value(forHTTPHeaderField: "X-File-Id")
    }

    func uploadChunk(hash: String, chunkIndex: Int, data chunkData: Data) async throws {
        var request = URLRequest(url: buildURL("api/v1/files/upload/\(hash)/chunk?chunk_index=\(chunkIndex)"))
        request.httpMethod = "POST"
        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"chunk\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(chunkData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body
        try await applyAuth(&request)
        let (_, response) = try await URLSession.shared.data(for: request)
        // Handle 401: refresh token and retry once
        if try await handleUnauthorized(response) {
            return try await uploadChunk(hash: hash, chunkIndex: chunkIndex, data: chunkData)
        }
        try validateResponse(response)
    }

    func completeUpload(hash: String, name: String, size: Int, mimeType: String) async throws -> FileInfo {
        let body = try JSONSerialization.data(withJSONObject: [
            "hash": hash,
            "name": name,
            "size": size,
            "mime_type": mimeType,
            "total_chunks": 1,
        ] as [String: Any])
        let data = try await post("api/v1/files/upload/\(hash)/complete", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<FileInfo>.self, from: data)
        return response.data
    }

    func getFileInfo(id: String) async throws -> FileInfo {
        let data = try await get("api/v1/files/\(id)")
        let response = try JSONDecoder.api.decode(APIResponse<FileInfo>.self, from: data)
        return response.data
    }

    func filePreviewURL(id: String) -> URL {
        baseURL.appendingPathComponent("api/v1/files/\(id)/preview")
    }

    func fileDownloadURL(id: String) -> URL {
        baseURL.appendingPathComponent("api/v1/files/\(id)/download")
    }

    /// Download a file to the user's Downloads folder with authentication.
    func downloadFile(id: String, fileName: String) async throws -> URL {
        var request = URLRequest(url: fileDownloadURL(id: id))
        try await applyAuth(&request)
        let (tempURL, response) = try await URLSession.shared.download(for: request)
        try validateResponse(response)
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        let destination = downloads.appendingPathComponent(fileName)
        // Remove existing file at destination to avoid moveItem error
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: tempURL, to: destination)
        return destination
    }

    func sendMediaMessage(conversationId: String, contentType: String, fileInfo: [String: Any]) async throws -> ChatMessage {
        let body = try JSONSerialization.data(withJSONObject: [
            "content_type": contentType,
            "content": fileInfo,
        ] as [String: Any])
        let data = try await post("api/v1/conversations/\(conversationId)/messages", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<ChatMessage>.self, from: data)
        return response.data
    }

    /// Get an authenticated URL for file access.
    func authenticatedURL(for url: URL) async -> URL? {
        guard let token = await getAccessToken() else { return nil }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var queryItems = components?.queryItems ?? []
        queryItems.append(URLQueryItem(name: "token", value: token))
        components?.queryItems = queryItems
        return components?.url
    }

    // MARK: - Agents

    func getAgents() async throws -> [Agent] {
        let data = try await get("api/v1/agents")
        let response = try JSONDecoder.api.decode(APIListResponse<Agent>.self, from: data)
        return response.data
    }

    func getAgent(id: String) async throws -> Agent {
        let data = try await get("api/v1/agents/\(id)")
        let response = try JSONDecoder.api.decode(APIResponse<Agent>.self, from: data)
        return response.data
    }

    func createAgent(config: AgentConfig, tagId: String? = nil, tagRole: String? = nil) async throws -> Agent {
        var dict = agentConfigToDict(config, isCreate: true)
        if let tagId { dict["tag_id"] = tagId }
        if let tagRole { dict["tag_role"] = tagRole }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await post("api/v1/agents", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<Agent>.self, from: data)
        return response.data
    }

    func updateAgent(id: String, config: AgentConfig, tagId: String? = nil, tagRole: String? = nil) async throws -> Agent {
        var dict = agentConfigToDict(config, isCreate: false)
        if let tagId { dict["tag_id"] = tagId }
        if let tagRole { dict["tag_role"] = tagRole }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await patch("api/v1/agents/\(id)", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<Agent>.self, from: data)
        return response.data
    }

    /// Convert AgentConfig to flat dict matching server's CreateAgentRequest/UpdateAgentRequest
    private func agentConfigToDict(_ config: AgentConfig, isCreate: Bool) -> [String: Any] {
        var dict: [String: Any] = [
            "display_name": config.displayName,
            "capabilities": config.capabilities.map(\.rawValue),
            "execution_mode": config.executionMode.rawValue,
            "proactive_intensity": config.proactiveIntensity.rawValue,
        ]
        if let desc = config.description { dict["description"] = desc }
        if let avatar = config.avatarUrl { dict["avatar_url"] = avatar }
        if let prompt = config.systemPrompt { dict["system_prompt"] = prompt }
        if let rules = config.proactiveRules {
            dict["proactive_rules"] = rules.map { [
                "id": $0.id, "trigger": $0.trigger, "condition": $0.condition,
                "action": $0.action, "enabled": $0.enabled,
            ] as [String: Any] }
        }
        if let perms = config.permissions {
            dict["permission_scope"] = perms.toScope()
        }
        if config.modelProvider != nil || config.modelName != nil {
            var modelConfig: [String: Any] = [:]
            if let provider = config.modelProvider { modelConfig["provider"] = provider }
            if let model = config.modelName { modelConfig["model"] = model }
            dict["model_config_data"] = modelConfig
        }
        if isCreate {
            dict["agent_type"] = "general"
            dict["interaction_mode"] = "background"
        }
        return dict
    }

    func deleteAgent(id: String) async throws {
        _ = try await delete("api/v1/agents/\(id)")
    }

    func getContactableAgents() async throws -> [Agent] {
        let data = try await get("api/v1/agents/contactable")
        let response = try JSONDecoder.api.decode(APIListResponse<Agent>.self, from: data)
        return response.data
    }

    // MARK: - Agent Dialogs

    func createDialog(initiatorAgentId: String, responderAgentId: String, topic: String, maxRounds: Int = 5) async throws -> DialogSession {
        let body = try JSONSerialization.data(withJSONObject: [
            "initiator_agent_id": initiatorAgentId,
            "responder_agent_id": responderAgentId,
            "topic": topic,
            "max_rounds": maxRounds,
        ] as [String: Any])
        let data = try await post("api/v1/agent-dialogs", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<DialogSession>.self, from: data)
        return response.data
    }

    func getDialogs(status: String? = nil) async throws -> [DialogSession] {
        var path = "api/v1/agent-dialogs"
        if let status { path += "?status=\(status)" }
        let data = try await get(path)
        let response = try JSONDecoder.api.decode(APIResponse<APIDialogListData>.self, from: data)
        return response.data.sessions
    }

    func getDialogByConversation(conversationId: String) async throws -> DialogSession? {
        let data = try await get("api/v1/agent-dialogs/by-conversation/\(conversationId)")
        let response = try? JSONDecoder.api.decode(APIResponse<DialogSession>.self, from: data)
        return response?.data
    }

    func approveDialog(sessionId: String, approved: Bool, reason: String? = nil) async throws {
        var dict: [String: Any] = ["approved": approved]
        if let reason { dict["reason"] = reason }
        let body = try JSONSerialization.data(withJSONObject: dict)
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/approve", body: body)
    }

    // MARK: - A2A Draft Review

    func requestMainDraft(sessionId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [:] as [String: Any])
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/request-main", body: body)
    }

    func refineDraft(sessionId: String, target: String, instruction: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "target": target,
            "instruction": instruction,
        ])
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/refine", body: body)
    }

    func submitResponse(sessionId: String, text: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["text": text])
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/submit-response", body: body)
    }

    func terminateDialog(sessionId: String, reason: String? = nil) async throws {
        var dict: [String: Any] = [:]
        if let reason { dict["reason"] = reason }
        let body = try JSONSerialization.data(withJSONObject: dict)
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/terminate", body: body)
    }

    func extendDialog(sessionId: String, additionalRounds: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["additional_rounds": additionalRounds])
        _ = try await post("api/v1/agent-dialogs/\(sessionId)/extend", body: body)
    }

    // MARK: - File Access Settings

    struct FileAccessSettingsResponse: Decodable {
        let mode: String
        let allowedPaths: [String]
        let deniedPaths: [String]
        let defaultDeniedPaths: [String]

        enum CodingKeys: String, CodingKey {
            case mode
            case allowedPaths = "allowed_paths"
            case deniedPaths = "denied_paths"
            case defaultDeniedPaths = "default_denied_paths"
        }
    }

    func getFileAccessSettings() async throws -> FileAccessSettingsResponse {
        let data = try await get("api/v1/file-access/settings")
        let response = try JSONDecoder().decode(APIResponse<FileAccessSettingsResponse>.self, from: data)
        return response.data
    }

    func updateFileAccessSettings(mode: String, allowedPaths: [String], deniedPaths: [String]) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "mode": mode,
            "allowed_paths": allowedPaths,
            "denied_paths": deniedPaths,
        ] as [String: Any])
        _ = try await put("api/v1/file-access/settings", body: body)
    }

    // MARK: - Contacts

    func getContacts() async throws -> [Contact] {
        let data = try await get("api/v1/contacts")
        let response = try JSONDecoder.api.decode(APIListResponse<Contact>.self, from: data)
        return response.data
    }

    func searchContacts(query: String) async throws -> [Contact] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await get("api/v1/search/contacts?q=\(encoded)")
        let response = try JSONDecoder.api.decode(APIListResponse<Contact>.self, from: data)
        return response.data
    }

    func addContact(contactId: String, contactType: String = "human") async throws -> Contact {
        let body = try JSONSerialization.data(withJSONObject: [
            "contact_id": contactId,
            "contact_type": contactType,
        ])
        let data = try await post("api/v1/contacts", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<Contact>.self, from: data)
        return response.data
    }

    func deleteContact(contactId: String) async throws {
        _ = try await delete("api/v1/contacts/\(contactId)")
    }

    // MARK: - Tags

    func getTags() async throws -> [Tag] {
        let data = try await get("api/v1/tags")
        let response = try JSONDecoder.api.decode(APIListResponse<Tag>.self, from: data)
        return response.data
    }

    func createTag(displayName: String, icon: String? = nil, color: String? = nil, nodeAcl: Tag.NodeAcl? = nil) async throws -> Tag {
        var body: [String: Any] = ["display_name": displayName]
        if let icon { body["icon"] = icon }
        if let color { body["color"] = color }
        if let acl = nodeAcl {
            body["node_acl"] = ["allowed_paths": acl.allowedPaths, "denied_paths": acl.deniedPaths]
        }
        let data = try await post("api/v1/tags", body: JSONSerialization.data(withJSONObject: body))
        let response = try JSONDecoder.api.decode(APIResponse<Tag>.self, from: data)
        return response.data
    }

    func updateTag(id: String, displayName: String? = nil, icon: String? = nil, color: String? = nil, nodeAcl: Tag.NodeAcl? = nil) async throws -> Tag {
        var body: [String: Any] = [:]
        if let displayName { body["display_name"] = displayName }
        if let icon { body["icon"] = icon }
        if let color { body["color"] = color }
        if let acl = nodeAcl {
            body["node_acl"] = ["allowed_paths": acl.allowedPaths, "denied_paths": acl.deniedPaths]
        }
        let data = try await patch("api/v1/tags/\(id)", body: JSONSerialization.data(withJSONObject: body))
        let response = try JSONDecoder.api.decode(APIResponse<Tag>.self, from: data)
        return response.data
    }

    func deleteTag(id: String) async throws {
        _ = try await delete("api/v1/tags/\(id)")
    }

    func updateContactTag(contactId: String, tagId: String?) async throws -> Contact {
        var body: [String: Any] = [:]
        if let tagId { body["tag_id"] = tagId } else { body["tag_id"] = NSNull() }
        let data = try await patch("api/v1/contacts/\(contactId)", body: JSONSerialization.data(withJSONObject: body))
        let response = try JSONDecoder.api.decode(APIResponse<Contact>.self, from: data)
        return response.data
    }

    // MARK: - Audit Events

    func getAuditEvents(limit: Int = 50, offset: Int = 0) async throws -> [AuditEvent] {
        let data = try await get("api/v1/audit/events?limit=\(limit)&offset=\(offset)")
        // Server returns {status, data: [{id, operation_type, ...}]}
        // Map server fields to AuditEvent
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["data"] as? [[String: Any]] else {
            return []
        }
        return items.compactMap { item in
            guard let id = item["id"] as? String else { return nil }
            let details = (item["operation_details"] as? [String: Any]) ?? [:]
            return AuditEvent(
                id: id,
                eventType: "audit.\(item["operation_type"] as? String ?? "unknown")",
                agentId: item["agent_id"] as? String,
                agentName: details["agent_name"] as? String,
                tagRole: details["tag_role"] as? String,
                details: details.compactMapValues { $0 as? String },
                timestamp: parseISO8601(item["timestamp"] as? String) ?? Date(),
                isRead: true  // Historical events are pre-read
            )
        }
    }

    private func parseISO8601(_ string: String?) -> Date? {
        guard let string else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }

    // MARK: - Friend Requests

    func sendFriendRequest(toUserId: String, message: String? = nil) async throws -> FriendRequest? {
        var dict: [String: Any] = ["to_user_id": toUserId]
        if let message { dict["message"] = message }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await post("api/v1/friend-requests", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<FriendRequest>.self, from: data)
        return response.data
    }

    func getPendingFriendRequests() async throws -> [FriendRequest] {
        let data = try await get("api/v1/friend-requests/pending")
        let response = try JSONDecoder.api.decode(APIListResponse<FriendRequest>.self, from: data)
        return response.data
    }

    func acceptFriendRequest(id: String) async throws {
        _ = try await post("api/v1/friend-requests/\(id)/accept", body: Data("{}".utf8))
    }

    func rejectFriendRequest(id: String) async throws {
        _ = try await post("api/v1/friend-requests/\(id)/reject", body: Data("{}".utf8))
    }

    // MARK: - Discovery Tasks

    func getDiscoveryTasks(status: String? = nil) async throws -> [DiscoveryTask] {
        var path = "api/v1/discovery-tasks"
        if let status { path += "?status=\(status)" }
        let data = try await get(path)
        let response = try JSONDecoder.api.decode(DiscoveryTaskListWrapper.self, from: data)
        return response.data.tasks
    }

    func getDiscoveryTask(id: String) async throws -> DiscoveryTask {
        let data = try await get("api/v1/discovery-tasks/\(id)")
        let response = try JSONDecoder.api.decode(APIResponse<DiscoveryTask>.self, from: data)
        return response.data
    }

    func getDiscoveryTaskByConversation(conversationId: String) async throws -> DiscoveryTask? {
        let data = try await get("api/v1/discovery-tasks/by-conversation/\(conversationId)")
        let response = try? JSONDecoder.api.decode(APIResponse<DiscoveryTask>.self, from: data)
        return response?.data
    }

    func confirmDiscoveryTask(id: String, queries: [[String: Any]]? = nil) async throws -> DiscoveryTask {
        var dict: [String: Any] = [:]
        if let queries { dict["queries"] = queries }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await post("api/v1/discovery-tasks/\(id)/confirm", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<DiscoveryTask>.self, from: data)
        return response.data
    }

    func cancelDiscoveryTask(id: String, reason: String? = nil) async throws -> DiscoveryTask {
        var dict: [String: Any] = [:]
        if let reason { dict["reason"] = reason }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await post("api/v1/discovery-tasks/\(id)/cancel", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<DiscoveryTask>.self, from: data)
        return response.data
    }

    // MARK: - Tasks

    func createTask(agentId: String, conversationId: String, description: String, priority: String = "normal") async throws -> ServerTask {
        let body = try JSONSerialization.data(withJSONObject: [
            "agent_id": agentId,
            "conversation_id": conversationId,
            "description": description,
            "priority": priority,
        ] as [String: Any])
        let data = try await post("api/v1/tasks", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<ServerTask>.self, from: data)
        return response.data
    }

    func getTask(id: String) async throws -> ServerTask {
        let data = try await get("api/v1/tasks/\(id)")
        let response = try JSONDecoder.api.decode(APIResponse<ServerTask>.self, from: data)
        return response.data
    }

    func approveTask(id: String, decision: String, modifications: String? = nil) async throws -> ServerTask {
        var dict: [String: Any] = ["decision": decision]
        if let modifications { dict["modifications"] = modifications }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let data = try await post("api/v1/tasks/\(id)/approve", body: body)
        let response = try JSONDecoder.api.decode(APIResponse<ServerTask>.self, from: data)
        return response.data
    }

    func cancelTask(id: String) async throws -> ServerTask {
        let data = try await post("api/v1/tasks/\(id)/cancel", body: Data("{}".utf8))
        let response = try JSONDecoder.api.decode(APIResponse<ServerTask>.self, from: data)
        return response.data
    }

    func getTaskLogs(id: String) async throws -> [[String: AnyCodable]] {
        let data = try await get("api/v1/tasks/\(id)/logs")
        let response = try JSONDecoder.api.decode(APIResponse<[[String: AnyCodable]]>.self, from: data)
        return response.data
    }

    // MARK: - Search

    func searchFiles(query: String) async throws -> [FileInfo] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await get("api/v1/search/files?q=\(encoded)")
        let response = try JSONDecoder.api.decode(APIListResponse<FileInfo>.self, from: data)
        return response.data
    }

    // MARK: - HTTP Helpers

    /// Build a URL by appending a path (which may contain query parameters) to baseURL.
    /// Unlike `appendingPathComponent`, this preserves `?` and `&` in the path string.
    private func buildURL(_ path: String) -> URL {
        let base = baseURL.absoluteString.hasSuffix("/")
            ? baseURL.absoluteString
            : baseURL.absoluteString + "/"
        return URL(string: base + path) ?? baseURL.appendingPathComponent(path)
    }

    private func get(_ path: String) async throws -> Data {
        var request = URLRequest(url: buildURL(path))
        try await applyAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        if try await handleUnauthorized(response) {
            return try await get(path) // retry after refresh
        }
        try validateResponse(response)
        return data
    }

    private func post(_ path: String, body: Data) async throws -> Data {
        var request = URLRequest(url: buildURL(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        try await applyAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        if try await handleUnauthorized(response) {
            return try await post(path, body: body) // retry after refresh
        }
        try validateResponse(response)
        return data
    }

    private func put(_ path: String, body: Data) async throws -> Data {
        var request = URLRequest(url: buildURL(path))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        try await applyAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        if try await handleUnauthorized(response) {
            return try await put(path, body: body)
        }
        try validateResponse(response)
        return data
    }

    private func patch(_ path: String, body: Data) async throws -> Data {
        var request = URLRequest(url: buildURL(path))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        try await applyAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        if try await handleUnauthorized(response) {
            return try await patch(path, body: body)
        }
        try validateResponse(response)
        return data
    }

    private func delete(_ path: String) async throws -> Data {
        var request = URLRequest(url: buildURL(path))
        request.httpMethod = "DELETE"
        try await applyAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        if try await handleUnauthorized(response) {
            return try await delete(path)
        }
        try validateResponse(response)
        return data
    }

    private func applyAuth(_ request: inout URLRequest) async throws {
        guard let token = await getAccessToken() else {
            throw APIError.notAuthenticated
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    /// Returns true if the token was successfully refreshed (caller should retry).
    private func handleUnauthorized(_ response: URLResponse) async throws -> Bool {
        guard let http = response as? HTTPURLResponse, http.statusCode == 401 else {
            return false
        }
        if let onUnauthorized {
            let refreshed = await onUnauthorized()
            if refreshed { return true }
        }
        throw APIError.notAuthenticated
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.httpError(statusCode: http.statusCode)
        }
    }
}

// MARK: - Error Types

enum APIError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case httpError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: "Not authenticated"
        case .invalidResponse: "Invalid server response"
        case .httpError(let code): "HTTP error: \(code)"
        }
    }
}

// MARK: - Response Wrappers

struct APIResponse<T: Decodable>: Decodable {
    let data: T
}

private struct APIListResponse<T: Decodable>: Decodable {
    let data: [T]
}

private struct APIDialogListData: Decodable {
    let sessions: [DialogSession]
    let total: Int
}

private struct APIPaginatedResponse<T: Decodable>: Decodable {
    let data: [T]
    let meta: PaginationMeta?
}

// MARK: - Encoder/Decoder Helpers

extension JSONDecoder {
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)

            // Try ISO 8601 with fractional seconds first (Python/FastAPI default)
            let fmtFrac = ISO8601DateFormatter()
            fmtFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fmtFrac.date(from: str) { return date }

            // Fallback: standard ISO 8601 without fractional seconds
            let fmtStd = ISO8601DateFormatter()
            fmtStd.formatOptions = [.withInternetDateTime]
            if let date = fmtStd.date(from: str) { return date }

            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot parse date: \(str)")
        }
        return decoder
    }()
}

extension JSONEncoder {
    static let api: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

// MARK: - Additional Response Types

struct UserProfileResponse: Decodable {
    let id: String
    let displayName: String
    var avatarUrl: String?
    var email: String?
    var userCode: String?
    var phone: String?
    var status: String?
}

private struct DiscoveryTaskListWrapper: Decodable {
    let data: DiscoveryTaskListData
    struct DiscoveryTaskListData: Decodable {
        let tasks: [DiscoveryTask]
        let total: Int
    }
}
