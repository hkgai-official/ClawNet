import SwiftUI

/// Main chat interface after login — navigation bar + sidebar panel + chat detail.
struct ChatContainerView: View {
    @Environment(AppState.self) private var appState
    @State var chatService: ChatService
    @State var contactService: ContactService
    @State var agentService: AgentService

    @State private var showNewChatDialog = false

    var body: some View {
        @Bindable var appState = appState

        HStack(spacing: 0) {
            // Left navigation icon bar (WeChat-style)
            NavigationIconBar(
                activePanel: $appState.activePanel,
                pendingRequestCount: contactService.pendingRequestCount,
                auditUnreadCount: appState.auditService.unreadCount
            )

            // Sidebar panel
            sidebarContent
                .frame(width: 280)
                .background(SDColor.bgWhite)

            // Divider between sidebar and detail
            Rectangle()
                .fill(SDColor.borderLight)
                .frame(width: 1)

            // Main detail area — driven by detailDestination
            detailContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(SDColor.bgPrimary)
        }
        .sheet(isPresented: $showNewChatDialog) {
            NewChatSheet(
                contactService: contactService,
                chatService: chatService,
                onCreated: { conversationId in
                    showNewChatDialog = false
                    appState.activePanel = .chat
                    appState.detailDestination = .chat
                    Task { await chatService.selectConversation(conversationId) }
                }
            )
        }
        .task {
            if let api = appState.api {
                contactService.configure(api: api)
                agentService.configure(api: api)
                appState.auditService.configure(api: api)
            }
            chatService.contactService = contactService
            chatService.agentService = agentService
            chatService.auditService = appState.auditService
            await chatService.loadConversations()
            await contactService.loadContacts()
            await contactService.loadFriendRequests()
            await agentService.loadDialogs()
        }
    }

    // MARK: - Sidebar Content

