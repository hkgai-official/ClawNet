import SwiftUI

/// Right-side detail view for settings — renders content based on the selected SettingsPage.
struct SettingsDetailView: View {
    let page: AppState.DetailDestination.SettingsPage
    let chatService: ChatService
    @Environment(AppState.self) private var appState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Page header
                HStack(spacing: SDSpacing.lg) {
                    Image(systemName: page.icon)
                        .font(.system(size: 18))
                        .foregroundStyle(SDColor.primary)
                    Text(page.displayName)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(SDColor.textPrimary)
                }
                .padding(.horizontal, SDSpacing.xxl)
                .padding(.top, SDSpacing.xxl)
                .padding(.bottom, SDSpacing.lg)

                Rectangle()
                    .fill(SDColor.divider)
                    .frame(height: 1)
                    .padding(.bottom, SDSpacing.lg)

                // Page content
                switch page {
                case .profile:
                    ProfileSettingsView()
                        .padding(.horizontal, SDSpacing.xl)
                case .general:
                    GeneralSettingsView()
                        .padding(.horizontal, SDSpacing.xl)
                // case .connection:
                //     ConnectionSettingsView()
                //         .padding(.horizontal, SDSpacing.xl)
                case .security:
                    SecuritySettingsView(policy: CommandPolicy.shared)
                        .padding(.horizontal, SDSpacing.xl)
                case .tags:
                    TagManagementView(tagService: appState.tagService, agentService: appState.agentService)
                        .padding(.horizontal, SDSpacing.xl)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SDColor.bgPrimary)
    }
}
