import SwiftUI

struct LoginView: View {
    @Environment(AppState.self) private var appState
    @Bindable var chatService: ChatService

    @State private var serverURL = ServerConfig.defaultServerURL
    @State private var username = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false

    @FocusState private var focusedField: Field?
    enum Field { case server, email, password }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 28) {
                // Logo / Brand
                VStack(spacing: SDSpacing.md) {
                    ZStack {
                        Circle()
                            .fill(SDColor.primary.opacity(0.12))
                            .frame(width: 72, height: 72)
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(SDColor.primary)
                    }
                    Text("ClawNet")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(SDColor.textPrimary)
                    Text(L.loginTitle)
                        .font(SDFont.body)
                        .foregroundStyle(SDColor.textSecondary)
                }

                // Form fields
                VStack(spacing: SDSpacing.lg) {
                    loginField(
                        icon: "person.crop.circle",
                        placeholder: L.idOrEmail,
                        text: $username,
                        field: .email
                    )
                    loginSecureField(
                        icon: "lock",
                        placeholder: L.password,
                        text: $password,
                        field: .password
                    )
                }

                // Error message
                if let errorMessage {
                    HStack(spacing: SDSpacing.md) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(SDColor.error)
                        Text(errorMessage)
                            .foregroundStyle(SDColor.error)
                    }
                    .font(SDFont.small)
                }

                // Login button
                Button(action: login) {
                    HStack(spacing: SDSpacing.md) {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(L.login)
                            .font(.system(size: 16, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(.white)
                    .background(
                        loginEnabled ? SDColor.primary : SDColor.textDisabled,
                        in: RoundedRectangle(cornerRadius: SDRadius.md)
                    )
                }
                .buttonStyle(.plain)
                .disabled(!loginEnabled)
                .keyboardShortcut(.defaultAction)
            }
            .frame(maxWidth: 360)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SDColor.bgPrimary)
    }

    private var loginEnabled: Bool {
        !username.isEmpty && !password.isEmpty && !isLoading
    }

    private func loginField(icon: String, placeholder: String, text: Binding<String>, field: Field) -> some View {
        HStack(spacing: SDSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(focusedField == field ? SDColor.primary : SDColor.textTertiary)
                .frame(width: 20)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(SDFont.body)
                .focused($focusedField, equals: field)
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: SDRadius.md)
                .fill(focusedField == field ? SDColor.bgWhite : SDColor.bgSecondary)
        )
        .overlay(
            RoundedRectangle(cornerRadius: SDRadius.md)
                .stroke(focusedField == field ? SDColor.primary : Color.clear, lineWidth: 1)
        )
    }

    private func loginSecureField(icon: String, placeholder: String, text: Binding<String>, field: Field) -> some View {
        HStack(spacing: SDSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(focusedField == field ? SDColor.primary : SDColor.textTertiary)
                .frame(width: 20)
            SecureField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(SDFont.body)
                .focused($focusedField, equals: field)
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: SDRadius.md)
                .fill(focusedField == field ? SDColor.bgWhite : SDColor.bgSecondary)
        )
        .overlay(
            RoundedRectangle(cornerRadius: SDRadius.md)
                .stroke(focusedField == field ? SDColor.primary : Color.clear, lineWidth: 1)
        )
    }

    private func login() {
        guard let baseURL = URL(string: serverURL) else {
            errorMessage = L.invalidServerURL
            return
        }
        isLoading = true
        errorMessage = nil
        appState.authState = .loggingIn

        Task {
            do {
                let user = try await appState.loginAndConnect(
                    serverURL: baseURL,
                    username: username,
                    password: password,
                    chatService: chatService
                )
                chatService.currentUser = user
                appState.authState = .loggedIn(user: user)
            } catch {
                errorMessage = error.localizedDescription
                appState.authState = .loggedOut
            }
            isLoading = false
        }
    }
}

#Preview {
    LoginView(chatService: ChatService())
        .environment(PreviewData.loggedOutAppState)
        .frame(width: 600, height: 500)
}
