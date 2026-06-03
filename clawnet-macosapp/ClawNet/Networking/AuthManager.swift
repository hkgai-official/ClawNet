import Foundation
import OSLog

/// Manages JWT authentication with clawnet-server and gateway token retrieval.
@MainActor @Observable
final class AuthManager {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "auth")

    var isAuthenticated: Bool { accessToken != nil }

    private(set) var accessToken: String?
    private(set) var refreshToken: String?
    private(set) var gatewayCredentials: GatewayCredentials?

    private(set) var serverBaseURL: URL

    struct GatewayCredentials: Sendable {
        let gatewayURL: String
        let gatewayToken: String
        let clientId: String
    }

    init(serverBaseURL: URL) {
        self.serverBaseURL = serverBaseURL
        self.loadTokensFromStore()
    }

    // MARK: - Register

    func register(displayName: String, email: String?, phone: String?, password: String) async throws -> UserInfo {
        let url = serverBaseURL.appendingPathComponent("api/v1/auth/register")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: String] = [
            "display_name": displayName,
            "password": password,
        ]
        if let email { body["email"] = email }
        if let phone { body["phone"] = phone }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthError.registrationFailed
        }

        let result = try JSONDecoder().decode(RegisterResponse.self, from: data)
        self.accessToken = result.data.tokens.accessToken
        self.refreshToken = result.data.tokens.refreshToken
        self.saveTokensToStore()

        let user = result.data.user
        return UserInfo(
            id: user.id,
            username: user.email ?? user.displayName,
            displayName: user.displayName,
            userCode: user.userCode,
            email: user.email
        )
    }

    // MARK: - Login

    func login(username: String, password: String) async throws -> UserInfo {
        let url = serverBaseURL.appendingPathComponent("api/v1/auth/login")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": username, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthError.loginFailed
        }

        let result = try JSONDecoder().decode(LoginResponse.self, from: data)
        self.accessToken = result.data.tokens.accessToken
        self.refreshToken = result.data.tokens.refreshToken
        self.saveTokensToStore()

        let user = result.data.user
        return UserInfo(
            id: user.id,
            username: user.email ?? user.displayName ?? user.id,
            displayName: user.displayName,
            userCode: user.userCode,
            email: user.email
        )
    }

    // MARK: - Gateway Token (Deprecated — server now proxies gateway connections)

    @available(*, deprecated, message: "Use server WebSocket connection instead of direct gateway credentials")
    func fetchGatewayCredentials() async throws -> GatewayCredentials {
        guard let token = accessToken else { throw AuthError.notAuthenticated }

        let url = serverBaseURL.appendingPathComponent("api/v1/auth/gateway-token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as? HTTPURLResponse

        // If 401, try refreshing the access token and retry
        if httpResponse?.statusCode == 401 {
            guard try await refreshAccessToken() else {
                throw AuthError.notAuthenticated
            }
            return try await fetchGatewayCredentials()
        }

        guard httpResponse?.statusCode == 200 else {
            throw AuthError.gatewayTokenFailed
        }

        let result = try JSONDecoder().decode(GatewayTokenResponse.self, from: data)
        let gatewayURL = Self.alignGatewayHost(
            gatewayURL: result.data.gatewayURL,
            serverBaseURL: serverBaseURL
        )
        logger.info("Gateway URL: \(gatewayURL, privacy: .public)")
        let credentials = GatewayCredentials(
            gatewayURL: gatewayURL,
            gatewayToken: result.data.gatewayToken,
            clientId: result.data.clientId
        )
        self.gatewayCredentials = credentials
        return credentials
    }

    /// Replace the gateway URL's host with the server URL's host so that
    /// the client always reaches the gateway via the same network path it
    /// uses for the REST API (important when connecting through SSH tunnels,
    /// VPNs, or port-forwarding).
    static func alignGatewayHost(gatewayURL: String, serverBaseURL: URL) -> String {
        guard var gatewayComponents = URLComponents(string: gatewayURL),
              let serverHost = serverBaseURL.host
        else { return gatewayURL }

        gatewayComponents.host = serverHost
        return gatewayComponents.string ?? gatewayURL
    }

    // MARK: - Token Validity

    /// Parses the JWT payload locally to extract the expiration date.
    /// Returns nil if the token is missing or malformed.
    func accessTokenExpiresAt() -> Date? {
        guard let token = accessToken else { return nil }
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }

        var base64 = String(parts[1])
        // Pad to 4-character boundary for Base64 decoding
        while base64.count % 4 != 0 { base64.append("=") }

        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? TimeInterval
        else { return nil }

        return Date(timeIntervalSince1970: exp)
    }

    /// Ensures the current access token is valid (has >5 min remaining).
    /// Refreshes proactively if about to expire. Throws if refresh also fails.
    @discardableResult
    func ensureValidAccessToken() async throws -> String {
        if let expiresAt = accessTokenExpiresAt(),
           expiresAt.timeIntervalSinceNow > 300 {
            return accessToken!
        }
        logger.info("Access token expired or expiring soon, refreshing…")
        guard try await refreshAccessToken() else {
            throw AuthError.tokenRefreshFailed
        }
        guard let token = accessToken else {
            throw AuthError.tokenRefreshFailed
        }
        return token
    }

    // MARK: - Token Refresh

    /// Attempts to refresh the access token using the refresh token.
    /// Returns true if successful, false otherwise.
    @discardableResult
    func refreshAccessToken() async throws -> Bool {
        guard let refreshToken else {
            logger.warning("No refresh token available")
            return false
        }

        let url = serverBaseURL.appendingPathComponent("api/v1/auth/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refresh_token": refreshToken])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            logger.warning("Token refresh failed, clearing session")
            self.accessToken = nil
            self.refreshToken = nil
            self.clearCredentials()
            return false
        }

        let result = try JSONDecoder().decode(RefreshResponse.self, from: data)
        self.accessToken = result.data.accessToken
        if let newRefresh = result.data.refreshToken {
            self.refreshToken = newRefresh
        }
        self.saveTokensToStore()
        logger.info("Token refreshed successfully")
        return true
    }

    // MARK: - Server URL

    /// Updates the server base URL and persists to credential store.
    func updateServerURL(_ newURL: URL) {
        self.serverBaseURL = newURL
        self.gatewayCredentials = nil
        try? CredentialStore.save(key: CredentialStore.Keys.serverURL.rawValue, value: newURL.absoluteString)
    }

    // MARK: - Change Password

    func changePassword(oldPassword: String, newPassword: String) async throws {
        let token = try await ensureValidAccessToken()
        let url = serverBaseURL.appendingPathComponent("api/v1/auth/password")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode([
            "old_password": oldPassword,
            "new_password": newPassword,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AuthError.changePasswordFailed("网络错误")
        }
        if http.statusCode != 200 {
            let msg = Self.parseErrorMessage(from: data) ?? "修改失败"
            throw AuthError.changePasswordFailed(msg)
        }
    }

    private static func parseErrorMessage(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let detail = json["detail"] as? [String: Any],
              let error = detail["error"] as? [String: Any],
              let message = error["message"] as? String
        else { return nil }
        return message
    }

    // MARK: - Logout

    /// Revoke tokens on server (best-effort, does not throw).
    func serverLogout() async {
        guard let token = accessToken else {
            logout()
            return
        }
        let url = serverBaseURL.appendingPathComponent("api/v1/auth/logout")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        _ = try? await URLSession.shared.data(for: request)
        logout()
    }

    func logout() {
        self.accessToken = nil
        self.refreshToken = nil
        self.gatewayCredentials = nil
        self.clearCredentials()
    }

    // MARK: - Credential Store

    private func loadTokensFromStore() {
        self.accessToken = CredentialStore.load(key: CredentialStore.Keys.accessToken.rawValue)
        self.refreshToken = CredentialStore.load(key: CredentialStore.Keys.refreshToken.rawValue)
        if let savedURL = CredentialStore.load(key: CredentialStore.Keys.serverURL.rawValue),
           let url = URL(string: savedURL) {
            self.serverBaseURL = url
        }
    }

    private func saveTokensToStore() {
        if let accessToken {
            try? CredentialStore.save(key: CredentialStore.Keys.accessToken.rawValue, value: accessToken)
        }
        if let refreshToken {
            try? CredentialStore.save(key: CredentialStore.Keys.refreshToken.rawValue, value: refreshToken)
        }
        try? CredentialStore.save(key: CredentialStore.Keys.serverURL.rawValue, value: serverBaseURL.absoluteString)
    }

    private func clearCredentials() {
        CredentialStore.deleteAll()
    }
}

