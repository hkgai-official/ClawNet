import AppKit
import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        TabView {
            ProfileSettingsView()
                .tabItem { Label(L.profile, systemImage: "person.circle") }

            GeneralSettingsView()
                .tabItem { Label(L.general, systemImage: "gear") }

            SecuritySettingsView(policy: CommandPolicy.shared)
                .tabItem { Label(L.security, systemImage: "lock.shield") }

            TagManagementView(tagService: appState.tagService, agentService: appState.agentService)
                .tabItem { Label(L.tags, systemImage: "tag") }
        }
        .frame(width: 550, height: 500)
    }
}

struct GeneralSettingsView: View {
    @State private var languageManager = LanguageManager.shared

    var body: some View {
        Form {
            Section(L.language) {
                Picker(L.languageLabel, selection: Binding(
                    get: { languageManager.current },
                    set: { languageManager.setLanguage($0) }
                )) {
                    ForEach(AppLanguage.allCases) { lang in
                        Text(lang.displayName).tag(lang)
                    }
                }
            }

            Section(L.about) {
                LabeledContent(L.version, value: "0.1.0")
                LabeledContent(L.application, value: "ClawNet")
            }
        }
        .formStyle(.grouped)
    }
}

struct ConnectionSettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var editingURL = ""
    @State private var isReconnecting = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section(L.gatewayConnection) {
                LabeledContent(L.statusLabel) {
                    HStack {
                        Circle()
                            .fill(appState.connectionStatus == .connected ? .green : .red)
                            .frame(width: 8, height: 8)
                        Text(appState.connectionStatus == .connected ? L.connected : L.disconnected)
                    }
                }
            }

            Section(L.serverAddress) {
                TextField(L.serverAddress, text: $editingURL)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .disabled(isReconnecting)

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.caption)
                }

                HStack {
                    Spacer()
                    if isReconnecting {
                        ProgressView()
                            .controlSize(.small)
                            .padding(.trailing, 4)
                    }
                    Button(L.applyAndReconnect) {
                        Task { await applyNewURL() }
                    }
                    .disabled(isReconnecting || !urlHasChanged || editingURL.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .formStyle(.grouped)
        .onAppear {
            editingURL = appState.currentServerURL
        }
    }

    private var urlHasChanged: Bool {
        editingURL.trimmingCharacters(in: .whitespaces) != appState.currentServerURL
    }

    private func applyNewURL() async {
        let trimmed = editingURL.trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            errorMessage = L.invalidURLFormat
            return
        }

        errorMessage = nil
        isReconnecting = true
        do {
            try await appState.updateServerURL(url)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isReconnecting = false
    }
}

// MARK: - Security Settings

struct SecuritySettingsView: View {
    var policy: CommandPolicy

    var body: some View {
        Form {
            fileAccessSection
        }
        .formStyle(.grouped)
    }

    // MARK: - File Access

    @ViewBuilder
    private var fileAccessSection: some View {
        Section(L.fileAccessControl) {
            Picker(L.accessMode, selection: Binding(
                get: { policy.fileAccessMode },
                set: { policy.setFileAccessMode($0) }
            )) {
                ForEach(CommandPolicy.FileAccessMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if policy.fileAccessMode == .scoped {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.authorizedFolders)
                        .font(.headline)

                    let paths = policy.allowedPaths
                    if paths.isEmpty {
                        Text(L.noFoldersAuthorized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(paths, id: \.self) { path in
                        HStack {
                            Image(systemName: "folder.fill")
                                .foregroundStyle(SDColor.primary)
                            Text(path)
                                .font(.system(.body, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Button(role: .destructive) {
                                BookmarkStore.shared.revoke(path: path)
                                policy.removeAllowedPath(path)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(.red)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Button {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = true
                        panel.canChooseFiles = false
                        panel.allowsMultipleSelection = true
                        panel.message = L.selectFolderMessage
                        panel.prompt = L.authorizeAccess
                        if panel.runModal() == .OK {
                            for url in panel.urls {
                                if let path = BookmarkStore.shared.grantAccess(url: url) {
                                    policy.addAllowedPath(path)
                                }
                            }
                        }
                    } label: {
                        Label(L.selectFolder, systemImage: "plus.circle")
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L.deniedPaths)
                    .font(.headline)

                ForEach(policy.deniedPaths, id: \.self) { path in
                    HStack {
                        Text(path)
                            .font(.system(.body, design: .monospaced))
                        Spacer()
                        if CommandPolicy.defaultDeniedPaths.contains(path) {
                            Text(L.defaultLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

}

#Preview("Security Tab") {
    SecuritySettingsView(policy: CommandPolicy())
}
