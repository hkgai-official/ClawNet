import Foundation
import Observation
import OSLog

/// Manages contacts and friend requests, backed by REST API.
@MainActor @Observable
final class ContactService {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "contacts")

    var contacts: [Contact] = []
    var friendRequests: [FriendRequest] = []
    var isLoading = false
    var isLoadingRequests = false

    private var api: ClawNetAPI?

    func configure(api: ClawNetAPI) {
        self.api = api
    }

    // MARK: - Contacts

    func loadContacts() async {
        guard let api else { return }
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            contacts = try await api.getContacts()
            logger.info("Loaded \(self.contacts.count) contacts")
        } catch {
            logger.error("Failed to load contacts: \(error.localizedDescription)")
        }
    }

    func searchContacts(query: String) async -> [Contact] {
        guard let api, !query.isEmpty else { return [] }
        do {
            return try await api.searchContacts(query: query)
        } catch {
            logger.error("Search contacts failed: \(error.localizedDescription)")
            return []
        }
    }

    func sendFriendRequest(toUserId: String, message: String? = nil) async -> Bool {
        guard let api else { return false }
        do {
            let request = try await api.sendFriendRequest(toUserId: toUserId, message: message)
            // If the other party had already sent us a request, the server auto-accepts
            // and returns status "accepted" — refresh contacts in that case.
            if let request, request.status == .accepted {
                await loadContacts()
            }
            return true
        } catch {
            logger.error("Send friend request failed: \(error.localizedDescription)")
            return false
        }
    }

    func deleteContact(contactId: String) async -> Bool {
        guard let api else { return false }
        do {
            try await api.deleteContact(contactId: contactId)
            contacts.removeAll { $0.id == contactId }
            return true
        } catch {
            logger.error("Delete contact failed: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Friend Requests

    func loadFriendRequests() async {
        guard let api else { return }
        guard !isLoadingRequests else { return }
        isLoadingRequests = true
        defer { isLoadingRequests = false }
        do {
            friendRequests = try await api.getPendingFriendRequests()
            logger.info("Loaded \(self.friendRequests.count) friend requests")
        } catch {
            logger.error("Failed to load friend requests: \(error.localizedDescription)")
        }
    }

    func acceptFriendRequest(id: String) async -> Bool {
        guard let api else { return false }
        do {
            try await api.acceptFriendRequest(id: id)
            friendRequests.removeAll { $0.id == id }
            // Reload contacts to get the new one
            await loadContacts()
            return true
        } catch {
            logger.error("Accept friend request failed: \(error.localizedDescription)")
            return false
        }
    }

    func rejectFriendRequest(id: String) async -> Bool {
        guard let api else { return false }
        do {
            try await api.rejectFriendRequest(id: id)
            friendRequests.removeAll { $0.id == id }
            return true
        } catch {
            logger.error("Reject friend request failed: \(error.localizedDescription)")
            return false
        }
    }

    var pendingRequestCount: Int {
        friendRequests.filter { $0.status == .pending }.count
    }

    func clearAll() {
        contacts = []
        friendRequests = []
    }
}
