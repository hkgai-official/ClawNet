import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @State private var chatService = ChatService()
    @State private var contactService = ContactService()
    @State private var agentService = AgentService()
    @State private var isRestoringSession = true

    var body: some View {
        Group {
            if isRestoringSession {
                // Session restore splash
                VStack(spacing: SDSpacing.xl) {
                    ZStack {
                        Circle()
                            .fill(SDColor.primary.opacity(0.12))
                            .frame(width: 64, height: 64)
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 26))
                            .foregroundStyle(SDColor.primary)
                    }
                    ProgressView()
                        .controlSize(.regular)
                    Text(L.restoringSession)
                        .font(SDFont.body)
                        .foregroundStyle(SDColor.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(SDColor.bgPrimary)
            } else {
                switch appState.authState {
                case .loggedOut, .loggingIn:
                    LoginView(chatService: chatService)
                case .loggedIn:
                    ChatContainerView(chatService: chatService, contactService: contactService, agentService: agentService)
                }
            }
        }
        .frame(minWidth: 700, minHeight: 500)
        .task {
            appState.chatService = chatService
            appState.agentService = agentService
            let restored = await appState.restoreSession(chatService: chatService)
            if restored, case .loggedIn(let user) = appState.authState {
                chatService.currentUser = user
            }
            isRestoringSession = false
        }
    }
}
