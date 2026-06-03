import SwiftUI

/// Sidebar panel for settings — shows category list with page selection.
struct SettingsSidebarPanel: View {
    @Environment(AppState.self) private var appState
    let chatService: ChatService
    @Binding var selectedPage: AppState.DetailDestination.SettingsPage

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(L.settings)
                    .font(SDFont.title)
                    .foregroundStyle(SDColor.textPrimary)
                Spacer()
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.top, SDSpacing.lg)
            .padding(.bottom, SDSpacing.md)

            Rectangle()
                .fill(SDColor.divider)
                .frame(height: 1)

            // User card
            if case .loggedIn(let user) = appState.authState {
                HStack(spacing: SDSpacing.lg) {
                    AvatarWithBadge(
                        name: user.displayName ?? user.username,
                        type: .human,
                        size: 44
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName ?? user.username)
                            .font(SDFont.subtitle)
                            .foregroundStyle(SDColor.textPrimary)
                        Text(user.username)
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textTertiary)
                    }
                    Spacer()
                }
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.lg)
                .background(selectedPage == .profile ? SDColor.bgActive : Color.clear)
                .contentShape(Rectangle())
                .onTapGesture { selectedPage = .profile }
            }

            Rectangle()
                .fill(SDColor.divider)
                .frame(height: 1)

            // Settings categories
            VStack(spacing: 2) {
                ForEach(AppState.DetailDestination.SettingsPage.allCases) { page in
                    if page != .profile {
                        settingsRow(page: page)
                    }
                }
            }
            .padding(.vertical, SDSpacing.md)
            .padding(.horizontal, SDSpacing.sm)

            Spacer()

            Rectangle()
                .fill(SDColor.divider)
                .frame(height: 1)

            // Connection status
            HStack(spacing: SDSpacing.sm) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(SDFont.small)
                    .foregroundStyle(SDColor.textTertiary)
                Spacer()
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.vertical, SDSpacing.md)

            // Logout button
            Button(role: .destructive) {
                Task { await appState.logout(chatService: chatService) }
            } label: {
                HStack(spacing: SDSpacing.md) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 14))
                    Text(L.logout)
                        .font(SDFont.body)
                }
                .foregroundStyle(SDColor.error)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.md)
            }
            .buttonStyle(.plain)
        }
    }

    private func settingsRow(page: AppState.DetailDestination.SettingsPage) -> some View {
        let isActive = selectedPage == page
        return Button(action: { selectedPage = page }) {
            HStack(spacing: SDSpacing.lg) {
                Image(systemName: page.icon)
                    .font(.system(size: 14))
                    .foregroundStyle(isActive ? SDColor.primary : SDColor.textSecondary)
                    .frame(width: 20)
                Text(page.displayName)
                    .font(SDFont.body)
                    .foregroundStyle(isActive ? SDColor.primary : SDColor.textPrimary)
                Spacer()
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.vertical, SDSpacing.md)
            .background(
                isActive ? SDColor.primaryLight : Color.clear,
                in: RoundedRectangle(cornerRadius: SDRadius.md)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var statusColor: Color {
        switch appState.connectionStatus {
        case .connected: SDColor.success
        case .connecting, .reconnecting: SDColor.warning
        case .disconnected: SDColor.error
        }
    }

    private var statusText: String {
        switch appState.connectionStatus {
        case .connected: L.connected
        case .connecting: L.connecting
        case .reconnecting: L.reconnecting
        case .disconnected: L.disconnected
        }
    }
}