    @ViewBuilder
    private var sidebarContent: some View {
        switch appState.activePanel {
        case .chat:
            VStack(spacing: 0) {
                // Sidebar header with title and "+" button only (Agent dialog button removed)
                HStack {
                    Text(L.messages)
                        .font(SDFont.title)
                        .foregroundStyle(SDColor.textPrimary)
                    Spacer()
                    Button(action: { showNewChatDialog = true }) {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(SDColor.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(SDColor.bgHover, in: RoundedRectangle(cornerRadius: SDRadius.md))
                    }
                    .buttonStyle(.plain)
                    .help(L.newConversation)
                }
                .padding(.horizontal, SDSpacing.lg)
                .padding(.top, SDSpacing.lg)
                .padding(.bottom, SDSpacing.md)

                ConversationListView(
                    selectedId: Binding(
                        get: { chatService.activeConversationId },
                        set: { id in
                            if let id {
                                appState.detailDestination = .chat
                                Task { await chatService.selectConversation(id) }
                            }
                        }
                    ),
                    conversations: chatService.conversations,
                    isLoading: chatService.isLoadingConversations,
                    onRefresh: { await chatService.loadConversations() },
                    onDelete: { id in
                        try? await chatService.removeConversation(id)
                    }
                )
            }
        case .contacts:
            ContactsPanel(
                contactService: contactService,
                onSelectContact: { contactId in
                    appState.detailDestination = .contactDetail(contactId)
                },
                onStartChat: { contactId in
                    handleStartChatFromContacts(contactId: contactId)
                }
            )
        case .agents:
            AgentListView(agentService: agentService)
        case .security:
            SecurityEventCenter(auditService: appState.auditService)
        case .settings:
            SettingsSidebarPanel(
                chatService: chatService,
                selectedPage: Binding(
                    get: {
                        if case .settingsDetail(let page) = appState.detailDestination { return page }
                        return .profile
                    },
                    set: { appState.detailDestination = .settingsDetail($0) }
                )
            )
        }
    }

    // MARK: - Detail Content (unified routing)

    @ViewBuilder
    private var detailContent: some View {
        switch appState.detailDestination {
        case .chat:
            if chatService.activeConversationId != nil {
                ChatDetailView(chatService: chatService, agentService: agentService, contactService: contactService)
            } else {
                DetailEmptyState(
                    icon: "bubble.left.and.text.bubble.right",
                    title: L.selectConversation,
                    subtitle: L.selectFromSidebar
                )
            }
        case .contactDetail(let contactId):
            ContactDetailView(
                contactId: contactId,
                contactService: contactService,
                tagService: appState.tagService,
                onStartChat: { handleStartChatFromContacts(contactId: contactId) }
            )
        case .settingsDetail(let page):
            SettingsDetailView(page: page, chatService: chatService)
        case .none:
            DetailEmptyState(
                icon: "hand.point.left",
                title: L.pleaseSelectFromSidebar,
                subtitle: nil
            )
        }
    }

    // MARK: - Actions

    private func handleStartChatFromContacts(contactId: String) {
        let isAgent = contactService.contacts.first(where: { $0.id == contactId })?.type == .agent

        // For human contacts, reuse existing conversation if one exists
        if !isAgent {
            if let existing = chatService.conversations.first(where: { conv in
                conv.type == .direct && conv.participants.contains(where: { $0.id == contactId })
            }) {
                appState.activePanel = .chat
                appState.detailDestination = .chat
                Task { await chatService.selectConversation(existing.id) }
                return
            }
        }

        appState.activePanel = .chat
        appState.detailDestination = .chat
        Task {
            do {
                if isAgent {
                    // Agent: always create a new conversation (fresh session)
                    let conv = try await chatService.createConversation(participantIds: [contactId], title: nil)
                    await chatService.selectConversation(conv.id)
                } else {
                    let conv = try await chatService.findOrCreateDirectConversation(contactId: contactId)
                    await chatService.selectConversation(conv.id)
                }
            } catch {
                // Will be handled by UI error display
            }
        }
    }
}

// MARK: - Detail Empty State

struct DetailEmptyState: View {
    let icon: String
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(spacing: SDSpacing.lg) {
            ZStack {
                Circle()
                    .fill(SDColor.bgSecondary)
                    .frame(width: 80, height: 80)
                Image(systemName: icon)
                    .font(.system(size: 32))
                    .foregroundStyle(SDColor.textDisabled)
            }
            Text(title)
                .font(SDFont.subtitle)
                .foregroundStyle(SDColor.textSecondary)
            if let subtitle {
                Text(subtitle)
                    .font(SDFont.body)
                    .foregroundStyle(SDColor.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Navigation Icon Bar

/// Vertical icon bar on the far left — WeChat-style compact navigation.
/// Agent tab is hidden per requirement.
struct NavigationIconBar: View {
    @Binding var activePanel: AppState.ActivePanel
    let pendingRequestCount: Int
    var auditUnreadCount: Int = 0

    private struct NavItem: Identifiable {
        let id: AppState.ActivePanel
        let icon: String
        let label: String
    }

    private var items: [NavItem] {
        [
            .init(id: .chat, icon: "message.fill", label: L.chat),
            .init(id: .contacts, icon: "person.2.fill", label: L.contacts),
            .init(id: .security, icon: "shield.lefthalf.filled", label: L.securityEvents),
            .init(id: .settings, icon: "gearshape.fill", label: L.settings),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: SDSpacing.xl)

            VStack(spacing: SDSpacing.xs) {
                ForEach(items) { item in
                    navButton(item: item)
                }
            }

            Spacer()
        }
        .frame(width: 56)
        .background(SDColor.navBarBg)
    }

    private func navButton(item: NavItem) -> some View {
        let isActive = activePanel == item.id
        let badgeCount: Int = switch item.id {
        case .contacts: pendingRequestCount
        case .security: auditUnreadCount
        default: 0
        }

        return Button(action: { activePanel = item.id }) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: item.icon)
                    .font(.system(size: 20))
                    .frame(width: 40, height: 40)
                    .foregroundStyle(isActive ? SDColor.primary : SDColor.textSecondary)
                    .background(
                        isActive ? SDColor.primaryLight : Color.clear,
                        in: RoundedRectangle(cornerRadius: SDRadius.md)
                    )

                if badgeCount > 0 {
                    Text("\(badgeCount)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(SDColor.error, in: Capsule())
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .help(item.label)
    }
}

// MARK: - New Chat Sheet (with dedup)

struct NewChatSheet: View {
    @Environment(AppState.self) private var appState
    @Bindable var contactService: ContactService
    let chatService: ChatService
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var selectedContactId: String?
    @State private var conversationTitle: String = ""
    @State private var showCreateGroup = false

    /// Whether the currently selected contact is an AI agent.
    private var selectedIsAgent: Bool {
        guard let id = selectedContactId else { return false }
        return contactService.contacts.first(where: { $0.id == id })?.type == .agent
    }

    var body: some View {
        VStack(spacing: SDSpacing.xl) {
            Text(L.newConversation)
                .font(SDFont.title)
                .foregroundStyle(SDColor.textPrimary)

            if contactService.contacts.isEmpty {
                VStack(spacing: SDSpacing.md) {
                    ZStack {
                        Circle()
                            .fill(SDColor.bgSecondary)
                            .frame(width: 48, height: 48)
                        Image(systemName: "person.slash")
                            .font(.system(size: 20))
                            .foregroundStyle(SDColor.textDisabled)
                    }
                    Text(L.noContactsAddFirst)
                        .font(SDFont.body)
                        .foregroundStyle(SDColor.textSecondary)
                }
                .frame(height: 200)
            } else {
                List(contactService.contacts, selection: $selectedContactId) { contact in
                    HStack(spacing: SDSpacing.lg) {
                        AvatarWithBadge(
                            name: contact.displayName,
                            type: contact.type == .agent ? .agent : .human,
                            size: 36
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: SDSpacing.xs) {
                                Text(contact.displayName)
                                    .font(SDFont.subtitle)
                                    .foregroundStyle(SDColor.textPrimary)
                                if contact.type == .agent {
                                    Text("AI")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(SDColor.agentPrimary)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 1)
                                        .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                                }
                            }
                        }
                    }
                    .tag(contact.id)
                }
                .listStyle(.inset)
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.md))
            }

            // Optional title input for agent conversations
            if selectedIsAgent {
                VStack(alignment: .leading, spacing: SDSpacing.xs) {
                    Text(L.conversationTitleOptional)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textSecondary)
                    TextField(L.conversationTitlePlaceholder, text: $conversationTitle)
                        .textFieldStyle(.roundedBorder)
                        .font(SDFont.body)
                }
            }

            HStack {
                Button(L.cancel) { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(SDColor.textSecondary)
                    .padding(.horizontal, SDSpacing.xl)
                    .padding(.vertical, SDSpacing.md)
                    .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))

                Button(L.createGroup) { showCreateGroup = true }
                    .buttonStyle(.plain)
                    .foregroundStyle(SDColor.primary)
                    .padding(.horizontal, SDSpacing.xl)
                    .padding(.vertical, SDSpacing.md)
                    .background(SDColor.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: SDRadius.md))

