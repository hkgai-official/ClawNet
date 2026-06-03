import Foundation

// MARK: - Participant

struct Participant: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    var avatar: String?
    let type: ParticipantType
    var ownerId: String?
    var ownerName: String?
    var role: String?  // owner | admin | member (group conversations only)

    enum ParticipantType: String, Codable, Sendable {
        case human
        case agent
        case system
    }
}

// MARK: - Conversation

struct Conversation: Identifiable, Codable, Sendable {
    let id: String
    var type: ConversationType
    var title: String?
    var summary: String?       // AI-generated or user-edited summary
    var participants: [Participant]
    var lastMessagePreview: String?
    var lastMessageAt: Date?
    var unreadCount: Int
    var createdAt: Date
    var updatedAt: Date

    enum ConversationType: String, Codable, Sendable {
        case direct
        case group
        case agentTask = "agent_task"
    }
}

// MARK: - Message

struct ChatMessage: Identifiable, Codable, Sendable, Equatable {
    let id: String
    let conversationId: String
    let sender: Participant
    var contentType: MessageContentType
    var content: MessageContent
    var timestamp: Date
    var status: MessageStatus?

    enum MessageContentType: String, Codable, Sendable {
        case text
        case image
        case video
        case voice
        case file
        case system
        case richCard = "rich_card"
        case dialogRequest = "dialog_request"
        case dialogApproval = "dialog_approval"
        case dialogStatus = "dialog_status"
        case taskProgress = "task_progress"
        case taskResult = "task_result"
        case approvalRequest = "approval_request"
        case discoveryProgress = "discovery_progress"
    }

    enum MessageStatus: String, Codable, Sendable {
        case sending
        case sent
        case failed
        case read
    }

    /// Lightweight equality for SwiftUI diffing — includes card status so
    /// dialog/intent authorization cards re-render when their status changes.
    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id
            && lhs.status == rhs.status
            && (lhs.content.rawData?["status"] as? String) == (rhs.content.rawData?["status"] as? String)
    }

    /// Convenience: extract text from content regardless of type.
    var textContent: String {
        content.text ?? ""
    }

    /// Is this message from a human user?
    var isFromUser: Bool {
        sender.type == .human
    }

    private static let cardTypes: Set<MessageContentType> = [
        .dialogRequest, .dialogApproval, .dialogStatus,
        .taskProgress, .taskResult, .approvalRequest, .richCard, .discoveryProgress
    ]

    private enum CodingKeys: String, CodingKey {
        case id, conversationId, sender, contentType, content, timestamp, status
    }

    init(id: String, conversationId: String, sender: Participant, contentType: MessageContentType, content: MessageContent, timestamp: Date, status: MessageStatus? = nil) {
        self.id = id
        self.conversationId = conversationId
        self.sender = sender
        self.contentType = contentType
        self.content = content
        self.timestamp = timestamp
        self.status = status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        conversationId = try container.decode(String.self, forKey: .conversationId)
        sender = try container.decode(Participant.self, forKey: .sender)
        contentType = try container.decode(MessageContentType.self, forKey: .contentType)
        timestamp = try container.decode(Date.self, forKey: .timestamp)
        status = try container.decodeIfPresent(MessageStatus.self, forKey: .status)

        var decoded = try container.decode(MessageContent.self, forKey: .content)
        if Self.cardTypes.contains(contentType), decoded.rawData == nil {
            if let rawAnyCodable = try? container.decode([String: AnyCodable].self, forKey: .content) {
                decoded.rawData = Self.unwrapAnyCodableDict(rawAnyCodable)
            }
        }
        content = decoded
    }

    private static func unwrapAnyCodableDict(_ dict: [String: AnyCodable]) -> [String: Any] {
        dict.mapValues { unwrapAnyCodableValue($0.value) }
    }

    private static func unwrapAnyCodableValue(_ value: Any) -> Any {
        if let dict = value as? [String: AnyCodable] {
            return unwrapAnyCodableDict(dict)
        }
        if let arr = value as? [AnyCodable] {
            return arr.map { unwrapAnyCodableValue($0.value) }
        }
        return value
    }
}

