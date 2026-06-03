import SwiftUI

struct ChangePasswordView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var oldPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var isSuccess = false

    var body: some View {
        VStack(spacing: SDSpacing.xxl) {
            // Header
            VStack(spacing: SDSpacing.md) {
                Image(systemName: "lock.rotation")
                    .font(.system(size: 28))
                    .foregroundStyle(SDColor.primary)
                Text(L.changePassword)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(SDColor.textPrimary)
            }

            // Form fields
            VStack(spacing: SDSpacing.lg) {
                secureField(icon: "lock", placeholder: L.currentPassword, text: $oldPassword)
                secureField(icon: "lock.badge.plus", placeholder: L.newPasswordPlaceholder, text: $newPassword)
                secureField(icon: "lock.badge.plus", placeholder: L.confirmNewPassword, text: $confirmPassword)
            }

            // Error / Success message
            if let errorMessage {
                HStack(spacing: SDSpacing.md) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(SDColor.error)
                    Text(errorMessage)
                        .foregroundStyle(SDColor.error)
                }
                .font(SDFont.small)
            }

            if isSuccess {
                HStack(spacing: SDSpacing.md) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text(L.passwordChanged)
                        .foregroundStyle(.green)
                }
                .font(SDFont.small)
            }

            // Buttons
            HStack(spacing: SDSpacing.lg) {
                Button(L.cancel) {
                    dismiss()
                }
                .buttonStyle(.plain)
                .foregroundStyle(SDColor.textSecondary)

                Button(action: submit) {
                    HStack(spacing: SDSpacing.md) {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(L.confirmChanges)
                            .font(.system(size: 14, weight: .medium))
                    }
                    .frame(width: 120, height: 36)
                    .foregroundStyle(.white)
                    .background(
                        submitEnabled ? SDColor.primary : SDColor.textDisabled,
                        in: RoundedRectangle(cornerRadius: SDRadius.md)
                    )
                }
                .buttonStyle(.plain)
                .disabled(!submitEnabled)
            }
        }
        .padding(SDSpacing.xxl)
        .frame(width: 380)
    }

    private var submitEnabled: Bool {
        !oldPassword.isEmpty && newPassword.count >= 6 && !confirmPassword.isEmpty && !isLoading && !isSuccess
    }

    private func secureField(icon: String, placeholder: String, text: Binding<String>) -> some View {
        HStack(spacing: SDSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(SDColor.textTertiary)
                .frame(width: 20)
            SecureField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(SDFont.body)
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: SDRadius.md)
                .fill(SDColor.bgSecondary)
        )
    }

    private func submit() {
        errorMessage = nil

        if newPassword != confirmPassword {
            errorMessage = L.passwordMismatch
            return
        }
        if newPassword == oldPassword {
            errorMessage = L.passwordSameAsOld
            return
        }

        isLoading = true

        Task {
            do {
                try await appState.authManager?.changePassword(
                    oldPassword: oldPassword,
                    newPassword: newPassword
                )
                isSuccess = true
                try? await Task.sleep(for: .seconds(1.5))
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