                Spacer()

                Button(L.create) {
                    guard let contactId = selectedContactId else { return }
                    Task {
                        do {
                            if selectedIsAgent {
                                // Agent: always create a new conversation (no dedup)
                                let title = conversationTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                                let conv = try await chatService.createConversation(
                                    participantIds: [contactId],
                                    title: title.isEmpty ? nil : title
                                )
                                onCreated(conv.id)
                            } else {
                                // Human: reuse existing conversation if one exists
                                let conv = try await chatService.findOrCreateDirectConversation(contactId: contactId)
                                onCreated(conv.id)
                            }
                        } catch {
                            // Error handling
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .padding(.horizontal, SDSpacing.xxl)
                .padding(.vertical, SDSpacing.md)
                .background(
                    selectedContactId != nil ? SDColor.primary : SDColor.textDisabled,
                    in: RoundedRectangle(cornerRadius: SDRadius.md)
                )
                .disabled(selectedContactId == nil)
            }
        }
        .padding(SDSpacing.xxl)
        .frame(width: 420)
        .onChange(of: selectedContactId) { _, _ in
            conversationTitle = ""
        }
        .sheet(isPresented: $showCreateGroup) {
            InviteMembersSheet(
                contactService: contactService,
                chatService: chatService
            )
            .environment(appState)
            .onDisappear {
                // 群聊创建后刷新会话列表并关闭 NewChatSheet
                Task {
                    await chatService.loadConversations()
                    if let newest = chatService.conversations.first(where: { $0.type == .group }) {
                        onCreated(newest.id)
                    }
                }
            }
        }
    }
}

// MARK: - Chat Detail View

/// The detail pane: header + status bar + message list + input bar.
struct ChatDetailView: View {
    @Environment(AppState.self) private var appState
    @Bindable var chatService: ChatService
    @Bindable var agentService: AgentService
    @Bindable var contactService: ContactService
    @State private var inputText = ""
    @State private var errorMessage: String?
    @State private var showGlobalSearch = false
    @State private var showGroupDetail = false

