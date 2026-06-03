import Foundation
import OSLog

// MARK: - Conversation Cache

enum ConversationLoadState {
    case notLoaded
    case loading
    case loaded
    case failed(Error)
}

struct ConversationCache {
    var messages: [ChatMessage] = []
    var loadState: ConversationLoadState = .notLoaded
    var lastFetchedAt: Date?
    var hasMore: Bool = true
    var paginationCursor: String?
}

// MARK: - Stream Playback Buffer

/// Accumulates raw stream deltas and controls playback rate.
/// Properties are NOT @Observable — only `displayedContent` is pushed
/// to the observable `streamingMessages` dict on each playback tick.
struct StreamPlaybackBuffer {
    /// Full text received from network so far (append-only).
    var receivedContent: String = ""
    /// How many characters have been "played back" to the UI.
    var displayedCursor: Int = 0
    /// Whether stream_end has been received.
    var isComplete: Bool = false
    /// Metadata carried from stream_start.
    let conversationId: String
    let sender: Participant

    var bufferDepth: Int { receivedContent.count - displayedCursor }
    var displayedText: String { String(receivedContent.prefix(displayedCursor)) }
    var isDrained: Bool { isComplete && displayedCursor >= receivedContent.count }
}

/// Handles agent/chat events from the gateway and updates the chat UI state.
/// Messages are now persisted to LocalStore (GRDB/SQLite) alongside the in-memory cache.
@MainActor @Observable
final class ChatEventHandler {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "chat-events")
    private let store = LocalStore.shared

    var lastHeartbeatStatus: String?
    var lastHeartbeatAt: Date?

    private(set) var messagesByConversation: [String: ConversationCache] = [:]
    private(set) var streamingMessages: [String: StreamingMessage] = [:]
    private(set) var activeRunId: String?

    // MARK: - Playback State (not @Observable — internal only)

    /// Per-stream playback buffers, keyed by run/message ID.
    @ObservationIgnored private var playbackBuffers: [String: StreamPlaybackBuffer] = [:]
    /// Active playback tasks, keyed by run/message ID.
    @ObservationIgnored private var playbackTasks: [String: Task<Void, Never>] = [:]

    /// The agent participant used for assistant messages.
    var agentParticipant = Participant(id: "agent", name: "Assistant", type: .agent)

    // MARK: - Gateway Agent Events

    func handleAgentEvent(_ frame: EventFrame) {
        guard let payload = frame.payload?.value as? [String: Any] else { return }

        let phase = payload["phase"] as? String
        let eventType = payload["type"] as? String
        let key = phase ?? eventType

        switch key {
        case "stream_start":
            let messageId = payload["runId"] as? String ?? UUID().uuidString
            self.activeRunId = messageId
            // Initialize playback buffer (non-observable, no UI trigger)
            playbackBuffers[messageId] = StreamPlaybackBuffer(
                conversationId: activeConversationId ?? "",
                sender: agentParticipant
            )
            // Create the observable streaming message with empty content
            // (PlaybackEngine will fill it progressively)
            let streaming = StreamingMessage(
                id: messageId,
                conversationId: activeConversationId ?? "",
                sender: agentParticipant,
                content: "",
                timestamp: Date(),
                lastDeltaAt: Date()
            )
            self.streamingMessages[messageId] = streaming
            startPlayback(for: messageId)

        case "stream_delta", "delta":
            if let delta = payload["delta"] as? String {
                if let runId = activeRunId {
                    // Append to buffer only — no @Observable write, no UI trigger
                    playbackBuffers[runId]?.receivedContent.append(contentsOf: delta)
                }
            }

        case "stream_end", "end":
            if let runId = activeRunId {
                // Mark buffer complete — PlaybackEngine will drain and finalize
                playbackBuffers[runId]?.isComplete = true
                // activeRunId is cleared by finalizeStream() after drain completes
            }

        default:
            logger.debug("Unhandled agent event: \(key ?? "nil", privacy: .public)")
        }
    }

    func handleHeartbeat(_ frame: EventFrame) {
        guard let payload = frame.payload?.value as? [String: Any] else { return }
        self.lastHeartbeatStatus = payload["status"] as? String
        self.lastHeartbeatAt = Date()
    }

    func handleSnapshot(_ helloOk: HelloOk) {
        logger.info("Gateway snapshot received: protocol=\(helloOk._protocol)")
    }

    // MARK: - Message Management

    /// Currently active conversation ID (set by ChatService when switching conversations).
    var activeConversationId: String?

    /// O(1) message access for a specific conversation.
    func messages(for conversationId: String) -> [ChatMessage] {
        messagesByConversation[conversationId]?.messages ?? []
    }

    /// Load state for a specific conversation.
    func loadState(for conversationId: String) -> ConversationLoadState {
        messagesByConversation[conversationId]?.loadState ?? .notLoaded
    }

    /// All loaded messages across all conversations (for search).
    var allMessages: [ChatMessage] {
        messagesByConversation.values.flatMap(\.messages)
    }

    /// Load messages from the local database into the in-memory cache.
    /// Awaitable — returns after the cache has been populated on MainActor.
    func loadMessagesFromDB(for conversationId: String) async {
        ensureCache(for: conversationId)
        let records = try? await store.loadMessages(conversationId: conversationId, limit: 200)
        guard let records, !records.isEmpty else { return }
        let messages = records.compactMap { $0.toChatMessage() }
        guard !messages.isEmpty else { return }
        if self.messagesByConversation[conversationId]!.messages.isEmpty {
            self.messagesByConversation[conversationId]!.messages = messages
        } else {
            let existingIds = Set(self.messagesByConversation[conversationId]!.messages.map(\.id))
            let unique = messages.filter { !existingIds.contains($0.id) }
            self.messagesByConversation[conversationId]!.messages.insert(contentsOf: unique, at: 0)
            self.messagesByConversation[conversationId]!.messages.sort { $0.timestamp < $1.timestamp }
        }
    }

    /// Add a user message optimistically and return its temp ID.
    @discardableResult
    func addUserMessage(_ text: String, conversationId: String, sender: Participant) -> String {
        let tempId = "temp-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 1000...9999))"
        let message = ChatMessage(
            id: tempId,
            conversationId: conversationId,
            sender: sender,
            contentType: .text,
            content: MessageContent(text: text),
            timestamp: Date(),
            status: .sending
        )
        ensureCache(for: conversationId)
        messagesByConversation[conversationId]!.messages.append(message)
        persistMessages([message])
        return tempId
    }

    /// Add a media message optimistically (for image/video/file upload preview).
    @discardableResult
    func addUserMediaMessage(
        contentType: ChatMessage.MessageContentType,
        content: MessageContent,
        conversationId: String,
        sender: Participant
    ) -> String {
        let tempId = "temp-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 1000...9999))"
        let message = ChatMessage(
            id: tempId,
            conversationId: conversationId,
            sender: sender,
            contentType: contentType,
            content: content,
            timestamp: Date(),
            status: .sending
        )
        ensureCache(for: conversationId)
        messagesByConversation[conversationId]!.messages.append(message)
        persistMessages([message])
        return tempId
    }

    /// Update message status after REST API persistence completes.
    func updateMessageStatus(tempId: String, realId: String?, status: ChatMessage.MessageStatus) {
        for convId in messagesByConversation.keys {
            guard let index = messagesByConversation[convId]!.messages.firstIndex(where: { $0.id == tempId }) else { continue }
            let old = messagesByConversation[convId]!.messages[index]
            messagesByConversation[convId]!.messages[index] = ChatMessage(
                id: realId ?? old.id,
                conversationId: old.conversationId,
                sender: old.sender,
                contentType: old.contentType,
                content: old.content,
                timestamp: old.timestamp,
                status: status
            )
            Task.detached { [store] in
                try? await store.updateMessageStatus(id: tempId, newId: realId, status: status.rawValue)
            }
            return
        }
    }

    func setMessages(_ messages: [ChatMessage], for conversationId: String) {
        ensureCache(for: conversationId)
        messagesByConversation[conversationId]!.messages = messages
        persistMessages(messages)
    }

    func appendMessages(_ newMessages: [ChatMessage], to conversationId: String) {
        ensureCache(for: conversationId)
        let existingIds = Set(messagesByConversation[conversationId]!.messages.map(\.id))
        let unique = newMessages.filter { !existingIds.contains($0.id) }
        messagesByConversation[conversationId]!.messages.append(contentsOf: unique)
        messagesByConversation[conversationId]!.messages.sort { $0.timestamp < $1.timestamp }
        if !unique.isEmpty {
            persistMessages(unique)
        }
    }

    func setLoadState(_ state: ConversationLoadState, for conversationId: String) {
        ensureCache(for: conversationId)
        messagesByConversation[conversationId]!.loadState = state
        if case .loaded = state {
            messagesByConversation[conversationId]!.lastFetchedAt = Date()
        }
    }

    func clearMessages() {
        for runId in playbackTasks.keys {
            cancelPlayback(for: runId)
        }
        self.messagesByConversation.removeAll()
        self.streamingMessages.removeAll()
        self.activeRunId = nil
        Task.detached { [store] in
            try? await store.clearAll()
        }
    }

    private func ensureCache(for conversationId: String) {
        if messagesByConversation[conversationId] == nil {
            messagesByConversation[conversationId] = ConversationCache()
        }
    }

    /// Persist messages to the local SQLite database in the background.
    private func persistMessages(_ messages: [ChatMessage]) {
        let records = messages.map { MessageRecord(from: $0) }
        Task.detached { [store] in
            try? await store.saveMessages(records)
        }
    }

    /// Clean up stale streaming messages.
    /// Only cleans up if the connection appears dead (no heartbeat for >90s),
    /// to avoid deleting messages during long LLM thinking pauses.
    func cleanupStaleStreams() {
        let now = Date()

        if let lastHB = lastHeartbeatAt, now.timeIntervalSince(lastHB) < 90 {
            return
        }

        let staleIds = streamingMessages.filter {
            now.timeIntervalSince($0.value.lastDeltaAt) > StreamingMessage.idleTimeoutSeconds
        }.map(\.key)
        for id in staleIds {
            streamingMessages.removeValue(forKey: id)
            cancelPlayback(for: id)
            if activeRunId == id { activeRunId = nil }
        }
    }

    /// The current streaming text for display — only if it belongs to the active conversation.
    var currentStreamingContent: String? {
        guard let runId = activeRunId,
              let streaming = streamingMessages[runId],
              streaming.conversationId == activeConversationId else {
            return nil
        }
        return streaming.content
    }

    var currentStreamingSender: Participant? {
        guard let runId = activeRunId,
              let streaming = streamingMessages[runId],
              streaming.conversationId == activeConversationId else {
            return nil
        }
        return streaming.sender
    }

    /// Whether the active conversation has an ongoing stream.
    var isStreaming: Bool {
        guard let convId = activeConversationId else { return false }
        return streamingMessages.values.contains { $0.conversationId == convId }
    }

    // MARK: - Server WebSocket Event Handlers

    func handleStreamStart(_ msg: ServerMessage) {
        let data = msg.data
        guard let messageId = data["message_id"] as? String else { return }

        self.activeRunId = messageId
        let convId = data["conversation_id"] as? String ?? activeConversationId ?? ""
        let sender = parseSender(data["sender"])

        // Initialize playback buffer
        playbackBuffers[messageId] = StreamPlaybackBuffer(
            conversationId: convId,
            sender: sender
        )
        // Create observable streaming message (empty — filled by playback)
        let streaming = StreamingMessage(
            id: messageId,
            conversationId: convId,
            sender: sender,
            content: "",
            timestamp: Date(),
            lastDeltaAt: Date()
        )
        self.streamingMessages[messageId] = streaming
        startPlayback(for: messageId)
    }

    func handleStreamDelta(_ msg: ServerMessage) {
        let data = msg.data
        guard let messageId = data["message_id"] as? String else { return }
        let delta = data["delta"] as? String ?? ""

        // Append to buffer only — no @Observable write
        playbackBuffers[messageId]?.receivedContent.append(contentsOf: delta)
    }

    func handleStreamEnd(_ msg: ServerMessage) {
        let data = msg.data
        guard let messageId = data["message_id"] as? String else { return }
        let finalText = data["final_text"] as? String

        // If server provides final_text, replace buffer content entirely
        if let finalText {
            let currentCursor = playbackBuffers[messageId]?.displayedCursor ?? 0
            playbackBuffers[messageId]?.displayedCursor = min(currentCursor, finalText.count)
            playbackBuffers[messageId]?.receivedContent = finalText
        }

        // Mark buffer complete — PlaybackEngine drains and finalizes
        playbackBuffers[messageId]?.isComplete = true
    }

    /// Returns `true` if this was a genuinely new message (not a replacement/dedup).
    @discardableResult
    func handleMessageNew(_ msg: ServerMessage) -> Bool {
        let data = msg.data
        guard let id = data["id"] as? String,
              let conversationId = data["conversation_id"] as? String else { return false }

        // If there's an active playback for this conversation, cancel it —
        // message.new is the authoritative source.
        if let runId = activeRunId, playbackBuffers[runId]?.conversationId == conversationId {
            cancelPlayback(for: runId)
            streamingMessages.removeValue(forKey: runId)
            self.activeRunId = nil
        }

        let sender = parseSender(data["sender"])
        let contentTypeStr = data["content_type"] as? String ?? "text"
        let contentDict = data["content"] as? [String: Any] ?? [:]
        let timestamp = (data["timestamp"] as? String)
            .flatMap { ISO8601DateFormatter().date(from: $0) } ?? Date()

        let textLikeTypes: Set<String> = ["text", "system"]
        let messageContent: MessageContent
        if textLikeTypes.contains(contentTypeStr) {
            messageContent = MessageContent(text: contentDict["text"] as? String ?? "")
        } else {
            messageContent = MessageContent(fromDict: contentDict)
        }

        let message = ChatMessage(
            id: id,
            conversationId: conversationId,
            sender: sender,
            contentType: ChatMessage.MessageContentType(rawValue: contentTypeStr) ?? .text,
            content: messageContent,
            timestamp: timestamp,
            status: .sent
        )

        // If this message.new follows a stream, replace the streaming-generated
        // message (which used a temporary ID) with the persisted one.
        if let streamingMsgId = data["streaming_message_id"] as? String,
           let idx = messagesByConversation[conversationId]?.messages.firstIndex(where: { $0.id == streamingMsgId }) {
            messagesByConversation[conversationId]!.messages[idx] = message
            persistMessages([message])
            if streamingMsgId != id {
                Task.detached { [store] in
                    try? await store.deleteMessage(id: streamingMsgId)
                }
            }
            return false
        }

        // Fallback dedup: if a recent message from the same sender in the same
        // conversation has identical text content, treat it as a duplicate and
        // replace instead of appending (handles cases where streaming_message_id
        // was missing or the IDs didn't match).
        if textLikeTypes.contains(contentTypeStr),
           let newText = messageContent.text, !newText.isEmpty,
           let cache = messagesByConversation[conversationId] {
            let duplicateIdx = cache.messages.lastIndex { existing in
                existing.sender.id == sender.id
                && existing.content.text == newText
                && abs(existing.timestamp.timeIntervalSince(timestamp)) < 30
            }
            if let idx = duplicateIdx {
                let oldId = messagesByConversation[conversationId]!.messages[idx].id
                messagesByConversation[conversationId]!.messages[idx] = message
                persistMessages([message])
                if oldId != id {
                    Task.detached { [store] in
                        try? await store.deleteMessage(id: oldId)
                    }
                }
                return false
            }
        }

        // Fallback dedup for media messages: match by temp ID prefix and same
        // sender within a short time window. Covers edge cases where the real
        // ID update (Step 2) hasn't completed before the WebSocket event arrives.
        if !textLikeTypes.contains(contentTypeStr),
           let cache = messagesByConversation[conversationId] {
            let duplicateIdx = cache.messages.lastIndex { existing in
                existing.sender.id == sender.id
                && existing.id.hasPrefix("temp-")
                && existing.contentType.rawValue == contentTypeStr
                && abs(existing.timestamp.timeIntervalSince(timestamp)) < 30
            }
            if let idx = duplicateIdx {
                let oldId = messagesByConversation[conversationId]!.messages[idx].id
                messagesByConversation[conversationId]!.messages[idx] = message
                persistMessages([message])
                Task.detached { [store] in
                    try? await store.deleteMessage(id: oldId)
                }
                return false
            }
        }

        appendMessages([message], to: conversationId)
        return true
    }

    func handleMessageStop(_ msg: ServerMessage) {
        for runId in playbackTasks.keys {
            cancelPlayback(for: runId)
        }
        self.streamingMessages.removeAll()
        self.activeRunId = nil
    }

    // MARK: - Dialog Card Status Update

    /// Update dialog_request / dialog_approval card status in-memory and persist.
    func updateDialogCardStatus(sessionId: String, newStatus: String) {
        let dialogTypes: Set<ChatMessage.MessageContentType> = [.dialogRequest, .dialogApproval]

        for (convId, cache) in messagesByConversation {
            for (idx, msg) in cache.messages.enumerated() {
                guard dialogTypes.contains(msg.contentType),
                      let raw = msg.content.rawData,
                      raw["sessionId"] as? String == sessionId else { continue }

                let cardStatus: String
                if msg.contentType == .dialogRequest {
                    cardStatus = switch newStatus {
                    case "active": "confirmed"
                    case "completed": "completed"
                    case "terminated": "cancelled"
                    default: "pending"
                    }
                } else {
                    cardStatus = switch newStatus {
                    case "active": "approved"
                    case "completed": "completed"
                    case "terminated": "rejected"
                    default: "pending"
                    }
                }

                var updatedRaw = raw
                updatedRaw["status"] = cardStatus
                var updatedMsg = msg
                updatedMsg.content.rawData = updatedRaw
                messagesByConversation[convId]!.messages[idx] = updatedMsg
                persistMessages([updatedMsg])
            }
        }
    }

    /// Update intent_authorization card status after user approves/denies.
    func updateIntentAuthCardStatus(authorizationId: String, approved: Bool) {
        for (convId, cache) in messagesByConversation {
            for (idx, msg) in cache.messages.enumerated() {
                guard msg.contentType == .richCard,
                      let raw = msg.content.rawData,
                      raw["authorizationId"] as? String == authorizationId else { continue }

                var updatedRaw = raw
                updatedRaw["status"] = approved ? "approved" : "denied"
                var updatedMsg = msg
                updatedMsg.content.rawData = updatedRaw
                messagesByConversation[convId]!.messages[idx] = updatedMsg
                persistMessages([updatedMsg])
            }
        }
    }

    // MARK: - Discovery / Task Message Upsert

    private let systemSender = Participant(id: "system", name: "系统", type: .system)

    /// Insert a new discovery progress message, or merge-update an existing one by message ID.
    func upsertDiscoveryMessage(messageId: String, conversationId: String, data: [String: Any], serverTimestamp: Date? = nil) {
        ensureCache(for: conversationId)
        if let idx = messagesByConversation[conversationId]!.messages.firstIndex(where: { $0.id == messageId }) {
            // Merge update: overlay new data onto existing rawData (不改时间戳，保持原始位置)
            var existingRaw = messagesByConversation[conversationId]!.messages[idx].content.rawData ?? [:]
            for (key, value) in data {
                existingRaw[key] = value
            }
            var updatedMsg = messagesByConversation[conversationId]!.messages[idx]
            updatedMsg.content.rawData = existingRaw
            messagesByConversation[conversationId]!.messages[idx] = updatedMsg
            persistMessages([updatedMsg])
        } else {
            // Insert new message
            let content = MessageContent(fromDict: data)
            let message = ChatMessage(
                id: messageId,
                conversationId: conversationId,
                sender: systemSender,
                contentType: .discoveryProgress,
                content: content,
                timestamp: serverTimestamp ?? Date(),
                status: .sent
            )
            messagesByConversation[conversationId]!.messages.append(message)
            persistMessages([message])
        }
    }

    /// Insert or update a task progress message by message ID.
    func upsertTaskProgressMessage(messageId: String, conversationId: String, contentType: ChatMessage.MessageContentType, data: [String: Any], serverTimestamp: Date? = nil) {
        ensureCache(for: conversationId)
        if let idx = messagesByConversation[conversationId]!.messages.firstIndex(where: { $0.id == messageId }) {
            var existingRaw = messagesByConversation[conversationId]!.messages[idx].content.rawData ?? [:]
            for (key, value) in data {
                existingRaw[key] = value
            }
            var updatedMsg = messagesByConversation[conversationId]!.messages[idx]
            updatedMsg.content.rawData = existingRaw
            messagesByConversation[conversationId]!.messages[idx] = updatedMsg
            persistMessages([updatedMsg])
        } else {
            let content = MessageContent(fromDict: data)
            let message = ChatMessage(
                id: messageId,
                conversationId: conversationId,
                sender: systemSender,
                contentType: contentType,
                content: content,
                timestamp: serverTimestamp ?? Date(),
                status: .sent
            )
            messagesByConversation[conversationId]!.messages.append(message)
            persistMessages([message])
        }
    }

    /// Update the status field in a discovery message's rawData.
    func updateDiscoveryCardStatus(taskId: String, conversationId: String, newStatus: String) {
        let messageId = "discovery-\(taskId)"
        guard let idx = messagesByConversation[conversationId]?.messages.firstIndex(where: { $0.id == messageId }) else { return }
        var updatedMsg = messagesByConversation[conversationId]!.messages[idx]
        var raw = updatedMsg.content.rawData ?? [:]
        raw["status"] = newStatus
        updatedMsg.content.rawData = raw
        messagesByConversation[conversationId]!.messages[idx] = updatedMsg
        persistMessages([updatedMsg])
    }

    private func parseSender(_ senderData: Any?) -> Participant {
        guard let dict = senderData as? [String: Any] else {
            return Participant(id: "agent", name: "Assistant", type: .agent)
        }
        return Participant(
            id: dict["id"] as? String ?? "agent",
            name: dict["display_name"] as? String ?? dict["name"] as? String ?? "Assistant",
            type: (dict["type"] as? String == "human") ? .human : .agent,
            ownerId: dict["owner_id"] as? String,
            ownerName: dict["owner_name"] as? String
        )
    }

    // MARK: - Playback Engine

    private func startPlayback(for runId: String) {
        guard playbackTasks[runId] == nil else { return }
        playbackTasks[runId] = Task { [weak self] in
            await self?.playbackLoop(runId: runId)
        }
    }

    private func playbackLoop(runId: String) async {
        while !Task.isCancelled {
            guard var buffer = playbackBuffers[runId] else { break }

            let depth = buffer.bufferDepth
            if depth == 0 {
                if buffer.isComplete {
                    finalizeStream(runId: runId)
                    break
                }
                do { try await Task.sleep(nanoseconds: 16_000_000) } catch { break }
                continue
            }

            // ── Chunk size: base + random + catch-up ──
            let baseChunk = 8
            let randomExtra = Int.random(in: 0...12)
            let catchUp = min(depth / 50, 30)
            let drainBoost = buffer.isComplete ? min(depth / 10, 60) : 0
            let chunkSize = min(baseChunk + randomExtra + catchUp + drainBoost, depth)

            // Advance cursor
            buffer.displayedCursor += chunkSize
            playbackBuffers[runId] = buffer

            // ── Push to @Observable (this triggers SwiftUI) ──
            if var streaming = streamingMessages[runId] {
                streaming.content = buffer.displayedText
                streaming.lastDeltaAt = Date()
                self.streamingMessages[runId] = streaming
            }

            // ── Next tick interval: adaptive base + jitter - speedup ──
            // Longer content → slower tick rate (Markdown parse cost grows with length)
            let displayedLen = buffer.displayedCursor
            let baseInterval: Int64 = displayedLen > 5000 ? 200_000_000
                                    : displayedLen > 2000 ? 100_000_000
                                    : 50_000_000
            let jitter = Int64.random(in: -12_000_000...12_000_000)
            let speedUp = min(Int64(depth) * 80_000, 15_000_000)
            let drainSpeedUp: Int64 = buffer.isComplete ? 10_000_000 : 0
            let interval = max(baseInterval + jitter - speedUp - drainSpeedUp, 8_000_000)

            do { try await Task.sleep(nanoseconds: UInt64(interval)) } catch { break }
        }
    }

    private func finalizeStream(runId: String) {
        guard let buffer = playbackBuffers[runId] else { return }
        let finalContent = buffer.receivedContent

        if !finalContent.isEmpty {
            // Skip if message.new already delivered this content (avoids duplicate)
            let alreadyExists = messagesByConversation[buffer.conversationId]?.messages.suffix(5).contains {
                $0.content.text == finalContent
            } ?? false

            if !alreadyExists {
                let message = ChatMessage(
                    id: runId,
                    conversationId: buffer.conversationId,
                    sender: buffer.sender,
                    contentType: .text,
                    content: MessageContent(text: finalContent),
                    timestamp: Date(),
                    status: .sent
                )
                appendMessages([message], to: buffer.conversationId)
            }
        }

        // Clean up
        self.streamingMessages.removeValue(forKey: runId)
        self.playbackBuffers.removeValue(forKey: runId)
        self.playbackTasks.removeValue(forKey: runId)
        if self.activeRunId == runId { self.activeRunId = nil }
    }

    private func cancelPlayback(for runId: String) {
        playbackTasks[runId]?.cancel()
        playbackTasks.removeValue(forKey: runId)
        playbackBuffers.removeValue(forKey: runId)
    }
}
