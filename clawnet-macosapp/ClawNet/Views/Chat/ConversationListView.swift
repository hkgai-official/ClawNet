import SwiftUI

/// Conversation type filter matching Web's ConversationFilter.
enum ConversationFilter: String, CaseIterable {
    case all, people, agents, agentDialogs, groups

    var displayName: String {
        switch self {
        case .all: L.allMessages
        case .people: L.people
        case .agents: L.myAgents
        case .agentDialogs: L.agentDialogs
        case .groups: L.groups
        }
    }

    var icon: String {
        switch self {
        case .all: "message"
        case .people: "person"
        case .agents: "cpu"
        case .agentDialogs: "bolt"
        case .groups: "person.3"
        }
    }

    var color: Color {
        switch self {
        case .all: SDColor.primary
        case .people: Color(hex: 0x1890FF)
        case .agents: SDColor.agentPrimary
        case .agentDialogs: Color(hex: 0xFAAD14)
        case .groups: Color(hex: 0xFF6B6B)
        }
    }
}

/// Sidebar showing the list of conversations with search, filter, and context menu.
struct ConversationListView: View {
    @Binding var selectedId: String?
    let conversations: [Conversation]
    let isLoading: Bool
    let onRefresh: () async -> Void
    var onDelete: ((String) async -> Void)?

