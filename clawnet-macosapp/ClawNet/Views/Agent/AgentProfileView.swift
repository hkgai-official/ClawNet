import SwiftUI

/// Agent profile and settings sheet with tabbed configuration.
struct AgentProfileView: View {
    let agent: Agent
    let agentService: AgentService
    @Environment(\.dismiss) private var dismiss

    @State private var config: AgentConfig
    @State private var selectedTab = 0
    @State private var isSaving = false
    @State private var hasChanges = false

    init(agent: Agent, agentService: AgentService) {
        self.agent = agent
        self.agentService = agentService
        self._config = State(initialValue: agent.config)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(.purple.opacity(0.15))
                        .frame(width: 48, height: 48)
                    Text(String(config.displayName.prefix(1)).uppercased())
                        .font(.title2.bold())
                        .foregroundStyle(.purple)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(config.displayName)
                            .font(.headline)
                        Text("AI")
                            .font(.caption2.bold())
                            .foregroundStyle(.purple)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
                    }
                    Text(agent.status.rawValue.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button(L.close) { dismiss() }
            }
            .padding()

            Divider()

            // Settings tabs
            TabView(selection: $selectedTab) {
                generalTab.tag(0).tabItem { Label(L.basicInfo, systemImage: "gear") }
                capabilitiesTab.tag(1).tabItem { Label(L.capabilityConfig, systemImage: "cpu") }
                executionTab.tag(2).tabItem { Label(L.executionMode, systemImage: "play.circle") }
                permissionsTab.tag(3).tabItem { Label(L.permissionSettings, systemImage: "lock.shield") }
                analyticsTab.tag(4).tabItem { Label(L.analytics, systemImage: "chart.bar") }
            }
            .padding()

            Divider()

            // Save button
            HStack {
                Spacer()
                if hasChanges {
                    Button(L.saveChanges) { saveChanges() }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .disabled(isSaving)
                }
            }
            .padding()
        }
        .frame(width: 520, height: 560)
        .onChange(of: config.displayName) { hasChanges = true }
        .onChange(of: config.description) { hasChanges = true }
    }

    // MARK: - General Tab

    private var generalTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(L.name).font(.subheadline.bold())
                TextField(L.agentName, text: $config.displayName)
                    .textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(L.description).font(.subheadline.bold())
                TextField(L.description, text: Binding(
                    get: { config.description ?? "" },
                    set: { config.description = $0.isEmpty ? nil : $0 }
                ), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(L.systemPrompt).font(.subheadline.bold())
                TextEditor(text: Binding(
                    get: { config.systemPrompt ?? "" },
                    set: { config.systemPrompt = $0.isEmpty ? nil : $0; hasChanges = true }
                ))
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 100)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            }
        }
    }

    // MARK: - Capabilities Tab

    private var capabilitiesTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.selectAgentCapabilities).font(.subheadline.bold())
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(AgentCapability.allCases, id: \.self) { cap in
                    let isSelected = config.capabilities.contains(cap)
                    Button {
                        if isSelected { config.capabilities.removeAll { $0 == cap } }
                        else { config.capabilities.append(cap) }
                        hasChanges = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: cap.iconName).font(.caption)
                            Text(cap.displayName).font(.caption)
                            Spacer()
                            if isSelected {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.purple)
                                    .font(.caption)
                            }
                        }
                        .padding(8)
                        .background(isSelected ? .purple.opacity(0.08) : .secondary.opacity(0.04))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Execution Tab

    private var executionTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(L.executionMode).font(.subheadline.bold())
                Picker("", selection: Binding(get: { config.executionMode }, set: { config.executionMode = $0; hasChanges = true })) {
                    Text(L.local).tag(ExecutionMode.local)
                    Text(L.cloud).tag(ExecutionMode.cloud)
                    Text(L.hybrid).tag(ExecutionMode.hybrid)
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(L.proactivity).font(.subheadline.bold())
                Picker("", selection: Binding(get: { config.proactiveIntensity }, set: { config.proactiveIntensity = $0; hasChanges = true })) {
                    ForEach(ProactiveIntensity.allCases, id: \.self) { level in
                        Text(level.rawValue.capitalized).tag(level)
                    }
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(L.modelProvider).font(.subheadline.bold())
                TextField(L.modelProviderPlaceholder, text: Binding(
                    get: { config.modelProvider ?? "" },
                    set: { config.modelProvider = $0.isEmpty ? nil : $0; hasChanges = true }
                ))
                .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(L.modelNameLabel).font(.subheadline.bold())
                TextField(L.modelNamePlaceholder, text: Binding(
                    get: { config.modelName ?? "" },
                    set: { config.modelName = $0.isEmpty ? nil : $0; hasChanges = true }
                ))
                .textFieldStyle(.roundedBorder)
            }
        }
    }

    // MARK: - Permissions Tab

    private var permissionsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.permissionSettings).font(.subheadline.bold())

            let permissions = Binding(
                get: { config.permissions ?? AgentPermissions() },
                set: { config.permissions = $0; hasChanges = true }
            )

            Group {
                Toggle(L.readFiles, isOn: permissions.canReadFiles)
                Toggle(L.writeFiles, isOn: permissions.canWriteFiles)
                Toggle(L.networkAccess, isOn: permissions.canAccessNetwork)
                Toggle(L.executeCode, isOn: permissions.canExecuteCode)
                Toggle(L.calendarAccess, isOn: permissions.canAccessCalendar)
                Toggle(L.emailAccess, isOn: permissions.canAccessEmail)
            }

            HStack {
                Text(L.maxConcurrentTasks)
                Spacer()
                TextField("", value: permissions.maxConcurrentTasks, format: .number)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 60)
            }
        }
    }

    // MARK: - Analytics Tab

    private var analyticsTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L.analytics).font(.subheadline.bold())

            if let analytics = agent.analytics {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    statCard(L.totalTasks, value: "\(analytics.totalTasks)", icon: "list.bullet")
                    statCard(L.completedTasks, value: "\(analytics.completedTasks)", icon: "checkmark.circle")
                    statCard(L.failedTasks, value: "\(analytics.failedTasks)", icon: "xmark.circle")
                    statCard(L.avgResponse, value: analytics.averageResponseTime.map { String(format: "%.1fs", $0) } ?? "N/A", icon: "clock")
                }

                if let lastActive = analytics.lastActiveAt {
                    HStack {
                        Text(L.lastActive).foregroundStyle(.secondary)
                        Text(lastActive, style: .relative)
                    }
                    .font(.caption)
                    .padding(.top, 8)
                }
            } else {
                ContentUnavailableView(L.noData, systemImage: "chart.bar", description: Text(L.noDataDescription))
            }
        }
    }

    private func statCard(_ title: String, value: String, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.purple)
            Text(value)
                .font(.title2.bold())
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Save

    private func saveChanges() {
        isSaving = true
        Task {
            do {
                try await agentService.updateAgent(id: agent.id, config: config)
                hasChanges = false
            } catch {
                // Handle error
            }
            isSaving = false
        }
    }
}
