import Foundation
import OSLog

/// Coordinates chat operations: sends messages via server WebSocket, persists via REST API.
/// Uses LocalStore (GRDB/SQLite) for offline caching — DB is read first, then synced incrementally.
@MainActor @Observable
final class ChatService {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "chat-service")
    private let store = LocalStore.shared

    let eventHandler = ChatEventHandler()
    let nodeEventHandler = NodeEventHandler()

    private var connection: ServerConnection?
    private var api: ClawNetAPI?
    private(set) var isConnected = false

    /// Called when the server connection drops unexpectedly.
    /// Set by AppState so ConnectionManager can trigger reconnection.
    var onDisconnect: ((String) -> Void)?

    /// Called when a server message is received while status shows disconnected.
    /// Allows AppState to auto-recover the connection status.
    var onConnectionRecovered: (() -> Void)?

    // Conversation state
    private(set) var conversations: [Conversation] = []
    private(set) var activeConversationId: String?
    private(set) var isLoadingConversations = false

    /// Cache staleness threshold — background refresh if older than this.
    private let cacheStaleInterval: TimeInterval = 300 // 5 minutes

    /// Guards against race conditions when selecting conversations.
    private var selectConversationGeneration: Int = 0

    // A2A human review
    var pendingReview: DraftReview?

    // Current user (set after login)
    var currentUser: UserInfo?

    private var currentUserParticipant: Participant {
        Participant(
            id: currentUser?.id ?? "unknown",
            name: currentUser?.displayName ?? currentUser?.username ?? "You",
            type: .human
        )
    }

    // Streaming cleanup timer
    private var cleanupTask: Task<Void, Never>?

    // MARK: - Setup

    func configure(api: ClawNetAPI) {
        self.api = api
        Task.detached { [store, logger] in
            do {
                try await store.setup()
            } catch {
                logger.error("Failed to setup LocalStore: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Connect to the server's WebSocket and register as a proxy node.
    func connect(serverURL: URL, accessToken: String) async throws {
        // Clean up any stale connection before creating a new one
        if let old = connection {
            await old.disconnect()
            self.connection = nil
        }

        let conn = ServerConnection(
            messageHandler: { [weak self] msg in
                await self?.handleServerMessage(msg)
            },
            disconnectHandler: { [weak self] reason in
                await MainActor.run {
                    self?.isConnected = false
                    self?.logger.warning("Server disconnected: \(reason, privacy: .public)")
                    self?.onDisconnect?(reason)
                }
            }
        )
        self.connection = conn

        try await conn.connect(serverURL: serverURL, token: accessToken)
        self.isConnected = true
        self.startStreamCleanup()

        // Derive blob HTTP endpoint from the server URL so file.read/write can transfer data.
        // Use serverURL directly — it's already http(s), not ws(s).
        let blobEndpoint = GatewayBlobUploader.Endpoint(httpBaseURL: serverURL, token: accessToken)
        nodeEventHandler.blobEndpoint = blobEndpoint

        // Register node capabilities (including file access policy)
        let commands = [
            "file.read", "file.write", "file.stat", "file.list",
            "file.search",
            "file.move", "file.rename", "file.copy", "file.mkdir", "file.trash",
            "ops.log", "ops.undo", "ops.rollback",
        ]
        let nodeId = InstanceIdentity.instanceId
        let policy = CommandPolicy.shared
        let fileAccess: [String: Any] = [
            "mode": policy.fileAccessMode.rawValue,
            "allowedPaths": policy.allowedPaths,
            "deniedPaths": policy.deniedPaths.filter { !CommandPolicy.defaultDeniedPaths.contains($0) },
            "updatedAtMs": Int(Date().timeIntervalSince1970 * 1000),
        ]
        try await conn.send([
            "type": "node.capabilities",
            "data": [
                "nodeId": nodeId,
                "commands": commands,
                "displayName": Host.current().localizedName ?? "macOS",
                "platform": "macos",
                "deviceFamily": InstanceIdentity.deviceFamily,
                "fileAccess": fileAccess,
            ] as [String: Any],
        ])
        logger.info("Connected to server and registered node capabilities")
    }

    func disconnect() async {
        self.cleanupTask?.cancel()
        self.cleanupTask = nil
        await connection?.disconnect()
        self.connection = nil
        self.isConnected = false
    }

    // MARK: - Server Message Handling

    private func handleServerMessage(_ msg: ServerMessage) {
        // 收到任何服务端消息 = 连接活着，自动恢复状态
        onConnectionRecovered?()

        switch msg.type {
        // ── Message events ──
        case "node.invoke.request":
            handleNodeInvokeRequest(msg)
        case "message.stream_start":
            eventHandler.handleStreamStart(msg)
        case "message.stream_delta":
            eventHandler.handleStreamDelta(msg)
        case "message.stream_end":
            eventHandler.handleStreamEnd(msg)
        case "message.new":
            handleMessageNewWithConversationRefresh(msg)
        case "message.sent":
            let requestId = msg.requestId ?? ""
            let realId = msg.data["message_id"] as? String
            if !requestId.isEmpty {
                eventHandler.updateMessageStatus(tempId: requestId, realId: realId, status: .sent)
            }
        case "message.stop":
            eventHandler.handleMessageStop(msg)

        // ── Typing indicators ──
        case "typing.start", "typing.stop":
            break

        // ── Node proxy ──
        case "node.capabilities.registered":
            logger.info("Node proxy registered on gateway")

        // ── Dialog session events ──
        case "dialog.approval_request":
            handleDialogApprovalRequest(msg)
        case "dialog.status_change":
            handleDialogStatusChange(msg)
        case "dialog.terminated":
            handleDialogTerminated(msg)
        case "dialog.completed":
            handleDialogCompleted(msg)
        case "dialog.paused":
            handleDialogPaused(msg)
        case "dialog.round_complete":
            handleDialogRoundComplete(msg)
        case "dialog.request_sent":
            Task { await loadConversations() }
        case "dialog.intent_authorization":
            handleDialogIntentAuthorization(msg)
        case "dialog.main_agent_blocked":
            handleMainAgentBlocked(msg)
        case "dialog.pending_review":
            handlePendingReview(msg.data)
        case "dialog.main_draft_ready":
            handleMainDraftReady(msg.data)
        case "dialog.draft_updated":
            handleDraftUpdated(msg.data)
        case "dialog.approve.success", "dialog.intent_authorize.success",
             "dialog.terminate.success", "dialog.extend.success":
            logger.info("Dialog action confirmed: \(msg.type, privacy: .public)")

        // ── Conversation updates (summary) ──
        case "conversation.updated":
            handleConversationUpdated(msg)

        // ── Group membership events ──
        case "group.members_changed":
            handleGroupMembersChanged(msg)

        // ── Friend request events ──
        case "friend_request.new":
            handleFriendRequestNew(msg)
        case "friend_request.accepted":
            handleFriendRequestAccepted(msg)

        // ── Discovery task events ──
        case "discovery.created":
            handleDiscoveryCreated(msg)
        case "discovery.progress":
            handleDiscoveryProgress(msg)
        case "discovery.completed":
            handleDiscoveryCompleted(msg)

        // ── Task events ──
        case "task.progress":
            handleTaskProgress(msg)
        case "task.completed":
            handleTaskCompleted(msg)

        // ── Agent status events ──
        case "assistant.status", "agent.status_change", "agent.connection_status":
            logger.info("Agent status event: \(msg.type, privacy: .public)")

        // ── Approval ──
        case "approval.requested":
            logger.info("Approval requested")
            auditService?.handleAuditEvent(type: msg.type, data: msg.data)

        // ── Audit / Security events ──
        case "audit.access_denied":
            logger.info("Audit: access denied")
            auditService?.handleAuditEvent(type: msg.type, data: msg.data)
        case "audit.boundary_violation":
            logger.info("Audit: boundary violation")
            auditService?.handleAuditEvent(type: msg.type, data: msg.data)

        // ── System ──
        case "pong":
            break
        case "error":
            let errorMsg = msg.data["message"] as? String ?? "Unknown error"
            logger.error("Server error: \(errorMsg, privacy: .public)")
            if let requestId = msg.requestId, !requestId.isEmpty {
                eventHandler.updateMessageStatus(tempId: requestId, realId: nil, status: .failed)
            }
        default:
            logger.debug("Unhandled server message: \(msg.type, privacy: .public)")
        }
    }

    private func handleNodeInvokeRequest(_ msg: ServerMessage) {
        let data = msg.data
        guard let invokeId = data["id"] as? String,
              let command = data["command"] as? String else {
            return
        }
        let nodeId = data["nodeId"] as? String ?? ""
        let paramsJSON = data["paramsJSON"] as? String

        var blobEP: GatewayBlobUploader.Endpoint?
        if let epDict = data["blobEndpoint"] as? [String: Any],
           let baseStr = epDict["httpBaseURL"] as? String,
           let baseURL = URL(string: baseStr) {
            let token = epDict["token"] as? String
            blobEP = GatewayBlobUploader.Endpoint(httpBaseURL: baseURL, token: token)
        }

        // Extract tag ACL from server-forwarded payload (defense-in-depth)
        var tagAcl: Tag.NodeAcl?
        if let aclDict = data["tagNodeAcl"] as? [String: Any] {
            let allowed = (aclDict["allowedPaths"] as? [String]) ?? []
            let denied = (aclDict["deniedPaths"] as? [String]) ?? []
            tagAcl = Tag.NodeAcl(allowedPaths: allowed, deniedPaths: denied)
        }

        let workspaceRoot = data["workspaceRoot"] as? String

        Task {
            let resultJSON = await nodeEventHandler.executeCommand(
                command: command,
                paramsJSON: paramsJSON,
                blobEndpoint: blobEP,
                tagNodeAcl: tagAcl,
                workspaceRoot: workspaceRoot
            )

            // Determine ok status by checking for top-level "error" key in result JSON
            let isOk: Bool = {
                guard let data = resultJSON.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    return false
                }
                return obj["error"] == nil
            }()

            try? await connection?.send([
                "type": "node.invoke.result",
                "data": [
                    "id": invokeId,
                    "nodeId": nodeId,
                    "ok": isOk,
                    "payloadJSON": resultJSON,
                ] as [String: Any],
            ])
        }
    }

    // MARK: - Conversations

    func loadConversations() async {
        guard let api else { return }
        isLoadingConversations = true

        // Phase 1: Load from DB instantly
        do {
            let records = try await store.loadAllConversations()
            let cached = records.compactMap { $0.toConversation() }
            if !cached.isEmpty && conversations.isEmpty {
                self.conversations = cached
            }
        } catch {
            logger.debug("DB conversation load failed (non-critical): \(error.localizedDescription, privacy: .public)")
        }

        // Phase 2: Fetch from server and merge
        do {
            let remote = try await api.listConversations()
            self.conversations = remote
            let records = remote.map { ConversationRecord(from: $0) }
            Task.detached { [store] in
                try? await store.saveConversations(records)
            }
        } catch {
            logger.error("Failed to load conversations: \(error.localizedDescription, privacy: .public)")
        }
        isLoadingConversations = false
    }

    func selectConversation(_ id: String) async {
        selectConversationGeneration += 1
        let generation = selectConversationGeneration

        let loadState = eventHandler.loadState(for: id)
        switch loadState {
        case .notLoaded, .failed:
            await eventHandler.loadMessagesFromDB(for: id)
            self.activeConversationId = id
            self.eventHandler.activeConversationId = id
            self.nodeEventHandler.currentSessionId = id
            Task { await loadMessages(conversationId: id, generation: generation) }
        case .loaded:
            self.activeConversationId = id
            self.eventHandler.activeConversationId = id
            self.nodeEventHandler.currentSessionId = id
            if let lastFetched = eventHandler.messagesByConversation[id]?.lastFetchedAt,
               Date().timeIntervalSince(lastFetched) > cacheStaleInterval {
                Task { await syncMessagesIncremental(conversationId: id, generation: generation) }
            }
        case .loading:
            self.activeConversationId = id
            self.eventHandler.activeConversationId = id
            self.nodeEventHandler.currentSessionId = id
        }

        await markConversationAsRead(id)
    }

    private func markConversationAsRead(_ id: String) async {
        guard let idx = conversations.firstIndex(where: { $0.id == id }) else { return }
        let hadUnread = conversations[idx].unreadCount > 0
        if hadUnread {
            conversations[idx].unreadCount = 0
            let record = ConversationRecord(from: conversations[idx])
            Task.detached { [store] in
                try? await store.saveConversations([record])
            }
            try? await api?.markConversationRead(id: id)
        }
    }

    func createConversation(participantIds: [String], title: String?) async throws -> Conversation {
        guard let api else { throw APIError.notAuthenticated }
        let conv = try await api.createConversation(type: .direct, participantIds: participantIds, title: title)
        self.conversations.insert(conv, at: 0)
        return conv
    }

    /// Find an existing direct conversation with a contact, or create a new one.
    /// Prevents duplicate conversations with the same person.
    func findOrCreateDirectConversation(contactId: String) async throws -> Conversation {
        // Check local list first
        if let existing = conversations.first(where: { conv in
            conv.type == .direct && conv.participants.contains(where: { $0.id == contactId })
        }) {
            return existing
        }
        // Refresh from server and check again (another client may have created it)
        await loadConversations()
        if let existing = conversations.first(where: { conv in
            conv.type == .direct && conv.participants.contains(where: { $0.id == contactId })
        }) {
            return existing
        }
        // Truly doesn't exist — create new
        return try await createConversation(participantIds: [contactId], title: nil)
    }

    func createGroupConversation(participantIds: [String], title: String?) async throws -> Conversation {
        guard let api else { throw APIError.notAuthenticated }
        let conv = try await api.createConversation(type: .group, participantIds: participantIds, title: title)
        self.conversations.insert(conv, at: 0)
        return conv
    }

    func removeConversation(_ id: String) async throws {
        guard let api else { throw APIError.notAuthenticated }
        try await api.deleteConversation(id: id)
        self.conversations.removeAll { $0.id == id }
        if self.activeConversationId == id {
            self.activeConversationId = nil
            self.eventHandler.activeConversationId = nil
            self.nodeEventHandler.currentSessionId = nil
        }
        Task.detached { [store] in
            try? await store.deleteMessages(conversationId: id)
            try? await store.deleteConversation(id: id)
        }
    }

    // MARK: - Messages

    private func loadMessages(conversationId: String, generation: Int) async {
        guard let api else { return }
        eventHandler.setLoadState(.loading, for: conversationId)

        // Try incremental sync first if we have a sync cursor
        do {
            let syncState = try await store.getSyncState(conversationId: conversationId)
            if let lastId = syncState?.lastSyncedMessageId {
                let (newMessages, meta) = try await api.getMessagesAfter(
                    conversationId: conversationId, afterId: lastId
                )
                guard generation == selectConversationGeneration else { return }
                if !newMessages.isEmpty {
                    eventHandler.appendMessages(newMessages, to: conversationId)
                }
                let newestId = meta?.newestId ?? newMessages.last?.id ?? lastId
                Task.detached { [store] in
                    try? await store.saveSyncState(SyncStateRecord(
                        conversationId: conversationId,
                        lastSyncedMessageId: newestId,
                        lastSyncedAt: Date(),
                        hasMoreHistory: syncState?.hasMoreHistory ?? true
                    ))
                }
                eventHandler.setLoadState(.loaded, for: conversationId)
                return
            }
        } catch {
            logger.debug("Incremental sync failed, falling back to full load: \(error.localizedDescription, privacy: .public)")
        }

        // Full load fallback
        do {
            let (messages, meta) = try await api.getMessages(conversationId: conversationId)
            guard generation == selectConversationGeneration else { return }
            eventHandler.appendMessages(messages, to: conversationId)
            eventHandler.setLoadState(.loaded, for: conversationId)

            // Save sync cursor
            let newestId = meta?.newestId ?? messages.last?.id
            if let newestId {
                Task.detached { [store] in
                    try? await store.saveSyncState(SyncStateRecord(
                        conversationId: conversationId,
                        lastSyncedMessageId: newestId,
                        lastSyncedAt: Date(),
                        hasMoreHistory: meta?.hasMore ?? false
                    ))
                }
            }
        } catch {
            logger.error("Failed to load messages: \(error.localizedDescription, privacy: .public)")
            eventHandler.setLoadState(.failed(error), for: conversationId)
        }
    }

    /// Incremental sync: fetch only new messages since last sync.
    private func syncMessagesIncremental(conversationId: String, generation: Int) async {
        guard let api else { return }
        do {
            let syncState = try await store.getSyncState(conversationId: conversationId)
            guard let lastId = syncState?.lastSyncedMessageId else {
                await loadMessages(conversationId: conversationId, generation: generation)
                return
            }
            let (newMessages, meta) = try await api.getMessagesAfter(
                conversationId: conversationId, afterId: lastId
            )
            guard generation == selectConversationGeneration else { return }
            if !newMessages.isEmpty {
                eventHandler.appendMessages(newMessages, to: conversationId)
                let newestId = meta?.newestId ?? newMessages.last?.id ?? lastId
                Task.detached { [store] in
                    try? await store.saveSyncState(SyncStateRecord(
                        conversationId: conversationId,
                        lastSyncedMessageId: newestId,
                        lastSyncedAt: Date(),
                        hasMoreHistory: syncState?.hasMoreHistory ?? true
                    ))
                }
            }
            eventHandler.setLoadState(.loaded, for: conversationId)
        } catch {
            logger.warning("Incremental sync failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Send a message via the server WebSocket.
    func sendMessage(_ text: String) async throws {
        guard let connection else { throw ServerConnectionError.notConnected }
        guard let conversationId = activeConversationId else {
            throw ServerConnectionError.notConnected
        }

        // Optimistic UI: show the user message immediately
        let tempId = eventHandler.addUserMessage(text, conversationId: conversationId, sender: currentUserParticipant)

        // Update conversation preview immediately
        updateConversationPreview(conversationId: conversationId, preview: text, date: Date())

        // Send via server WebSocket — server saves to DB AND triggers LLM
        try await connection.send([
            "type": "message.send",
            "request_id": tempId,
            "data": [
                "conversation_id": conversationId,
                "content_type": "text",
                "content": ["text": text],
            ] as [String: Any],
        ])
    }

    /// Upload a file and send it as a media message.
    func sendMediaMessage(fileURL: URL) async throws {
        guard let api else { throw APIError.notAuthenticated }
        guard let conversationId = activeConversationId else { throw ServerConnectionError.notConnected }

        let fileData = try Data(contentsOf: fileURL)
        let fileName = fileURL.lastPathComponent
        let mimeType = mimeType(for: fileURL)
        let contentType = mediaContentType(for: mimeType)

        // Optimistic UI: show the local file preview immediately
        let localContent = MessageContent(fromDict: [
            "url": fileURL.absoluteString,
            "name": fileName,
            "size": fileData.count,
            "mimeType": mimeType,
        ] as [String: Any])
        let msgContentType = ChatMessage.MessageContentType(rawValue: contentType) ?? .file
        let tempId = eventHandler.addUserMediaMessage(
            contentType: msgContentType,
            content: localContent,
            conversationId: conversationId,
            sender: currentUserParticipant
        )

        do {
            let hash = fileData.sha256Hex
            var fileId = try await api.checkFile(hash: hash)

            if fileId == nil {
                try await api.uploadChunk(hash: hash, chunkIndex: 0, data: fileData)
                let fileInfo = try await api.completeUpload(hash: hash, name: fileName, size: fileData.count, mimeType: mimeType)
                fileId = fileInfo.id
            }

            guard let uploadedFileId = fileId else { return }

            let fileInfo = try await api.getFileInfo(id: uploadedFileId)

            var content: [String: Any] = [
                "id": fileInfo.id,
                "name": fileInfo.name,
                "size": fileInfo.size,
                "mimeType": fileInfo.mimeType,
            ]
            if let url = fileInfo.url { content["url"] = url }
            if let thumb = fileInfo.thumbnailUrl { content["thumbnailUrl"] = thumb }

            let sentMessage = try await api.sendMediaMessage(
                conversationId: conversationId,
                contentType: contentType,
                fileInfo: content
            )

            eventHandler.updateMessageStatus(tempId: tempId, realId: sentMessage.id, status: .sent)
        } catch {
            eventHandler.updateMessageStatus(tempId: tempId, realId: nil, status: .failed)
            throw error
        }
    }

    private func mimeType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        let mimeTypes: [String: String] = [
            "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
            "mp4": "video/mp4", "mov": "video/quicktime", "avi": "video/x-msvideo",
            "webm": "video/webm", "mkv": "video/x-matroska",
            "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4",
            "ogg": "audio/ogg", "aac": "audio/aac",
            "pdf": "application/pdf", "zip": "application/zip",
            "doc": "application/msword", "txt": "text/plain", "json": "application/json",
        ]
        return mimeTypes[ext] ?? "application/octet-stream"
    }

    private func mediaContentType(for mimeType: String) -> String {
        if mimeType.hasPrefix("image/") { return "image" }
        if mimeType.hasPrefix("video/") { return "video" }
        if mimeType.hasPrefix("audio/") { return "voice" }
        return "file"
    }

    // MARK: - Message with Conversation Refresh

    private func handleMessageNewWithConversationRefresh(_ msg: ServerMessage) {
        let isNew = eventHandler.handleMessageNew(msg)

        let convId = msg.data["conversation_id"] as? String
        let msgId = msg.data["id"] as? String
        let senderDict = msg.data["sender"] as? [String: Any]
        let senderId = senderDict?["id"] as? String

        // Update sync state for the received message
        if let msgId, let convId {
            Task.detached { [store] in
                if let existing = try? await store.getSyncState(conversationId: convId) {
                    try? await store.saveSyncState(SyncStateRecord(
                        conversationId: convId,
                        lastSyncedMessageId: msgId,
                        lastSyncedAt: Date(),
                        hasMoreHistory: existing.hasMoreHistory
                    ))
                }
            }
        }

        // Update conversation preview with the new message
        if let convId {
            let preview = extractMessagePreview(from: msg.data)
            let timestamp = parseTimestamp(msg.data["timestamp"]) ?? Date()
            updateConversationPreview(conversationId: convId, preview: preview, date: timestamp)
        }

        // Update unread state based on whether the user is viewing this conversation
        if isNew, let convId, senderId != currentUser?.id {
            if convId != activeConversationId {
                if let idx = conversations.firstIndex(where: { $0.id == convId }) {
                    conversations[idx].unreadCount += 1
                }
            } else {
                Task { [weak self] in
                    try? await self?.api?.markConversationRead(id: convId)
                }
            }
        }

        // If the message belongs to an unknown conversation, refresh the list
        if let convId, !conversations.contains(where: { $0.id == convId }) {
            Task { await loadConversations() }
        }
    }

    // MARK: - Dialog Event Handlers

    private func handleDialogApprovalRequest(_ msg: ServerMessage) {
        logger.info("Dialog approval request: session=\(msg.data["session_id"] as? String ?? "?", privacy: .public)")
        auditService?.handleDialogApprovalEvent(data: msg.data)
        Task { await loadConversations() }
    }

    private func handleDialogIntentAuthorization(_ msg: ServerMessage) {
        let authId = msg.data["authorization_id"] as? String ?? ""
        let agentName = msg.data["agent_name"] as? String ?? ""
        let conversationId = msg.data["conversation_id"] as? String ?? ""
        let targets = msg.data["targets"] as? [[String: Any]] ?? []

        logger.info("Dialog intent authorization: auth=\(authId.prefix(8), privacy: .public), targets=\(targets.count)")

        // Inject a system message into the conversation so the user sees the authorization card
        let targetsSummary: [[String: String]] = targets.map { t in
            [
                "target_user_name": t["target_user_name"] as? String ?? "",
                "target_agent_name": t["target_agent_name"] as? String ?? "",
                "contact_tag_name": t["contact_tag_name"] as? String ?? "",
                "contact_tag_display_name": t["contact_tag_display_name"] as? String ?? "",
                "topic": t["topic"] as? String ?? "",
            ]
        }
        let cardData: [String: Any] = [
            "authorizationId": authId,
            "agentName": agentName,
            "targets": targetsSummary,
            "cardType": "intent_authorization",
            "status": "pending",
        ]
        let systemMsg = ChatMessage(
            id: "intent-auth-\(authId)",
            conversationId: conversationId,
            sender: .init(id: "system", name: "系统", type: .system),
            contentType: .richCard,
            content: MessageContent(fromDict: cardData),
            timestamp: Date()
        )
        eventHandler.appendMessages([systemMsg], to: conversationId)

        // Also log as audit event
        auditService?.handleAuditEvent(type: "dialog.intent_authorization", data: msg.data)
    }

    private func handleMainAgentBlocked(_ msg: ServerMessage) {
        let conversationId = msg.data["conversation_id"] as? String ?? ""
        let message = msg.data["message"] as? String ?? "Main Assistant 不能直接联系其他人。"

        logger.info("Main agent A2A blocked: conv=\(conversationId.prefix(8), privacy: .public)")

        // Show a system message in the conversation
        let systemMsg = ChatMessage(
            id: "main-blocked-\(UUID().uuidString)",
            conversationId: conversationId,
            sender: .init(id: "system", name: "系统", type: .system),
            contentType: .text,
            content: MessageContent(text: message),
            timestamp: Date()
        )
        eventHandler.appendMessages([systemMsg], to: conversationId)
    }

    private func handleDialogStatusChange(_ msg: ServerMessage) {
        guard let sessionId = msg.data["session_id"] as? String,
              let newStatus = msg.data["new_status"] as? String else { return }
        logger.info("Dialog status changed: \(sessionId, privacy: .public) → \(newStatus, privacy: .public)")
        eventHandler.updateDialogCardStatus(sessionId: sessionId, newStatus: newStatus)
        let status = DialogStatus(rawValue: newStatus)
        let currentRound = msg.data["current_round"] as? Int
        let maxRounds = msg.data["max_rounds"] as? Int
        agentService?.updateDialogSession(sessionId: sessionId, status: status, currentRound: currentRound, maxRounds: maxRounds)
    }

    private func handleDialogTerminated(_ msg: ServerMessage) {
        guard let sessionId = msg.data["session_id"] as? String else { return }
        let reason = msg.data["reason"] as? String
        logger.info("Dialog terminated: \(sessionId, privacy: .public)")
        agentService?.updateDialogSession(sessionId: sessionId, status: .terminated, terminationReason: reason)
    }

    private func handleDialogCompleted(_ msg: ServerMessage) {
        guard let sessionId = msg.data["session_id"] as? String else { return }
        logger.info("Dialog completed: \(sessionId, privacy: .public)")
        agentService?.updateDialogSession(sessionId: sessionId, status: .completed)
    }

    private func handleDialogPaused(_ msg: ServerMessage) {
        guard let sessionId = msg.data["session_id"] as? String else { return }
        let currentRound = msg.data["current_round"] as? Int
        let maxRounds = msg.data["max_rounds"] as? Int
        logger.info("Dialog paused: \(sessionId, privacy: .public) round \(currentRound ?? 0)/\(maxRounds ?? 0)")
        agentService?.updateDialogSession(sessionId: sessionId, status: .paused, currentRound: currentRound, maxRounds: maxRounds)
    }

    private func handleDialogRoundComplete(_ msg: ServerMessage) {
        guard let sessionId = msg.data["session_id"] as? String else { return }
        let currentRound = msg.data["current_round"] as? Int
        let maxRounds = msg.data["max_rounds"] as? Int
        logger.info("Dialog round complete: \(sessionId, privacy: .public) round \(currentRound ?? 0)/\(maxRounds ?? 0)")
        agentService?.updateDialogSession(sessionId: sessionId, currentRound: currentRound, maxRounds: maxRounds)
    }

    // MARK: - Friend Request Event Handlers

    /// Delegate for handling friend request and contact refresh
    weak var contactService: ContactService?
    weak var agentService: AgentService?
    weak var auditService: AuditService?

    // MARK: - Conversation Updated Events

    private func handleConversationUpdated(_ msg: ServerMessage) {
        guard let convId = msg.data["conversation_id"] as? String,
              let summary = msg.data["summary"] as? String else { return }

        if let idx = conversations.firstIndex(where: { $0.id == convId }) {
            conversations[idx].summary = summary
            // Persist to local DB
            Task {
                try? await store.saveConversations([ConversationRecord(from: conversations[idx])])
            }
        }
    }

    // MARK: - Group Membership Events

    private func handleGroupMembersChanged(_ msg: ServerMessage) {
        guard let convId = msg.data["conversation_id"] as? String,
              let action = msg.data["action"] as? String else { return }

        let changedMembers = msg.data["members"] as? [[String: Any]] ?? []

        guard let idx = conversations.firstIndex(where: { $0.id == convId }) else {
            // Unknown conversation — refresh list
            Task { await loadConversations() }
            return
        }

        if action == "added" {
            for m in changedMembers {
                guard let id = m["id"] as? String else { continue }
                if conversations[idx].participants.contains(where: { $0.id == id }) { continue }
                let name = m["name"] as? String ?? ""
                let typeStr = m["type"] as? String ?? "human"
                let pType: Participant.ParticipantType = typeStr == "agent" ? .agent : .human
                let role = m["role"] as? String
                let avatar = m["avatar"] as? String
                conversations[idx].participants.append(
                    Participant(id: id, name: name, avatar: avatar, type: pType, role: role)
                )
            }
        } else if action == "removed" {
            let removedIds = Set(changedMembers.compactMap { $0["id"] as? String })
            conversations[idx].participants.removeAll { removedIds.contains($0.id) }

            // If I was removed, hide conversation from list
            if removedIds.contains(currentUser?.id ?? "") {
                conversations.remove(at: idx)
            }
        }
    }

    private func handleFriendRequestNew(_ msg: ServerMessage) {
        let fromUserName = msg.data["from_user_name"] as? String ?? "Unknown"
        logger.info("New friend request from: \(fromUserName, privacy: .public)")
        Task { await contactService?.loadFriendRequests() }
    }

    private func handleFriendRequestAccepted(_ msg: ServerMessage) {
        logger.info("Friend request accepted")
        Task { await contactService?.loadContacts() }
    }

    // MARK: - Discovery Event Handlers

    /// 解析服务端 ISO8601 时间戳
    private func parseServerTimestamp(_ data: [String: Any]) -> Date? {
        (data["timestamp"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
    }

    private func handleDiscoveryCreated(_ msg: ServerMessage) {
        let data = msg.data
        guard let taskId = data["task_id"] as? String,
              let convId = data["source_conversation_id"] as? String else { return }
        logger.info("Discovery task created: \(taskId, privacy: .public)")

        // Build rawData matching server payload for the card to consume
        var rawData: [String: Any] = [
            "task_id": taskId,
            "source_conversation_id": convId,
            "status": "pending",
            "original_intent": data["original_intent"] as? String ?? "",
            "max_hops": data["max_hops"] as? Int ?? 5,
            "current_hop_count": 0,
            "pending_queries": data["pending_queries"] as? [[String: Any]] ?? [],
            "active_sessions": [] as [[String: Any]],
            "completed_results": [] as [[String: Any]],
        ]
        if let ts = data["timestamp"] { rawData["timestamp"] = ts }

        let messageId = "discovery-\(taskId)"
        eventHandler.upsertDiscoveryMessage(messageId: messageId, conversationId: convId, data: rawData, serverTimestamp: parseServerTimestamp(data))
        updateConversationPreview(conversationId: convId, preview: "[发现任务] \(rawData["original_intent"] as? String ?? "")", date: Date())

        // Refresh conversation list if this conversation is unknown
        if !conversations.contains(where: { $0.id == convId }) {
            Task { await loadConversations() }
        }
    }

    private func handleDiscoveryProgress(_ msg: ServerMessage) {
        let data = msg.data
        guard let taskId = data["task_id"] as? String,
              let convId = data["source_conversation_id"] as? String else { return }
        logger.info("Discovery progress: \(taskId, privacy: .public)")

        var patch: [String: Any] = [:]
        if let status = data["status"] as? String { patch["status"] = status }
        if let hopCount = data["current_hop_count"] as? Int { patch["current_hop_count"] = hopCount }
        if let maxHops = data["max_hops"] as? Int { patch["max_hops"] = maxHops }
        if let queries = data["pending_queries"] { patch["pending_queries"] = queries }
        if let sessions = data["active_sessions"] { patch["active_sessions"] = sessions }
        if let results = data["completed_results"] { patch["completed_results"] = results }
        if let ts = data["timestamp"] { patch["timestamp"] = ts }

        let messageId = "discovery-\(taskId)"
        eventHandler.upsertDiscoveryMessage(messageId: messageId, conversationId: convId, data: patch)
    }

    private func handleDiscoveryCompleted(_ msg: ServerMessage) {
        let data = msg.data
        guard let taskId = data["task_id"] as? String,
              let convId = data["source_conversation_id"] as? String else { return }
        logger.info("Discovery completed: \(taskId, privacy: .public)")

        var patch: [String: Any] = [
            "status": data["status"] as? String ?? "completed",
        ]
        if let results = data["completed_results"] { patch["completed_results"] = results }
        if let total = data["total_contacted"] { patch["total_contacted"] = total }
        if let ts = data["timestamp"] { patch["timestamp"] = ts }

        let messageId = "discovery-\(taskId)"
        eventHandler.upsertDiscoveryMessage(messageId: messageId, conversationId: convId, data: patch)
    }

    // MARK: - Task Event Handlers

    private func handleTaskProgress(_ msg: ServerMessage) {
        let data = msg.data
        guard let taskId = data["task_id"] as? String,
              let convId = data["conversation_id"] as? String else { return }
        logger.info("Task progress: \(taskId, privacy: .public)")

        let rawData: [String: Any] = [
            "task_id": taskId,
            "conversation_id": convId,
            "stage": data["stage"] as? String ?? "",
            "progress": data["progress"] as? Int ?? 0,
            "details": data["details"] as? [String: Any] ?? [:],
        ]

        let messageId = "task-progress-\(taskId)"
        eventHandler.upsertTaskProgressMessage(
            messageId: messageId,
            conversationId: convId,
            contentType: .taskProgress,
            data: rawData,
            serverTimestamp: parseServerTimestamp(data)
        )
    }

    private func handleTaskCompleted(_ msg: ServerMessage) {
        let data = msg.data
        guard let taskId = data["task_id"] as? String,
              let convId = data["conversation_id"] as? String else { return }
        let success = data["success"] as? Bool ?? false
        logger.info("Task completed: \(taskId, privacy: .public) success=\(success)")

        let rawData: [String: Any] = [
            "task_id": taskId,
            "conversation_id": convId,
            "success": success,
            "summary": data["summary"] as? String ?? "",
        ]

        let messageId = "task-result-\(taskId)"
        eventHandler.upsertTaskProgressMessage(
            messageId: messageId,
            conversationId: convId,
            contentType: .taskResult,
            data: rawData,
            serverTimestamp: parseServerTimestamp(data)
        )
    }

    func abortCurrentRun() async throws {
        guard let connection, let conversationId = activeConversationId else { return }
        try await connection.send([
            "type": "message.stop",
            "data": ["conversation_id": conversationId],
        ])
    }

    // MARK: - Dialog Approve / Reject

    func approveDialogSession(sessionId: String) async {
        do {
            try await api?.approveDialog(sessionId: sessionId, approved: true)
            eventHandler.updateDialogCardStatus(sessionId: sessionId, newStatus: "active")
        } catch {
            logger.error("Failed to approve dialog \(sessionId, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    func rejectDialogSession(sessionId: String) async {
        do {
            try await api?.approveDialog(sessionId: sessionId, approved: false)
            eventHandler.updateDialogCardStatus(sessionId: sessionId, newStatus: "terminated")
        } catch {
            logger.error("Failed to reject dialog \(sessionId, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Dialog Intent Authorization

    func authorizeDialogIntent(authorizationId: String, approved: Bool) async {
        guard let connection else { return }
        do {
            try await connection.send([
                "type": "dialog.intent_authorize",
                "data": [
                    "authorization_id": authorizationId,
                    "approved": approved,
                ],
            ])
            // Update the card status in the conversation
            eventHandler.updateIntentAuthCardStatus(
                authorizationId: authorizationId,
                approved: approved
            )
        } catch {
            logger.error("Failed to send intent auth response: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Discovery Task Confirm / Cancel

    func confirmDiscoveryTask(taskId: String) async {
        do {
            _ = try await api?.confirmDiscoveryTask(id: taskId)
            if let convId = activeConversationId {
                eventHandler.updateDiscoveryCardStatus(taskId: taskId, conversationId: convId, newStatus: "running")
            }
            logger.info("Discovery task confirmed: \(taskId, privacy: .public)")
        } catch {
            logger.error("Failed to confirm discovery task \(taskId, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    func cancelDiscoveryTask(taskId: String) async {
        do {
            _ = try await api?.cancelDiscoveryTask(id: taskId, reason: "用户取消")
            if let convId = activeConversationId {
                eventHandler.updateDiscoveryCardStatus(taskId: taskId, conversationId: convId, newStatus: "cancelled")
            }
            logger.info("Discovery task cancelled: \(taskId, privacy: .public)")
        } catch {
            logger.error("Failed to cancel discovery task \(taskId, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Conversation Preview Update

    /// Update a conversation's last message preview and move it to the top of the list.
    private func updateConversationPreview(conversationId: String, preview: String, date: Date) {
        guard let idx = conversations.firstIndex(where: { $0.id == conversationId }) else { return }
        conversations[idx].lastMessagePreview = preview
        conversations[idx].lastMessageAt = date

        // Move conversation to top of list (most recent first)
        if idx > 0 {
            let conv = conversations.remove(at: idx)
            conversations.insert(conv, at: 0)
        }

        // Persist to DB
        let record = ConversationRecord(from: conversations.first(where: { $0.id == conversationId })!)
        Task.detached { [store] in
            try? await store.saveConversations([record])
        }
    }

    /// Extract a text preview from a server message's data dictionary.
    private func extractMessagePreview(from data: [String: Any]) -> String {
        let contentType = data["content_type"] as? String ?? "text"
        if let content = data["content"] as? [String: Any] {
            if let text = content["text"] as? String, !text.isEmpty {
                return String(text.prefix(100))
            }
        }
        switch contentType {
        case "image": return "[图片]"
        case "video": return "[视频]"
        case "voice": return "[语音]"
        case "file": return "[文件]"
        default: return ""
        }
    }

    /// Parse an ISO 8601 timestamp string or numeric timestamp.
    private func parseTimestamp(_ value: Any?) -> Date? {
        if let str = value as? String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter.date(from: str) ?? ISO8601DateFormatter().date(from: str)
        }
        if let num = value as? Double {
            return Date(timeIntervalSince1970: num)
        }
        return nil
    }

    // MARK: - Streaming Cleanup

    private func startStreamCleanup() {
        cleanupTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                await self?.eventHandler.cleanupStaleStreams()
            }
        }
    }

    // MARK: - Computed Properties

    /// Messages for the active conversation only — O(1) bucket lookup.
    var activeMessages: [ChatMessage] {
        guard let id = activeConversationId else { return [] }
        return eventHandler.messages(for: id)
    }

    /// All loaded messages across all conversations (for search).
    var allMessages: [ChatMessage] {
        eventHandler.allMessages
    }

    /// Whether the active conversation is currently loading messages.
    var isLoadingMessages: Bool {
        guard let id = activeConversationId else { return false }
        if case .loading = eventHandler.loadState(for: id) { return true }
        return false
    }

    var isStreaming: Bool {
        eventHandler.isStreaming
    }

    var currentStreamingContent: String? {
        eventHandler.currentStreamingContent
    }

    var currentStreamingSender: Participant? {
        eventHandler.currentStreamingSender
    }

    var activeRunId: String? {
        eventHandler.activeRunId
    }

    // MARK: - A2A Draft Review Handlers

    private func handlePendingReview(_ data: [String: Any]) {
        guard let sessionId = data["session_id"] as? String,
              let conversationId = data["conversation_id"] as? String,
              let round = data["round"] as? Int,
              let draftText = data["draft_text"] as? String,
              let agentName = data["agent_name"] as? String
        else { return }

        pendingReview = DraftReview(
            sessionId: sessionId,
            conversationId: conversationId,
            round: round,
            tagDraftText: draftText,
            tagAgentName: agentName
        )
    }

    private func handleMainDraftReady(_ data: [String: Any]) {
        guard let draftText = data["draft_text"] as? String else { return }
        pendingReview?.mainDraftText = draftText
        pendingReview?.mainDraftStatus = .ready
    }

    private func handleDraftUpdated(_ data: [String: Any]) {
        guard let target = data["target"] as? String,
              let draftText = data["draft_text"] as? String
        else { return }

        if target == "tag" {
            pendingReview?.tagDraftText = draftText
            pendingReview?.tagDraftStatus = .ready
        } else if target == "main" {
            pendingReview?.mainDraftText = draftText
            pendingReview?.mainDraftStatus = .ready
        }
    }

    // MARK: - A2A Draft Review Actions

    func requestMainDraft() async {
        guard let review = pendingReview else { return }
        review.mainDraftStatus = .generating
        review.showMainDraft = true
        try? await api?.requestMainDraft(sessionId: review.sessionId)
    }

    func refineDraft(target: String, instruction: String) async {
        guard let review = pendingReview else { return }
        if target == "tag" {
            review.tagDraftStatus = .refining
        } else {
            review.mainDraftStatus = .refining
        }
        try? await api?.refineDraft(sessionId: review.sessionId, target: target, instruction: instruction)
    }

    func submitReviewedResponse() async {
        guard let review = pendingReview, review.canSubmit else { return }
        let text = review.finalText
        let sessionId = review.sessionId
        pendingReview = nil  // Clear immediately to prevent double-submit
        try? await api?.submitResponse(sessionId: sessionId, text: text)
    }
}
