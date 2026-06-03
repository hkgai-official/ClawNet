import SwiftUI

/// Mock data for SwiftUI previews.
enum PreviewData {
    static let user = UserInfo(id: "user-1", username: "alice", displayName: "Alice", userCode: "1688", email: "alice@example.com")

    static let agentParticipant = Participant(id: "agent", name: "Assistant", type: .agent)
    static let userParticipant = Participant(id: "user-1", name: "Alice", type: .human)

    static let conversations: [Conversation] = [
        Conversation(
            id: "conv-1",
            type: .direct,
            title: "Project Discussion",
            participants: [userParticipant, agentParticipant],
            lastMessagePreview: "Sure, I can help with that!",
            lastMessageAt: Date(),
            unreadCount: 2,
            createdAt: Date().addingTimeInterval(-86400),
            updatedAt: Date()
        ),
        Conversation(
            id: "conv-2",
            type: .agentTask,
            title: "Code Review",
            participants: [userParticipant, agentParticipant],
            lastMessagePreview: nil,
            lastMessageAt: nil,
            unreadCount: 0,
            createdAt: Date().addingTimeInterval(-172800),
            updatedAt: Date().addingTimeInterval(-3600)
        ),
    ]

    static let messages: [ChatMessage] = [
        ChatMessage(
            id: "msg-1",
            conversationId: "conv-1",
            sender: userParticipant,
            contentType: .text,
            content: MessageContent(text: "Can you help me refactor this code?"),
            timestamp: Date().addingTimeInterval(-120),
            status: .sent
        ),
        ChatMessage(
            id: "msg-2",
            conversationId: "conv-1",
            sender: agentParticipant,
            contentType: .text,
            content: MessageContent(text: "Of course! Let me take a look at the code structure first."),
            timestamp: Date().addingTimeInterval(-60),
            status: .sent
        ),
        ChatMessage(
            id: "msg-3",
            conversationId: "conv-1",
            sender: userParticipant,
            contentType: .text,
            content: MessageContent(text: "Great, here is the file..."),
            timestamp: Date(),
            status: .sending
        ),
    ]

    static var imageContent: MessageContent {
        var c = MessageContent()
        c.name = "screenshot.png"
        c.mimeType = "image/png"
        c.size = 256_000
        c.url = "https://via.placeholder.com/300x200"
        return c
    }

    static var fileContent: MessageContent {
        var c = MessageContent()
        c.name = "report.pdf"
        c.mimeType = "application/pdf"
        c.size = 1_280_000
        return c
    }

    static var voiceContent: MessageContent {
        var c = MessageContent()
        c.name = "voice.webm"
        c.mimeType = "audio/webm"
        c.duration = 12
        return c
    }

    static let mediaMessages: [ChatMessage] = [
        ChatMessage(id: "media-1", conversationId: "conv-1", sender: userParticipant, contentType: .image, content: imageContent, timestamp: Date().addingTimeInterval(-90), status: .sent),
        ChatMessage(id: "media-2", conversationId: "conv-1", sender: agentParticipant, contentType: .file, content: fileContent, timestamp: Date().addingTimeInterval(-60), status: .sent),
        ChatMessage(id: "media-3", conversationId: "conv-1", sender: userParticipant, contentType: .voice, content: voiceContent, timestamp: Date().addingTimeInterval(-30), status: .sent),
    ]

    @MainActor static var appState: AppState {
        let state = AppState()
        state.authState = .loggedIn(user: user)
        state.connectionStatus = .connected
        return state
    }

    @MainActor static var disconnectedAppState: AppState {
        let state = AppState()
        state.authState = .loggedIn(user: user)
        state.connectionStatus = .disconnected
        return state
    }

    @MainActor static var loggedOutAppState: AppState {
        AppState()
    }
}