    @State private var searchText = ""
    @State private var filter: ConversationFilter = .all
    @State private var confirmingDelete: String?

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: SDSpacing.md) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(SDColor.textTertiary)
                TextField(L.search, text: $searchText)
                    .textFieldStyle(.plain)
                    .font(SDFont.body)
                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(SDColor.textDisabled)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.vertical, SDSpacing.md)
            .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))
            .padding(.horizontal, SDSpacing.lg)
            .padding(.bottom, SDSpacing.md)

            // Filter dropdown (replaces horizontal chip row)
            HStack {
                Menu {
                    ForEach(ConversationFilter.allCases, id: \.self) { f in
                        Button(action: { filter = f }) {
                            Label {
                                Text(f.displayName)
                            } icon: {
                                Image(systemName: f.icon)
                            }
                        }
                    }
                } label: {
                    HStack(spacing: SDSpacing.sm) {
                        Image(systemName: filter.icon)
                            .font(.system(size: 12))
                            .foregroundStyle(filter.color)
                            .frame(width: 22, height: 22)
                            .background(
                                filter.color.opacity(0.1),
                                in: RoundedRectangle(cornerRadius: SDRadius.sm)
                            )
                        Text(filter.displayName)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(SDColor.textPrimary)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10))
                            .foregroundStyle(SDColor.textTertiary)
                    }
                    .padding(.horizontal, SDSpacing.md)
                    .padding(.vertical, SDSpacing.sm)
                    .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.bottom, SDSpacing.md)

            Rectangle()
                .fill(SDColor.divider)
                .frame(height: 1)

            // Conversation list
            if filteredConversations.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filteredConversations) { conversation in
                            ConversationRow(
                                conversation: conversation,
                                isActive: conversation.id == selectedId
                            )
                            .onTapGesture {
                                selectedId = conversation.id
                            }
                            .contextMenu {
                                Button(role: .destructive) {
                                    confirmingDelete = conversation.id
                                } label: {
                                    Label(L.deleteConversation, systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
        }
        .overlay {
            if isLoading && conversations.isEmpty {
                VStack(spacing: SDSpacing.md) {
                    ProgressView()
                        .controlSize(.regular)
                    Text(L.loading)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textTertiary)
                }
            }
        }
        .confirmationDialog(
            L.confirmDeleteConversation,
            isPresented: Binding(
                get: { confirmingDelete != nil },
                set: { if !$0 { confirmingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(L.delete, role: .destructive) {
                if let id = confirmingDelete {
                    Task { await onDelete?(id) }
                }
                confirmingDelete = nil
            }
            Button(L.cancel, role: .cancel) {
                confirmingDelete = nil
            }
        } message: {
            Text(L.chatHistoryLost)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: SDSpacing.lg) {
            Spacer()
            ZStack {
                Circle()
                    .fill(SDColor.bgSecondary)
                    .frame(width: 48, height: 48)
                Image(systemName: searchText.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass")
                    .font(.system(size: 20))
                    .foregroundStyle(SDColor.textDisabled)
            }
            Text(searchText.isEmpty ? L.noConversations : L.noMatchingConversations)
                .font(SDFont.body)
                .foregroundStyle(SDColor.textSecondary)
            if searchText.isEmpty {
                Text(L.tapPlusToStart)
                    .font(SDFont.small)
                    .foregroundStyle(SDColor.textTertiary)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var filteredConversations: [Conversation] {
        var result = conversations

        switch filter {
        case .all:
            break
        case .people:
            result = result.filter { conv in
                conv.type == .direct && conv.participants.allSatisfy { $0.type == .human }
            }
        case .agents:
            result = result.filter { conv in
                conv.type == .direct && conv.participants.contains(where: { $0.type == .agent })
            }
        case .agentDialogs:
            result = result.filter { $0.type == .agentTask }
        case .groups:
            result = result.filter { $0.type == .group }
        }

        if !searchText.isEmpty {
            let q = searchText.lowercased()
            result = result.filter { conv in
                (conv.title ?? "").lowercased().contains(q)
                || conv.participants.contains(where: { $0.name.lowercased().contains(q) })
                || (conv.lastMessagePreview?.lowercased().contains(q) ?? false)
            }
        }

        return result
    }
}

// MARK: - Filter Chip Button

private struct FilterChipButton: View {
    let filter: ConversationFilter
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: SDSpacing.sm) {
                Image(systemName: filter.icon)
                    .font(.system(size: 12))
                    .foregroundStyle(isActive ? SDColor.primary : filter.color)
                    .frame(width: 22, height: 22)
                    .background(
                        (isActive ? SDColor.primary : filter.color).opacity(0.1),
                        in: RoundedRectangle(cornerRadius: SDRadius.sm)
                    )
                Text(filter.displayName)
                    .font(.system(size: 13, weight: isActive ? .medium : .regular))
                    .foregroundStyle(isActive ? SDColor.primary : SDColor.textPrimary)
            }
            .padding(.horizontal, SDSpacing.md)
            .padding(.vertical, SDSpacing.sm)
            .background(
                isActive ? SDColor.primaryLight : SDColor.bgSecondary,
                in: RoundedRectangle(cornerRadius: SDRadius.md)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    let conversation: Conversation
    var isActive: Bool = false

    @State private var isEditingSummary = false
    @State private var editingSummaryText = ""
    @Environment(AppState.self) private var appState

    private var isAgentConversation: Bool {
        conversation.participants.contains(where: { $0.type == .agent })
    }

    private var isAgentDialog: Bool {
        conversation.type == .agentTask
    }

    private var currentUserId: String? {
        if case .loggedIn(let user) = appState.authState { return user.id }
        return nil
    }

    private var otherParticipant: Participant? {
        guard conversation.type == .direct else { return nil }
        // Exclude current user — return the OTHER participant
        return conversation.participants.first(where: {
            ($0.type == .agent || $0.type == .human) && $0.id != currentUserId
        })
    }

    private var displayName: String {
        if isAgentDialog {
            // Show only the other party's agent (current user's agent is implicit)
            let agents = conversation.participants.filter { $0.type == .agent }
            let otherAgent = agents.first(where: { $0.ownerId != currentUserId })
                ?? agents.last  // fallback
            if let agent = otherAgent {
                return agentLabel(agent)
            }
        }
        if let title = conversation.title, !title.isEmpty { return title }
        if let other = otherParticipant {
            return other.name
        }
        if conversation.type == .group {
            return L.groupChat(conversation.participants.count)
        }
        return L.unnamed
    }

    private func agentLabel(_ p: Participant) -> String {
        if let owner = p.ownerName, !owner.isEmpty {
            return "\(owner)的\(p.name)助手"
        }
        return "\(p.name)助手"
    }

    var body: some View {
        HStack(spacing: SDSpacing.lg) {
            // Active indicator
            Rectangle()
                .fill(isActive ? SDColor.primary : Color.clear)
                .frame(width: 3, height: 32)
                .clipShape(UnevenRoundedRectangle(
                    topLeadingRadius: 0, bottomLeadingRadius: 0,
                    bottomTrailingRadius: 3, topTrailingRadius: 3
                ))

            // Avatar
            AvatarWithBadge(
                name: displayName,
                type: isAgentConversation ? .agent : nil,
                size: 48,
                showAgentBadge: isAgentConversation && !isAgentDialog
            )

            // Content
            VStack(alignment: .leading, spacing: SDSpacing.xs) {
                HStack {
                    Text(displayName)
                        .font(SDFont.subtitle)
                        .foregroundStyle(SDColor.textPrimary)
                        .lineLimit(1)
                    if isAgentDialog {
                        Text("A↔A")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(SDColor.agentPrimary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                    }
                    Spacer()
                    if let date = conversation.lastMessageAt ?? conversation.updatedAt as Date? {
                        Text(relativeTimeString(date))
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textTertiary)
                    }
                }

                // Summary row (for conversations with a summary)
                if isAgentConversation, let summary = conversation.summary, !summary.isEmpty {
                    if isEditingSummary && !isAgentDialog {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .font(.system(size: 10))
                                .foregroundStyle(SDColor.textTertiary)
                            TextField("", text: $editingSummaryText)
                                .font(.system(size: 12))
                                .foregroundStyle(SDColor.textTertiary)
                                .textFieldStyle(.plain)
                                .lineLimit(1)
                                .onSubmit { saveSummary() }
                                .onExitCommand { cancelEditSummary() }
                        }
                    } else {
                        HStack(spacing: 4) {
                            if !isAgentDialog {
                                // Pencil icon only for user-agent chats (not A2A)
                                Image(systemName: "pencil")
                                    .font(.system(size: 10))
                                    .foregroundStyle(SDColor.textTertiary)
                                    .frame(width: 20, height: 20)
                                    .contentShape(Rectangle())
                                    .highPriorityGesture(TapGesture().onEnded {
                                        startEditSummary(summary)
                                    })
                            }
                            Text(summary)
                                .font(.system(size: 12))
                                .foregroundStyle(SDColor.textTertiary)
                                .lineLimit(1)
                        }
                    }
                }

                HStack {
                    Text(previewText)
                        .font(.system(size: 13))
                        .foregroundStyle(SDColor.textSecondary)
                        .lineLimit(1)
                    Spacer()
                    if conversation.unreadCount > 0 {
                        Text(conversation.unreadCount > 99 ? "99+" : "\(conversation.unreadCount)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(SDColor.error, in: Capsule())
                    }
                }
            }
        }
        .padding(.trailing, SDSpacing.xl)
        .padding(.vertical, SDSpacing.lg)
        .background(isActive ? SDColor.bgActive : Color.clear)
        .contentShape(Rectangle())
    }

    private var previewText: String {
        conversation.lastMessagePreview ?? L.noMessages
    }

    private func relativeTimeString(_ date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return L.justNow }
        if interval < 3600 { return L.minutesAgo(Int(interval / 60)) }
        if interval < 86400 { return L.hoursAgo(Int(interval / 3600)) }
        if interval < 172800 { return L.yesterday }
        if interval < 259200 { return L.dayBeforeYesterday }
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter.string(from: date)
    }

    private func startEditSummary(_ current: String) {
        editingSummaryText = current
        isEditingSummary = true
    }

    private func cancelEditSummary() {
        isEditingSummary = false
        editingSummaryText = ""
    }

    private func saveSummary() {
        let trimmed = String(editingSummaryText.prefix(20))
        isEditingSummary = false

        // Allow clearing summary (send empty string → server sets to NULL, version stays 999)
        let summaryToSave = trimmed.isEmpty ? "" : trimmed

        Task {
            do {
                _ = try await appState.api?.updateConversationSummary(
                    id: conversation.id,
                    summary: summaryToSave
                )
            } catch {
                // Silent failure — summary will revert on next refresh
            }
        }
    }
}

#Preview("Conversation List") {
    ConversationListView(
        selectedId: .constant("conv-1"),
        conversations: PreviewData.conversations,
        isLoading: false,
        onRefresh: {}
    )
    .frame(width: 280, height: 500)
}

#Preview("Empty") {
    ConversationListView(
        selectedId: .constant(nil),
        conversations: [],
        isLoading: false,
        onRefresh: {}
    )
    .frame(width: 280, height: 400)
}