    var body: some View {
        VStack(spacing: 0) {
            // Chat header bar — pass currentUserId for correct "other" participant
            if let conv = activeConversation {
                ChatHeaderBar(
                    conversation: conv,
                    currentUserId: currentUser?.id ?? "",
                    connectionStatus: appState.connectionStatus,
                    dialogSession: activeDialogSession,
                    onSearch: { showGlobalSearch = true },
                    onGroupDetail: conv.type == .group ? { showGroupDetail = true } : nil
                )
                Rectangle()
                    .fill(SDColor.borderLight)
                    .frame(height: 1)
            }

            StatusBarView(
                connectionStatus: appState.connectionStatus,
                isStreaming: chatService.isStreaming,
                needsManualReconnect: appState.connectionManager.needsManualReconnect,
                lastError: appState.connectionManager.lastError,
                onReconnect: {
                    Task { await appState.manualReconnect(chatService: chatService) }
                }
            )

            MessageListView(
                messages: chatService.activeMessages,
                streamingContent: chatService.currentStreamingContent,
                isLoading: chatService.isLoadingMessages,
                currentUserId: currentUser?.id ?? "",
                isAgentDialog: isAgentDialog,
                activeRunId: chatService.activeRunId,
                streamingSender: chatService.currentStreamingSender,
                onDialogApprove: { sessionId in
                    Task { await chatService.approveDialogSession(sessionId: sessionId) }
                },
                onDialogReject: { sessionId in
                    Task { await chatService.rejectDialogSession(sessionId: sessionId) }
                },
                onDiscoveryConfirm: { taskId in
                    Task { await chatService.confirmDiscoveryTask(taskId: taskId) }
                },
                onDiscoveryCancel: { taskId in
                    Task { await chatService.cancelDiscoveryTask(taskId: taskId) }
                },
                onIntentAuthorize: { authId in
                    Task { await chatService.authorizeDialogIntent(authorizationId: authId, approved: true) }
                },
                onIntentDeny: { authId in
                    Task { await chatService.authorizeDialogIntent(authorizationId: authId, approved: false) }
                }
            )

            Rectangle()
                .fill(SDColor.borderLight)
                .frame(height: 1)

            if let convId = chatService.activeConversationId,
               let session = agentService.dialogForConversation(convId) {
                AgentDialogControlBar(session: session, agentService: agentService)
                Rectangle()
                    .fill(SDColor.borderLight)
                    .frame(height: 1)
            }

            if let errorMessage {
                HStack(spacing: SDSpacing.md) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(SDColor.warning)
                    Text(errorMessage)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textSecondary)
                    Spacer()
                    Button(L.close) { self.errorMessage = nil }
                        .buttonStyle(.plain)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textTertiary)
                }
                .padding(.horizontal, SDSpacing.xl)
                .padding(.vertical, SDSpacing.xs)
                .background(SDColor.error.opacity(0.08))
                Rectangle()
                    .fill(SDColor.borderLight)
                    .frame(height: 1)
            }

