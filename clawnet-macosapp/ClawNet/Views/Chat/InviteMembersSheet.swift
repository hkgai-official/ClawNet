import SwiftUI

/// Sheet for inviting members to a group chat or creating a new group.
struct InviteMembersSheet: View {
    @Environment(AppState.self) private var appState
    let contactService: ContactService
    let chatService: ChatService
    var existingConversationId: String?
    @Environment(\.dismiss) private var dismiss

    @State private var groupTitle = ""
    @State private var searchText = ""
    @State private var selectedContactIds: Set<String> = []
    @State private var isCreating = false
    @State private var errorMessage: String?

    private var isNewGroup: Bool { existingConversationId == nil }

    private var filteredContacts: [Contact] {
        // 群聊只显示人类联系人，不显示 agent
        let base = contactService.contacts.filter { $0.type == .human }
        if searchText.isEmpty { return base }
        return base.filter {
            $0.displayName.localizedCaseInsensitiveContains(searchText) ||
            ($0.nickname ?? "").localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(isNewGroup ? L.createGroup : L.inviteMembers)
                    .font(.headline)
                Spacer()
                Button(L.cancel) { dismiss() }
            }
            .padding()

            Divider()

            // Group title (only for new groups)
            if isNewGroup {
                HStack {
                    Text(L.groupName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField(L.groupNamePlaceholder, text: $groupTitle)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                Divider()
            }

            // Search
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .font(.caption)
                TextField(L.searchContacts, text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.subheadline)
            }
            .padding(8)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal)
            .padding(.vertical, 8)

            // Selected count
            if !selectedContactIds.isEmpty {
                HStack {
                    Text(L.selectedCount(selectedContactIds.count))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(L.clearAll) { selectedContactIds.removeAll() }
                        .font(.caption)
                }
                .padding(.horizontal)
                .padding(.bottom, 4)
            }

            Divider()

            // Contact list
            List {
                ForEach(filteredContacts) { contact in
                    let isSelected = selectedContactIds.contains(contact.id)
                    HStack(spacing: 10) {
                        ZStack {
                            Circle()
                                .fill(contact.type == .agent ? Color.purple.opacity(0.15) : Color.blue.opacity(0.15))
                                .frame(width: 32, height: 32)
                            Text(String(contact.displayName.prefix(1)).uppercased())
                                .font(.caption.bold())
                                .foregroundStyle(contact.type == .agent ? .purple : .blue)
                        }

                        VStack(alignment: .leading, spacing: 1) {
                            Text(contact.displayName)
                                .font(.subheadline)
                            if let nickname = contact.nickname, !nickname.isEmpty {
                                Text(nickname)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if isSelected {
                            selectedContactIds.remove(contact.id)
                        } else {
                            selectedContactIds.insert(contact.id)
                        }
                    }
                }
            }
            .listStyle(.plain)

            Divider()

            // Action button
            HStack {
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
                Spacer()
                Button(isNewGroup ? L.createGroup : L.invite) {
                    performAction()
                }
                .buttonStyle(.borderedProminent)
                .disabled(selectedContactIds.count < 2 && isNewGroup || selectedContactIds.isEmpty && !isNewGroup || isCreating)
            }
            .padding()
        }
        .frame(width: 400, height: 520)
    }

    private func performAction() {
        isCreating = true
        errorMessage = nil

        Task {
            do {
                let participantIds = Array(selectedContactIds)
                if let existingId = existingConversationId {
                    // Add members to existing group
                    _ = try await appState.api?.addMembers(conversationId: existingId, participantIds: participantIds)
                } else {
                    // Create new group
                    let title = groupTitle.isEmpty ? nil : groupTitle
                    _ = try await chatService.createGroupConversation(participantIds: participantIds, title: title)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isCreating = false
            }
        }
    }
}
