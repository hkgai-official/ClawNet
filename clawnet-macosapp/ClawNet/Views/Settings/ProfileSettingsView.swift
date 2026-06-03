import SwiftUI

/// Profile editor for user avatar, display name, email.
struct ProfileSettingsView: View {
    @Environment(AppState.self) private var appState

    @State private var displayName = ""
    @State private var email = ""
    @State private var isSaving = false
    @State private var savedMessage: String?
    @State private var isError = false
    @State private var showChangePassword = false

    var body: some View {
        Form {
            Section(L.avatar) {
                HStack {
                    ZStack {
                        Circle()
                            .fill(.blue.opacity(0.15))
                            .frame(width: 64, height: 64)
                        Text(String(displayName.prefix(1)).uppercased())
                            .font(.title.bold())
                            .foregroundStyle(.blue)
                    }

                    Text(displayName.isEmpty ? L.user : displayName)
                        .font(.headline)
                        .padding(.leading, 8)
                }
            }

            Section(L.basicInfo) {
                LabeledContent("ID") {
                    Text(currentUser?.userCode ?? "—")
                        .foregroundStyle(.secondary)
                }

                LabeledContent(L.email) {
                    Text(currentUser?.email ?? "—")
                        .foregroundStyle(.secondary)
                }

                LabeledContent(L.name) {
                    TextField("", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 250)
                }
            }

            Section(L.security) {
                Button(L.changePassword) {
                    showChangePassword = true
                }
            }

            Section {
                HStack {
                    if let savedMessage {
                        Text(savedMessage)
                            .font(.caption)
                            .foregroundStyle(isError ? .red : .green)
                    }
                    Spacer()
                    Button(L.saveChanges) {
                        saveProfile()
                    }
                    .disabled(isSaving)
                }
            }
        }
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordView()
                .environment(appState)
        }
        .formStyle(.grouped)
        .onAppear {
            if let user = currentUser {
                displayName = user.displayName ?? ""
                email = ""
            }
        }
    }

    private var currentUser: UserInfo? {
        if case .loggedIn(let user) = appState.authState { return user }
        return nil
    }

    private func saveProfile() {
        isSaving = true
        savedMessage = nil
        isError = false

        Task {
            do {
                let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

                let updatedUser = try await appState.api?.updateCurrentUser(
                    displayName: trimmedName.isEmpty ? nil : trimmedName,
                    email: trimmedEmail.isEmpty ? nil : trimmedEmail
                )

                if let updatedUser {
                    appState.authState = .loggedIn(user: updatedUser)
                }

                savedMessage = L.saved
                isError = false
            } catch {
                savedMessage = "\(L.saveFailed)：\(error.localizedDescription)"
                isError = true
            }

            isSaving = false

            // Clear message after 3 seconds
            try? await Task.sleep(for: .seconds(3))
            savedMessage = nil
        }
    }
}
