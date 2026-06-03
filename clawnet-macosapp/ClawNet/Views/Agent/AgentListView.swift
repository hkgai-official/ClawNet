import SwiftUI

/// Panel listing user's agents with creation wizard.
struct AgentListView: View {
    @Environment(AppState.self) private var appState
    @Bindable var agentService: AgentService
    @State private var showCreateWizard = false
    @State private var selectedAgent: Agent?

    /// Visible agents: hide delegate agents (they are for A2A only, not user-facing)
    private var visibleAgents: [Agent] {
        agentService.agents.filter { $0.tagRole != "delegate" }
    }

    var body: some View {
        List {
            if visibleAgents.isEmpty && !agentService.isLoading {
                ContentUnavailableView(L.noAgents, systemImage: "cpu", description: Text(L.createFirstAgent))
            }

            ForEach(visibleAgents) { agent in
                AgentRow(agent: agent)
                    .contentShape(Rectangle())
                    .onTapGesture { selectedAgent = agent }
                    .contextMenu {
                        Button(L.delete, role: .destructive) {
                            Task { try? await agentService.deleteAgent(id: agent.id) }
                        }
                    }
            }
        }
        .listStyle(.plain)
        .overlay {
            if agentService.isLoading {
                ProgressView()
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showCreateWizard = true }) {
                    Image(systemName: "plus")
                }
                .help(L.createAgent)
            }
        }
        .sheet(isPresented: $showCreateWizard) {
            AgentCreationWizard(agentService: agentService, tagService: appState.tagService)
        }
        .sheet(item: $selectedAgent) { agent in
            AgentProfileView(agent: agent, agentService: agentService)
        }
        .task {
            await agentService.loadAgents()
        }
    }
}

// MARK: - Agent Row

struct AgentRow: View {
    let agent: Agent

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(.purple.opacity(0.15))
                    .frame(width: 36, height: 36)
                Text(String(agent.config.displayName.prefix(1)).uppercased())
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.purple)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(agent.config.displayName)
                        .font(.subheadline.bold())
                        .lineLimit(1)
                    Text("AI")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.purple)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 2))
                }

                if let desc = agent.config.description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            statusDot
        }
        .padding(.vertical, 4)
    }

    private var statusDot: some View {
        Circle()
            .fill(statusColor)
            .frame(width: 8, height: 8)
    }

    private var statusColor: Color {
        switch agent.status {
        case .online: .green
        case .busy: .orange
        case .offline: .gray
        case .error: .red
        }
    }
}
