import SwiftUI

/// 3-step wizard for creating a new Agent.
struct AgentCreationWizard: View {
    let agentService: AgentService
    let tagService: TagService
    @Environment(\.dismiss) private var dismiss

    @State private var step = 1
    @State private var displayName = ""
    @State private var description = ""
    @State private var selectedCapabilities: Set<AgentCapability> = []
    @State private var executionMode: ExecutionMode = .local
    @State private var proactiveIntensity: ProactiveIntensity = .off
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var selectedTagId: String?

    var body: some View {
        VStack(spacing: 0) {
            // Header with step indicator
            HStack {
                Text(L.createAgent)
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
                        .fill(s <= step ? Color.purple : Color.secondary.opacity(0.2))
                        .frame(height: 3)
                }
            }
            .padding(.horizontal)

            Divider().padding(.top, 8)

            // Content
            ScrollView {
                switch step {
                case 1: stepBasicInfo
                case 2: stepCapabilities
                case 3: stepReview
                default: EmptyView()
                }
            }
            .padding()
            .task { await tagService.loadTags() }

            Divider()

            // Navigation buttons
            HStack {
                if step > 1 {
                    Button(L.previousStep) { step -= 1 }
                }
                Spacer()
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if step < 3 {
                    Button(L.nextStep) { step += 1 }
                        .disabled(step == 1 && displayName.isEmpty)
                } else {
                    Button(L.create) { createAgent() }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .disabled(isCreating || displayName.isEmpty)
                }
                Button(L.cancel) { dismiss() }
            }
            .padding()
        }
        .frame(width: 480, height: 500)
    }

    // MARK: - Step 1: Basic Info

    private var stepBasicInfo: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L.basicInfo)
                .font(.title3.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text(L.name).font(.subheadline.bold())
                TextField(L.agentName, text: $displayName)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(L.description).font(.subheadline.bold())
                TextField(L.agentDescription, text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...5)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(L.socialTag).font(.subheadline.bold())
                Picker(L.tags, selection: $selectedTagId) {
                    Text("default").tag(nil as String?)
                    ForEach(tagService.tags.filter { !$0.isDefault && $0.isMain != true }) { tag in
                        Text(tag.displayName).tag(tag.id as String?)
                    }
                }
                Text(L.tagWorkspaceDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Step 2: Capabilities

    private var stepCapabilities: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L.capabilityConfig)
                .font(.title3.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text(L.executionMode).font(.subheadline.bold())
                Picker("", selection: $executionMode) {
                    Text(L.local).tag(ExecutionMode.local)
                    Text(L.cloud).tag(ExecutionMode.cloud)
                    Text(L.hybrid).tag(ExecutionMode.hybrid)
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(L.proactivity).font(.subheadline.bold())
                Picker("", selection: $proactiveIntensity) {
                    ForEach(ProactiveIntensity.allCases, id: \.self) { level in
                        Text(level.rawValue.capitalized).tag(level)
                    }
                }
                .pickerStyle(.segmented)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L.selectCapabilities).font(.subheadline.bold())
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(AgentCapability.allCases, id: \.self) { cap in
                        let isSelected = selectedCapabilities.contains(cap)
                        Button {
                            if isSelected { selectedCapabilities.remove(cap) }
                            else { selectedCapabilities.insert(cap) }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: cap.iconName)
                                    .font(.caption)
                                Text(cap.displayName)
                                    .font(.caption)
                                Spacer()
                                if isSelected {
                                    Image(systemName: "checkmark")
                                        .font(.caption2)
                                }
                            }
                            .padding(8)
                            .background(isSelected ? Color.purple.opacity(0.1) : Color.secondary.opacity(0.05))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(isSelected ? Color.purple : Color.clear, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Step 3: Review

    private var stepReview: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L.confirmCreate)
                .font(.title3.bold())

            GroupBox(L.basicInfo) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(L.name):").foregroundStyle(.secondary)
                        Text(displayName).bold()
                    }
                    if !description.isEmpty {
                        HStack(alignment: .top) {
                            Text("\(L.description):").foregroundStyle(.secondary)
                            Text(description)
                        }
                    }
                    HStack {
                        Text("\(L.tags):").foregroundStyle(.secondary)
                        if let tagId = selectedTagId, let tag = tagService.tags.first(where: { $0.id == tagId }) {
                            Text(tag.displayName)
                        } else {
                            Text("default")
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }

            GroupBox(L.capabilityConfig) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(L.executionMode):").foregroundStyle(.secondary)
                        Text(executionMode.rawValue.capitalized)
                    }
                    HStack {
                        Text("\(L.proactivity):").foregroundStyle(.secondary)
                        Text(proactiveIntensity.rawValue.capitalized)
                    }
                    if !selectedCapabilities.isEmpty {
                        HStack(alignment: .top) {
                            Text("\(L.selectCapabilities):").foregroundStyle(.secondary)
                            Text(selectedCapabilities.map(\.displayName).joined(separator: ", "))
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }
        }
    }

    // MARK: - Create

    private func createAgent() {
        isCreating = true
        errorMessage = nil
        var config = AgentConfig(displayName: displayName, description: description.isEmpty ? nil : description)
        config.capabilities = Array(selectedCapabilities)
        config.executionMode = executionMode
        config.proactiveIntensity = proactiveIntensity

        Task {
            do {
                _ = try await agentService.createAgent(config: config, tagId: selectedTagId)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isCreating = false
            }
        }
    }
}