            if isAgentDialog {
                if let review = chatService.pendingReview,
                   review.conversationId == chatService.activeConversationId {
                    A2AReviewPanel(
                        review: review,
                        onRequestMain: { await chatService.requestMainDraft() },
                        onRefine: { target, instruction in
                            await chatService.refineDraft(target: target, instruction: instruction)
                        },
                        onSubmit: { await chatService.submitReviewedResponse() }
                    )
                    .frame(maxHeight: 400)
                } else if activeDialogSession?.status == .active {
                    HStack {
                        Spacer()
                        ProgressView().scaleEffect(0.7)
                        Text(L.waitingForReply)
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textSecondary)
                        Spacer()
                    }
                    .padding(.vertical, SDSpacing.lg)
                    .background(SDColor.bgWhite)
                } else {
                    HStack {
                        Spacer()
                        Image(systemName: "eye")
                            .font(.system(size: 13))
                            .foregroundStyle(SDColor.textTertiary)
                        Text(L.spectatorMode)
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textSecondary)
                        Spacer()
                    }
                    .padding(.vertical, SDSpacing.lg)
                    .background(SDColor.bgWhite)
                }
            } else {
                ChatInputBar(
                    text: $inputText,
                    isStreaming: chatService.isStreaming,
                    onSend: sendMessage,
                    onStop: stopGeneration,
                    onAttachFile: sendFiles
                )
            }
        }
        .background(SDColor.bgWhite)
        .task(id: chatService.activeConversationId) {
            // Ensure dialog session is loaded for A2A conversations
            if isAgentDialog, let convId = chatService.activeConversationId,
               agentService.dialogForConversation(convId) == nil {
                await agentService.ensureDialogForConversation(convId)
            }
        }
        .sheet(isPresented: $showGlobalSearch) {
            GlobalSearchView(
                chatService: chatService,
                onSelectResult: { conversationId in
                    Task { await chatService.selectConversation(conversationId) }
                }
            )
        }
        .sheet(isPresented: $showGroupDetail) {
            if let conv = activeConversation {
                GroupDetailView(
                    conversation: conv,
                    chatService: chatService,
                    contactService: contactService
                )
                .environment(appState)
            }
        }
    }

    private var currentUser: UserInfo? {
        if case .loggedIn(let user) = appState.authState { return user }
        return nil
    }

    private var activeConversation: Conversation? {
        guard let id = chatService.activeConversationId else { return nil }
        return chatService.conversations.first(where: { $0.id == id })
    }

    private var isAgentDialog: Bool {
        activeConversation?.type == .agentTask
    }

    private var activeDialogSession: DialogSession? {
        guard let convId = chatService.activeConversationId else { return nil }
        return agentService.dialogForConversation(convId)
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        errorMessage = nil

        Task {
            do {
                try await chatService.sendMessage(text)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func stopGeneration() {
        Task {
            try? await chatService.abortCurrentRun()
        }
    }

    private func sendFiles(_ urls: [URL]) {
        errorMessage = nil
        for url in urls {
            Task {
                do {
                    try await chatService.sendMediaMessage(fileURL: url)
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Chat Header Bar (fixed: excludes currentUserId)

/// Header bar showing conversation info: avatar, name, type badge, status.
struct ChatHeaderBar: View {
    let conversation: Conversation
    let currentUserId: String
    let connectionStatus: AppState.ConnectionStatus
    var dialogSession: DialogSession?
    var onSearch: (() -> Void)?
    var onGroupDetail: (() -> Void)?

    private var isAgentDialog: Bool {
        conversation.type == .agentTask
    }

    private var otherParticipant: Participant? {
        guard conversation.type == .direct else { return nil }
        return conversation.participants.first(where: { $0.id != currentUserId })
    }

    private var isAgentConversation: Bool {
        otherParticipant?.type == .agent
    }

    var body: some View {
        HStack(spacing: SDSpacing.lg) {
            AvatarWithBadge(
                name: displayName,
                type: (isAgentConversation || isAgentDialog) ? .agent : (conversation.type == .group ? nil : .human),
                size: 36
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: SDSpacing.xs) {
                    if conversation.type == .group, let onGroupDetail {
                        Button(action: onGroupDetail) {
                            Text(displayName)
                                .font(SDFont.subtitle)
                                .foregroundStyle(SDColor.textPrimary)
                                .lineLimit(1)
                        }
                        .buttonStyle(.plain)
                        .help(L.viewGroupDetail)
                    } else {
                        Text(displayName)
                            .font(SDFont.subtitle)
                            .foregroundStyle(SDColor.textPrimary)
                            .lineLimit(1)
                    }
                    if isAgentDialog {
                        Text("A↔A")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(SDColor.agentPrimary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                    } else if isAgentConversation {
                        Text("AI")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SDColor.agentPrimary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                    }
                }
                Text(statusText)
                    .font(SDFont.small)
                    .foregroundStyle(SDColor.textTertiary)
            }

            Spacer()

            if let onSearch {
                Button(action: onSearch) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14))
                        .foregroundStyle(SDColor.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(SDColor.bgHover, in: RoundedRectangle(cornerRadius: SDRadius.md))
                }
                .buttonStyle(.plain)
                .help(L.searchMessages)
            }
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.md)
        .background(SDColor.bgWhite)
    }

    private var displayName: String {
        if isAgentDialog, let session = dialogSession {
            let initiator = "\(session.initiatorOwner.displayName)的\(session.initiatorAgent.displayName)助手"
            let responder = "\(session.responderOwner.displayName)的\(session.responderAgent.displayName)助手"
            return "\(initiator) ↔ \(responder)"
        }
        if let name = otherParticipant?.name, !name.isEmpty { return name }
        if conversation.type == .group {
            return "\(conversation.title ?? L.groups) (\(conversation.participants.count))"
        }
        return conversation.title ?? L.unnamed
    }

    private var statusText: String {
        if isAgentDialog, let session = dialogSession {
            let topicPreview = session.topic.prefix(30)
            let ellipsis = session.topic.count > 30 ? "..." : ""
            return "Agent 对话 · \(topicPreview)\(ellipsis)"
        }
        if isAgentConversation {
            return connectionStatus == .connected ? L.online : L.offline
        }
        if conversation.type == .group {
            return L.members(conversation.participants.count)
        }
        return L.online
    }
}
