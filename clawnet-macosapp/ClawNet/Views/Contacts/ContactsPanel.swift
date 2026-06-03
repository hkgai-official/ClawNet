import SwiftUI

/// Sidebar panel showing contacts list with search, friend requests, and add contact.
struct ContactsPanel: View {
    @Environment(AppState.self) private var appState
    @Bindable var contactService: ContactService
    let onSelectContact: (String) -> Void
    let onStartChat: (String) -> Void

    @State private var searchText = ""
    @State private var showAddContact = false
    @State private var showRequests = true

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(L.contacts)
                    .font(.headline)
                Spacer()
                Button(action: { showAddContact = true }) {
                    Image(systemName: "person.badge.plus")
                }
                .buttonStyle(.plain)
                .help(L.addFriend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            // Search
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField(L.searchContact, text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(6)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            Divider()

            // Content
            List {
                // Friend Requests Section
                if !contactService.friendRequests.isEmpty {
                    Section(isExpanded: $showRequests) {
                        ForEach(contactService.friendRequests) { request in
                            FriendRequestRow(
                                request: request,
                                onAccept: {
                                    Task { _ = await contactService.acceptFriendRequest(id: request.id) }
                                },
                                onReject: {
                                    Task { _ = await contactService.rejectFriendRequest(id: request.id) }
                                }
                            )
                        }
                    } header: {
                        HStack {
                            Text(L.friendRequests)
                            Spacer()
                            Text("\(contactService.friendRequests.count)")
                                .font(.caption2.bold())
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.red, in: Capsule())
                        }
                    }
                }

                // Contact List
                let filtered = filteredContacts
                if filtered.isEmpty && !contactService.isLoading {
                    ContentUnavailableView {
                        Label(L.noContacts, systemImage: "person.2")
                    } description: {
                        Text(L.addFriendsHint)
                    }
                } else {
                    let grouped = groupedContacts(filtered)
                    ForEach(grouped.keys.sorted(), id: \.self) { letter in
                        Section(header: Text(letter)) {
                            ForEach(grouped[letter] ?? []) { contact in
                                ContactRow(contact: contact, onStartChat: {
                                    onSelectContact(contact.id)
                                })
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .overlay {
                if contactService.isLoading && contactService.contacts.isEmpty {
                    ProgressView(L.loading)
                }
            }
        }
        .sheet(isPresented: $showAddContact) {
            AddContactSheet(contactService: contactService)
        }
        .task {
            await contactService.loadContacts()
            await contactService.loadFriendRequests()
        }
    }

    private var filteredContacts: [Contact] {
        if searchText.isEmpty { return contactService.contacts }
        let q = searchText.lowercased()
        return contactService.contacts.filter {
            $0.displayName.lowercased().contains(q)
            || ($0.email?.lowercased().contains(q) ?? false)
            || ($0.nickname?.lowercased().contains(q) ?? false)
        }
    }

    private func groupedContacts(_ contacts: [Contact]) -> [String: [Contact]] {
        Dictionary(grouping: contacts) { contact in
            let first = contact.displayName.first.flatMap { String($0).uppercased() } ?? "#"
            return first.rangeOfCharacter(from: .letters) != nil ? first : "#"
        }
    }
}

// MARK: - Contact Row

struct ContactRow: View {
    let contact: Contact
    let onStartChat: () -> Void

    var body: some View {
        Button(action: onStartChat) {
            HStack(spacing: 10) {
                // Avatar
                ZStack {
                    Circle()
                        .fill(contact.type == .agent ? SDColor.agentPrimary.opacity(0.2) : SDColor.info.opacity(0.2))
                        .frame(width: 36, height: 36)
                    Text(String(contact.displayName.prefix(1)).uppercased())
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(contact.type == .agent ? SDColor.agentPrimary : SDColor.info)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(contact.displayName)
                            .font(.body)
                            .foregroundStyle(SDColor.textPrimary)
                        if contact.type == .agent {
                            Text("AI")
                                .font(.caption2.bold())
                                .foregroundStyle(SDColor.agentPrimary)
                                .padding(.horizontal, SDSpacing.xs)
                                .padding(.vertical, SDSpacing.xxs)
                                .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    if let status = contact.status {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Friend Request Row

struct FriendRequestRow: View {
    let request: FriendRequest
    let onAccept: () -> Void
    let onReject: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Avatar
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.2))
                    .frame(width: 36, height: 36)
                Text(String(request.fromUserName.prefix(1)).uppercased())
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.orange)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(request.fromUserName)
                    .font(.body)
                if let msg = request.message, !msg.isEmpty {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            if request.status == .pending {
                Button(action: onAccept) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                .buttonStyle(.plain)
                .help(L.accept)

                Button(action: onReject) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .help(L.reject)
            }
        }
    }
}

// MARK: - Add Contact Sheet

struct AddContactSheet: View {
    @Bindable var contactService: ContactService
    @Environment(\.dismiss) private var dismiss

    @State private var searchQuery = ""
    @State private var searchResults: [Contact] = []
    @State private var isSearching = false
    @State private var message = ""
    @State private var statusMessage = ""

    var body: some View {
        VStack(spacing: 16) {
            Text(L.addFriend)
                .font(.headline)

            HStack {
                TextField(L.idUsernameOrEmail, text: $searchQuery)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { performSearch() }
                Button(L.search) { performSearch() }
                    .disabled(searchQuery.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if isSearching {
                ProgressView()
            } else if !searchResults.isEmpty {
                List(searchResults) { contact in
                    HStack {
                        ZStack {
                            Circle()
                                .fill(Color.blue.opacity(0.2))
                                .frame(width: 32, height: 32)
                            Text(String(contact.displayName.prefix(1)).uppercased())
                                .font(.caption.bold())
                                .foregroundStyle(.blue)
                        }
                        VStack(alignment: .leading) {
                            Text(contact.displayName)
                            if let code = contact.userCode {
                                Text("ID: \(code)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()

                        if contactService.contacts.contains(where: { $0.id == contact.id }) {
                            Text(L.alreadyFriend)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Button(L.apply) {
                                Task {
                                    let ok = await contactService.sendFriendRequest(
                                        toUserId: contact.id,
                                        message: message.isEmpty ? nil : message
                                    )
                                    statusMessage = ok ? L.requestSent : L.sendFailed
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                    }
                }
                .frame(height: 200)
            } else if !searchQuery.isEmpty && !isSearching {
                Text(L.userNotFound)
                    .foregroundStyle(.secondary)
            }

            if !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.green)
            }

            HStack {
                Spacer()
                Button(L.close) { dismiss() }
            }
        }
        .padding()
        .frame(width: 400)
    }

    private func performSearch() {
        let q = searchQuery.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        isSearching = true
        statusMessage = ""
        Task {
            searchResults = await contactService.searchContacts(query: q)
            isSearching = false
        }
    }
}