/// Flexible message content supporting text, images, files, and rich cards.
struct MessageContent: Codable, Sendable {
    var text: String?
    var url: String?
    var name: String?
    var size: Int?
    var mimeType: String?
    var id: String?
    var thumbnailUrl: String?
    var duration: Double?

    /// Raw content dict for card-type messages (dialog_request, task_progress, etc.)
    /// Not encoded/decoded via Codable — populated manually from WS/REST JSON.
    var rawData: [String: Any]? {
        get { _rawDataStorage }
        set { _rawDataStorage = newValue }
    }
    private var _rawDataStorage: [String: Any]?

    init(text: String) {
        self.text = text
    }

    init() {}

    /// Initialize from a raw content dict (for non-text message types)
    init(fromDict dict: [String: Any]) {
        self.text = dict["text"] as? String
        self.url = dict["url"] as? String
        self.name = dict["name"] as? String
        self.size = dict["size"] as? Int
        self.mimeType = dict["mime_type"] as? String ?? dict["mimeType"] as? String
        self.id = dict["id"] as? String
        self.thumbnailUrl = dict["thumbnail_url"] as? String ?? dict["thumbnailUrl"] as? String
        self.duration = dict["duration"] as? Double
        self._rawDataStorage = dict
    }

    private enum CodingKeys: String, CodingKey {
        case text, url, name, size, mimeType, id, thumbnailUrl, duration
    }

    /// Human-readable file size string.
    var formattedSize: String? {
        guard let size else { return nil }
        if size < 1024 { return "\(size) B" }
        if size < 1024 * 1024 { return String(format: "%.1f KB", Double(size) / 1024) }
        if size < 1024 * 1024 * 1024 { return String(format: "%.1f MB", Double(size) / (1024 * 1024)) }
        return String(format: "%.1f GB", Double(size) / (1024 * 1024 * 1024))
    }

    /// Determine if the MIME type represents an image.
    var isImage: Bool { mimeType?.hasPrefix("image/") == true }

    /// Determine if the MIME type represents a video.
    var isVideo: Bool { mimeType?.hasPrefix("video/") == true }

    /// Determine if the MIME type represents audio.
    var isAudio: Bool { mimeType?.hasPrefix("audio/") == true }
}

// MARK: - Streaming Message

/// Transient state for a message being streamed from the assistant.
struct StreamingMessage: Identifiable, Sendable {
    let id: String
    let conversationId: String
    let sender: Participant
    var content: String
    var timestamp: Date
    var lastDeltaAt: Date

    /// Timeout threshold — consider stale after 60 seconds of no deltas.
    static let idleTimeoutSeconds: TimeInterval = 60
}

// MARK: - Draft Review (A2A Human Review)

/// Holds draft review state for A2A human review mode.
@Observable
class DraftReview {
    var sessionId: String
    var conversationId: String
    var round: Int
    var tagDraftText: String
    var tagDraftStatus: DraftStatus
    var tagAgentName: String

    var mainDraftText: String?
    var mainDraftStatus: DraftStatus?
    var showMainDraft: Bool = false

    var manualText: String = ""

    /// Which source is selected for sending
    var selectedSource: DraftSource = .tag

    init(sessionId: String, conversationId: String, round: Int, tagDraftText: String, tagAgentName: String) {
        self.sessionId = sessionId
        self.conversationId = conversationId
        self.round = round
        self.tagDraftText = tagDraftText
        self.tagDraftStatus = .ready
        self.tagAgentName = tagAgentName
    }

    var finalText: String {
        switch selectedSource {
        case .tag: return tagDraftText
        case .main: return mainDraftText ?? ""
        case .manual: return manualText
        }
    }

    var canSubmit: Bool {
        !finalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum DraftStatus: String {
    case generating
    case ready
    case refining
}

enum DraftSource {
    case tag
    case main
    case manual
}

// MARK: - Pagination

struct PaginationMeta: Codable, Sendable {
    let page: Int
    let pageSize: Int
    let total: Int
    let hasMore: Bool
    var newestId: String?
    var oldestId: String?
}
