import SwiftUI

/// 3-step wizard for creating an Agent-to-Agent dialog session.
struct AgentDialogWizard: View {
    let agentService: AgentService
    let chatService: ChatService
    @Environment(\.dismiss) private var dismiss

    @State private var step = 1
    @State private var myAgent: Agent?
    @State private var targetAgent: Agent?
    @State private var topic = ""
    @State private var maxRounds = 5
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(L.startAgentDialog)
                    .font(.headline)
                Spacer()
                Text(L.stepOf(step, 3))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()

            // Step indicators
            HStack(spacing: 4) {
                ForEach(1...3, id: \.self) { s in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(s <= step ? Color.blue : Color.secondary.opacity(0.2))
                        .frame(height: 3)
                }
            }
            .padding(.horizontal)

            Divider().padding(.top, 8)

            ScrollView {
                switch step {
                case 1: selectMyAgent
                case 2: selectTargetAgent
                case 3: configureDialog
                default: EmptyView()
                }
            }
            .padding()

            Divider()

            HStack {
                if step > 1 {
                    Button(L.previousStep) { step -= 1 }
                }
                Spacer()
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
                if step < 3 {
                    Button(L.nextStep) { step += 1 }
                        .disabled(step == 1 && myAgent == nil || step == 2 && targetAgent == nil)
                } else {
                    Button(L.startDialog) { createDialog() }
                        .buttonStyle(.borderedProminent)
                        .disabled(isCreating || topic.isEmpty)
                }
                Button(L.cancel) { dismiss() }
            }
            .padding()
        }
        .frame(width: 480, height: 500)
        .task {
            await agentService.loadAgents()
            await agentService.loadContactableAgents()
        }
    }

    // MARK: - Step 1: Select My Agent

    private var selectMyAgent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.selectYourAgent)
                .font(.title3.bold())
            Text(L.selectYourAgentDescription)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if agentService.agents.isEmpty {
                ContentUnavailableView(L.noAgents, systemImage: "cpu", description: Text(L.createAgentFirst))
            } else {
                ForEach(agentService.agents) { agent in
                    agentSelectionRow(agent, isSelected: myAgent?.id == agent.id) {
                        myAgent = agent
                    }
                }
            }
        }
    }

    // MARK: - Step 2: Select Target Agent

    private var selectTargetAgent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.selectTargetAgent)
                .font(.title3.bold())
            Text(L.selectTargetAgentDescription)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            let available = agentService.contactableAgents.filter { $0.id != myAgent?.id }
            if available.isEmpty {
                ContentUnavailableView(L.noContactableAgents, systemImage: "person.2.slash", description: Text(L.noOtherAgents))
            } else {
                ForEach(available) { agent in
                    agentSelectionRow(agent, isSelected: targetAgent?.id == agent.id) {
                        targetAgent = agent
                    }
                }
            }
        }
    }

    // MARK: - Step 3: Configure

    private var configureDialog: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L.dialogSettings)
                .font(.title3.bold())

            // Agent preview
            if let my = myAgent, let target = targetAgent {
                HStack(spacing: 16) {
                    agentPreviewBadge(my, label: L.yourAgent)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(.secondary)
                    agentPreviewBadge(target, label: L.targetAgent)
                }
                .padding()
                .background(.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(L.dialogTopic).font(.subheadline.bold())
                TextField(L.dialogTopicPlaceholder, text: $topic, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(L.maxRounds).font(.subheadline.bold())
                    Spacer()
                    TextField("", value: $maxRounds, format: .number)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 50)
                        .multilineTextAlignment(.center)
                        .onChange(of: maxRounds) { _, newValue in
                            maxRounds = min(max(newValue, 1), 50)
                        }
                }
                Slider(value: Binding(
                    get: { Double(maxRounds) },
                    set: { maxRounds = Int($0) }
                ), in: 1...50, step: 1)
            }
        }
    }

    // MARK: - Helpers

    private func agentSelectionRow(_ agent: Agent, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
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
                    Text(agent.config.displayName).font(.subheadline.bold())
                    if let desc = agent.config.description {
                        Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.blue)
                }
            }
            .padding(10)
            .background(isSelected ? Color.blue.opacity(0.05) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSelected ? Color.blue : Color.secondary.opacity(0.2)))
        }
        .buttonStyle(.plain)
    }

    private func agentPreviewBadge(_ agent: Agent, label: String) -> some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(.purple.opacity(0.15))
                    .frame(width: 32, height: 32)
                Text(String(agent.config.displayName.prefix(1)).uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(.purple)
            }
            Text(agent.config.displayName)
                .font(.caption.bold())
                .lineLimit(1)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func createDialog() {
        guard let my = myAgent, let target = targetAgent else { return }
        isCreating = true
        errorMessage = nil

        Task {
            do {
                let session = try await agentService.createDialog(
                    initiatorAgentId: my.id,
                    responderAgentId: target.id,
                    topic: topic,
                    maxRounds: maxRounds
                )
                // Select the dialog's conversation if available
                if let convId = session.conversationId {
                    await chatService.loadConversations()
                    await chatService.selectConversation(convId)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isCreating = false
            }
        }
    }
}
