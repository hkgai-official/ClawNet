import SwiftUI

/// Group chat detail sheet: view/edit title, manage members.
struct GroupDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let conversation: Conversation
    let chatService: ChatService
    let contactService: ContactService

    @State private var groupTitle: String = ""
    @State private var members: [Participant] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showInviteSheet = false
    @State private var isSavingTitle = false

    private var currentUserId: String? {
        if case .loggedIn(let user) = appState.authState { return user.id }
        return nil
    }

    private var myRole: String? {
        members.first(where: { $0.id == currentUserId })?.role
    }

    private var canManage: Bool {
        myRole == "owner" || myRole == "admin"
    }

    private var sortedMembers: [Participant] {
        let order: [String: Int] = ["owner": 0, "admin": 1, "member": 2]
        return members.sorted {
            let r0 = order[$0.role ?? "member"] ?? 2
            let r1 = order[$1.role ?? "member"] ?? 2
            if r0 != r1 { return r0 < r1 }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(L.groupDetail)
                    .font(.headline)
                Spacer()
                Button(L.done) { dismiss() }
            }
            .padding()
            Divider()

            // Group title
            HStack {
                Text(L.groupName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(width: 60, alignment: .leading)
                if canManage {
                    TextField(L.groupName, text: $groupTitle)
                        .textFieldStyle(.roundedBorder)
                    Button(L.save) { saveTitle() }
                        .disabled(isSavingTitle || groupTitle.isEmpty)
                        .buttonStyle(.bordered)
                } else {
                    Text(conversation.title ?? L.groups)
                        .foregroundStyle(.primary)
                    Spacer()
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            Divider()

            // Member count + add button
            HStack {
                Text(L.members(members.count))
                    .font(.subheadline.bold())
                Spacer()
                if canManage {
                    Button {
                        showInviteSheet = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                            .font(.subheadline)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            // Member list
            List {
                ForEach(sortedMembers) { member in
                    HStack(spacing: 10) {
                        // Avatar
                        ZStack {
                            Circle()
                                .fill(member.type == .agent ? Color.purple.opacity(0.15) : Color.blue.opacity(0.15))
                                .frame(width: 32, height: 32)
                            Text(String(member.name.prefix(1)).uppercased())
                                .font(.caption.bold())
                                .foregroundStyle(member.type == .agent ? .purple : .blue)
                        }

                        // Name
                        Text(member.name)
                            .font(.subheadline)

                        // Role badge
                        if let role = member.role {
                            if role == "owner" {
                                Text(L.owner)
                                    .font(.caption2)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Color.orange, in: Capsule())
                            } else if role == "admin" {
                                Text(L.admin)
                                    .font(.caption2)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Color.blue, in: Capsule())
                            }
                        }

                        Spacer()

                        // Remove button (owner/admin can remove non-owner members)
                        if canManage && member.id != currentUserId && member.role != "owner" {
                            if myRole == "owner" || member.role != "admin" {
                                Button {
                                    removeMember(member)
                                } label: {
                                    Image(systemName: "minus.circle")
                                        .foregroundStyle(.red)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)

            Divider()

            // Error + leave button
            VStack(spacing: 8) {
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if myRole != "owner" {
                    Button(L.leaveGroup) {
                        leaveGroup()
                    }
                    .foregroundStyle(.red)
                }
            }
            .padding()
        }
        .frame(width: 400, height: 520)
        .onAppear {
            groupTitle = conversation.title ?? ""
            members = conversation.participants
            // Only fetch from server if local data is missing role info
            if members.isEmpty || members.contains(where: { $0.role == nil }) {
                loadMembers()
            }
        }
        .sheet(isPresented: $showInviteSheet) {
            InviteMembersSheet(
                contactService: contactService,
                chatService: chatService,
                existingConversationId: conversation.id
            )
            .onDisappear { loadMembers() }
        }
    }

    private func loadMembers() {
        isLoading = true
        Task {
            do {
                members = try await appState.api?.getMembers(conversationId: conversation.id) ?? []
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func saveTitle() {
        isSavingTitle = true
        errorMessage = nil
        Task {
            do {
                _ = try await appState.api?.updateConversation(id: conversation.id, title: groupTitle)
                // Refresh conversation list
                await chatService.loadConversations()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSavingTitle = false
        }
    }

    private func removeMember(_ member: Participant) {
        errorMessage = nil
        Task {
            do {
                try await appState.api?.removeMember(conversationId: conversation.id, memberId: member.id)
                loadMembers()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func leaveGroup() {
        guard let userId = currentUserId else { return }
        errorMessage = nil
        Task {
            do {
                try await appState.api?.removeMember(conversationId: conversation.id, memberId: userId)
                await chatService.loadConversations()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