// MARK: - Error Types

enum AuthError: LocalizedError {
    case loginFailed
    case registrationFailed
    case notAuthenticated
    case gatewayTokenFailed
    case tokenRefreshFailed
    case changePasswordFailed(String)

    var errorDescription: String? {
        switch self {
        case .loginFailed: "Login failed"
        case .registrationFailed: "Registration failed"
        case .notAuthenticated: "Not authenticated"
        case .gatewayTokenFailed: "Failed to retrieve gateway credentials"
        case .tokenRefreshFailed: "Token refresh failed"
        case .changePasswordFailed(let msg): msg
        }
    }
}

// MARK: - Response Types

private struct LoginResponse: Decodable {
    let data: LoginData
    struct LoginData: Decodable {
        let user: UserData
        let tokens: TokenData
    }
    struct UserData: Decodable {
        let id: String
        let email: String?
        let displayName: String?
        let userCode: String?

        enum CodingKeys: String, CodingKey {
            case id, email
            case displayName = "display_name"
            case userCode = "user_code"
        }
    }
    struct TokenData: Decodable {
        let accessToken: String
        let refreshToken: String

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
        }
    }
}

private struct GatewayTokenResponse: Decodable {
    let data: GatewayTokenData
    struct GatewayTokenData: Decodable {
        let gatewayURL: String
        let gatewayToken: String
        let clientId: String

        enum CodingKeys: String, CodingKey {
            case gatewayURL = "gateway_url"
            case gatewayToken = "gateway_token"
            case clientId = "client_id"
        }
    }
}

private struct RegisterResponse: Decodable {
    let data: RegisterData
    struct RegisterData: Decodable {
        let user: RegisterUserData
        let tokens: TokenData
    }
    struct RegisterUserData: Decodable {
        let id: String
        let displayName: String
        let email: String?
        let userCode: String?

        enum CodingKeys: String, CodingKey {
            case id
            case displayName = "display_name"
            case email
            case userCode = "user_code"
        }
    }
    struct TokenData: Decodable {
        let accessToken: String
        let refreshToken: String

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
        }
    }
}

private struct RefreshResponse: Decodable {
    let data: RefreshData
    struct RefreshData: Decodable {
        let accessToken: String
        let refreshToken: String?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
        }
    }
}
