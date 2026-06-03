import Foundation
import GRDB

// MARK: - ConversationRecord

struct ConversationRecord: Codable, FetchableRecord, PersistableRecord, Sendable {
    static let databaseTableName = "conversations"

    var id: String
    var type: String
    var title: String?
    var summary: String?
    var participantsJson: String
    var lastMessagePreview: String?
    var lastMessageAt: Date?
    var unreadCount: Int
    var createdAt: Date
    var updatedAt: Date

    // MARK: Conversion

    init(from conversation: Conversation) {
        self.id = conversation.id
        self.type = conversation.type.rawValue
        self.title = conversation.title
        self.summary = conversation.summary
        self.participantsJson = Self.encodeParticipants(conversation.participants)
        self.lastMessagePreview = conversation.lastMessagePreview
        self.lastMessageAt = conversation.lastMessageAt
        self.unreadCount = conversation.unreadCount
        self.createdAt = conversation.createdAt
        self.updatedAt = conversation.updatedAt
    }

    func toConversation() -> Conversation? {
        guard let convType = Conversation.ConversationType(rawValue: type) else { return nil }
        let participants = Self.decodeParticipants(participantsJson)
        return Conversation(
            id: id,
            type: convType,
            title: title,
            summary: summary,
            participants: participants,
            lastMessagePreview: lastMessagePreview,
            lastMessageAt: lastMessageAt,
            unreadCount: unreadCount,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    private static let jsonEncoder: JSONEncoder = {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        return enc
    }()

    private static let jsonDecoder: JSONDecoder = {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return dec
    }()

    private static func encodeParticipants(_ participants: [Participant]) -> String {
        guard let data = try? jsonEncoder.encode(participants),
              let str = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return str
    }

    private static func decodeParticipants(_ json: String) -> [Participant] {
        guard let data = json.data(using: .utf8),
              let participants = try? jsonDecoder.decode([Participant].self, from: data) else {
            return []
        }
        return participants
    }
}

// MARK: - MessageRecord

struct MessageRecord: Codable, FetchableRecord, PersistableRecord, Sendable {
    static let databaseTableName = "messages"

    var id: String
    var conversationId: String
    var senderJson: String
    var contentType: String
    var contentJson: String
    var timestamp: Date
    var status: String?
    var contentRawJson: String?

    // MARK: Conversion

    init(from message: ChatMessage) {
        self.id = message.id
        self.conversationId = message.conversationId
        self.senderJson = Self.encodeSender(message.sender)
        self.contentType = message.contentType.rawValue
        self.contentJson = Self.encodeContent(message.content)
        self.timestamp = message.timestamp
        self.status = message.status?.rawValue
        self.contentRawJson = Self.encodeRawData(message.content.rawData)
    }

    func toChatMessage() -> ChatMessage? {
        guard let sender = Self.decodeSender(senderJson),
              let msgContentType = ChatMessage.MessageContentType(rawValue: contentType) else {
            return nil
        }
        var content = Self.decodeContent(contentJson)
        if let rawJson = contentRawJson {
            content.rawData = Self.decodeRawData(rawJson)
        }
        let msgStatus = status.flatMap { ChatMessage.MessageStatus(rawValue: $0) }
        return ChatMessage(
            id: id,
            conversationId: conversationId,
            sender: sender,
            contentType: msgContentType,
            content: content,
            timestamp: timestamp,
            status: msgStatus
        )
    }

    private static let jsonEncoder: JSONEncoder = {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        return enc
    }()

    private static let jsonDecoder: JSONDecoder = {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return dec
    }()

    private static func encodeSender(_ sender: Participant) -> String {
        guard let data = try? jsonEncoder.encode(sender),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }

    private static func decodeSender(_ json: String) -> Participant? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? jsonDecoder.decode(Participant.self, from: data)
    }

    private static func encodeContent(_ content: MessageContent) -> String {
        guard let data = try? jsonEncoder.encode(content),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }

    private static func decodeContent(_ json: String) -> MessageContent {
        guard let data = json.data(using: .utf8),
              let content = try? jsonDecoder.decode(MessageContent.self, from: data) else {
            return MessageContent()
        }
        return content
    }

    private static func encodeRawData(_ rawData: [String: Any]?) -> String? {
        guard let rawData, !rawData.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: rawData),
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }

    private static func decodeRawData(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return dict
    }
}

// MARK: - SyncStateRecord

struct SyncStateRecord: Codable, FetchableRecord, PersistableRecord, Sendable {
    static let databaseTableName = "syncState"

    var conversationId: String
    var lastSyncedMessageId: String?
    var lastSyncedAt: Date?
    var hasMoreHistory: Bool

    init(conversationId: String, lastSyncedMessageId: String? = nil, lastSyncedAt: Date? = nil, hasMoreHistory: Bool = true) {
        self.conversationId = conversationId
        self.lastSyncedMessageId = lastSyncedMessageId
        self.lastSyncedAt = lastSyncedAt
        self.hasMoreHistory = hasMoreHistory
    }
}
