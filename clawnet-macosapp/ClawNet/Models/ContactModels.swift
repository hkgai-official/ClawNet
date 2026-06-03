import Foundation

// MARK: - Contact
//
// Fields mirror the backend ContactResponse exactly:
//   { id, display_name, avatar_url, email, type, status, nickname, tag_id, tag_name, tag_display_name }
// JSONDecoder.api uses .convertFromSnakeCase so no custom CodingKeys needed.

struct Contact: Identifiable, Codable, Sendable {
    let id: String
    let displayName: String
    let type: ContactType
    var avatarUrl: String?
    var email: String?
    var userCode: String?
    var nickname: String?
    var phone: String?
    var status: String?
    var tagId: String?
    var tagName: String?
    var tagDisplayName: String?

    enum ContactType: String, Codable, Sendable {
        case human
        case agent
    }
}

// MARK: - Friend Request

struct FriendRequest: Identifiable, Codable, Sendable {
    let id: String
    let fromUserId: String
    let fromUserName: String
    var fromUserAvatar: String?
    let toUserId: String
    let toUserName: String
    var toUserAvatar: String?
    var fromUserCode: String?
    var toUserCode: String?
    let status: RequestStatus
    var message: String?
    let createdAt: Date

    enum RequestStatus: String, Codable, Sendable {
        case pending
        case accepted
        case rejected
    }
}
