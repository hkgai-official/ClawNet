import Foundation
import Observation
import OSLog

/// Root application state, injected as environment into all views.
@MainActor @Observable
final class AppState {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "app-state")

    var authState: AuthState = .loggedOut
    var connectionStatus: ConnectionStatus = .disconnected
    var activePanel: ActivePanel = .chat {
        didSet { syncDetailDestination() }
    }
    var detailDestination: DetailDestination = .none

    enum ActivePanel: String, CaseIterable {
        case chat
        case contacts
        case agents
        case security
        case settings
    }

    /// What the right-side detail area should display.
    enum DetailDestination: Equatable {
        case none
        case chat
        case contactDetail(String)
        case settingsDetail(SettingsPage)

        enum SettingsPage: String, CaseIterable, Identifiable {
            case profile
            case general
            // case connection
            case security
            case tags

            var id: String { rawValue }

            var displayName: String {
                switch self {
                case .profile: L.profile
                case .general: L.general
                case .security: L.security
                case .tags: L.tags
                }
            }

            var icon: String {
                switch self {
                case .profile: "person.circle"
                case .general: "gear"
                // case .connection: "network"
                case .security: "lock.shield"
                case .tags: "tag"
                }
            }
        }
    }

    /// Sync detail destination when active panel changes.
    private func syncDetailDestination() {
        switch activePanel {
        case .chat:
            detailDestination = .chat
        case .contacts:
            detailDestination = .none
        case .settings:
            detailDestination = .settingsDetail(.profile)
        case .agents:
            detailDestination = .none
        case .security:
            detailDestination = .none
        }
    }

    let connectionManager = ConnectionManager()
    let notificationService = NotificationService()
    let tagService = TagService()
    let auditService = AuditService()

    /// AuthManager instance (created at login, persisted across session restore).
    private(set) var authManager: AuthManager?
    private(set) var api: ClawNetAPI?

    /// Weak reference to ChatService so Settings can trigger reconnect.
    weak var chatService: ChatService?

    /// Weak reference to AgentService so Settings (TagManagement) can auto-create agents.
    weak var agentService: AgentService?

    /// The current server URL string (from AuthManager or credential store).
    var currentServerURL: String {
        authManager?.serverBaseURL.absoluteString
            ?? CredentialStore.load(key: CredentialStore.Keys.serverURL.rawValue)
            ?? ""
    }

    enum AuthState: Equatable {
        case loggedOut
        case loggingIn
        case loggedIn(user: UserInfo)
    }

    enum ConnectionStatus: Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting
    }

    // MARK: - Login & Connect

    func loginAndConnect(
        serverURL: URL,
        username: String,
        password: String,
        chatService: ChatService
    ) async throws -> UserInfo {
        let auth = AuthManager(serverBaseURL: serverURL)
        let user = try await auth.login(username: username, password: password)
        self.authManager = auth

        // Gateway connection failure should not block login.
        // The user is authenticated — show the main UI and surface
        // gateway errors via connectionStatus / connectionManager.
        do {
            try await connectWithAuth(auth: auth, chatService: chatService)
        } catch {
            logger.error("Gateway connection failed after login: \(error.localizedDescription, privacy: .public)")
            connectionStatus = .disconnected
            connectionManager.configure(
                chatService: chatService,
                serverURL: auth.serverBaseURL,
                accessToken: auth.accessToken ?? "",
                authManager: auth
            )
            connectionManager.lastError = error.localizedDescription
        }
        return user
    }

    /// Restore session from credential store (called on app launch).
    func restoreSession(chatService: ChatService) async -> Bool {
        guard let savedURL = CredentialStore.load(key: CredentialStore.Keys.serverURL.rawValue),
              let url = URL(string: savedURL)
        else { return false }

        // If cached server URL differs from current default, clear stale credentials
        // and force re-login to the correct server.
        if savedURL != ServerConfig.defaultServerURL {
            CredentialStore.deleteAll()
            return false
        }

        let auth = AuthManager(serverBaseURL: url)
        guard auth.isAuthenticated else { return false }

        self.authManager = auth

        // Ensure access token is still valid before connecting.
        // If refresh also fails (e.g. refresh_token expired after 7 days),
        // clear credentials and send user back to login.
        do {
            try await auth.ensureValidAccessToken()
        } catch {
            logger.warning("Session restore: token refresh failed, returning to login")
            auth.logout()
            self.authManager = nil
            return false
        }

        // Token is valid — establish connections.
        // Network issues should not block session restore.
        do {
            try await connectWithAuth(auth: auth, chatService: chatService)
        } catch {
            logger.warning("Session restore: connection failed: \(error.localizedDescription)")
            connectionStatus = .disconnected
            connectionManager.configure(
                chatService: chatService,
                serverURL: auth.serverBaseURL,
                accessToken: auth.accessToken ?? "",
                authManager: auth
            )
            connectionManager.lastError = error.localizedDescription
            connectionManager.scheduleReconnect()
        }

        // Fetch real user info from server
        let user: UserInfo
        if let api = self.api {
            do {
                user = try await api.getCurrentUser()
            } catch {
                logger.warning("Session restore: failed to fetch user info: \(error.localizedDescription)")
                user = UserInfo(id: "restored", username: "user", displayName: nil)
            }
        } else {
            user = UserInfo(id: "restored", username: "user", displayName: nil)
        }

        authState = .loggedIn(user: user)
        logger.info("Session restored from credential store")
        return true
    }

    private func connectWithAuth(auth: AuthManager, chatService: ChatService) async throws {
        // Ensure access token is valid before any network call
        let validToken = try await auth.ensureValidAccessToken()

        let api = ClawNetAPI(
            baseURL: auth.serverBaseURL,
            getAccessToken: { [weak auth] in await auth?.accessToken },
            onUnauthorized: { [weak auth] in
                guard let auth else { return false }
                return (try? await auth.refreshAccessToken()) ?? false
            }
        )
        self.api = api
        chatService.configure(api: api)

        // Wire up disconnect callback so ConnectionManager can auto-reconnect
        chatService.onDisconnect = { [weak self] reason in
            self?.connectionStatus = .disconnected
            self?.connectionManager.handleDisconnect(reason: reason)
        }

        // Auto-recover: any received server message proves the connection is alive
        chatService.onConnectionRecovered = { [weak self] in
            guard let self, self.connectionStatus != .connected else { return }
            self.logger.info("Connection auto-recovered — server message received")
            self.connectionStatus = .connected
            self.connectionManager.cancelReconnect()
        }

        // Wire LanguageManager so it can sync language preference to the server.
        LanguageManager.shared.apiProvider = { [weak self] in self?.api }

        // Sync file access settings from server BEFORE connecting WebSocket,
        // so node.capabilities sends the latest server-authoritative fileAccess.
        let nodeHandler = chatService.nodeEventHandler
        nodeHandler.policy.apiProvider = { [weak self] in self?.api }
        await nodeHandler.policy.syncFromServer(api: api)

        // Connect WebSocket with a verified-valid token
        try await chatService.connect(serverURL: auth.serverBaseURL, accessToken: validToken)

        connectionStatus = .connected

        // Configure ConnectionManager so it can auto-reconnect with token refresh
        connectionManager.configure(
            chatService: chatService,
            serverURL: auth.serverBaseURL,
            accessToken: validToken,
            authManager: auth
        )

        // Sync AppState.connectionStatus when ConnectionManager reconnects
        connectionManager.onReconnected = { [weak self] in
            self?.connectionStatus = .connected
        }

        // Configure and load tags
        tagService.configure(api: api)
        await tagService.loadTags()
    }

    // MARK: - Logout

    func logout(chatService: ChatService) async {
        await chatService.disconnect()
        // Revoke tokens on server before clearing local state
        if let authManager {
            await authManager.serverLogout()
        }
        authManager = nil
        api = nil
        authState = .loggedOut
        connectionStatus = .disconnected
    }

    // MARK: - Manual Reconnect

    func manualReconnect(chatService: ChatService) async {
        guard let authManager else { return }
        connectionStatus = .connecting
        connectionManager.resetReconnectAttempts()
        do {
            try await connectWithAuth(auth: authManager, chatService: chatService)
        } catch {
            connectionStatus = .disconnected
            logger.error("Manual reconnect failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Server URL Update

    /// Updates the server URL and reconnects. Preserves existing auth tokens.
    func updateServerURL(_ newURL: URL) async throws {
        guard let authManager else {
            throw AuthError.notAuthenticated
        }
        guard let chatService else {
            throw AuthError.notAuthenticated
        }

        let oldURL = authManager.serverBaseURL

        // Disconnect current connection
        await chatService.disconnect()
        connectionStatus = .disconnected

        // Update the URL on AuthManager and save to credential store
        authManager.updateServerURL(newURL)

        // Try to reconnect with the new URL
        connectionStatus = .connecting
        do {
            try await connectWithAuth(auth: authManager, chatService: chatService)
            logger.info("Reconnected with new server URL: \(newURL.absoluteString, privacy: .public)")
        } catch {
            // Rollback to old URL on failure
            logger.error("Reconnect with new URL failed, rolling back: \(error.localizedDescription, privacy: .public)")
            authManager.updateServerURL(oldURL)
            connectionStatus = .disconnected
            throw error
        }
    }
}

struct UserInfo: Equatable, Codable, Sendable {
    let id: String
    let username: String
    var displayName: String?
    var userCode: String? = nil
    var email: String? = nil
}
