import SwiftUI

struct TagManagementView: View {
    @Bindable var tagService: TagService
    let agentService: AgentService?

    @State private var showCreateSheet = false
    @State private var editingTag: Tag?

    var body: some View {
        Form {
            Section(L.tagList) {
                ForEach(tagService.tags) { tag in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(tag.displayName).font(.body.bold())
                                if tag.isDefault {
                                    Text("default")
                                        .font(.caption2)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 1)
                                        .background(Color.secondary.opacity(0.2), in: RoundedRectangle(cornerRadius: 3))
                                }
                            }
                            if tag.isMain == true {
                                Text(L.tagFollowsGlobal)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                let paths = tag.nodeAcl.allowedPaths
                                if !paths.isEmpty {
                                    Text(paths.joined(separator: ", "))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                } else {
                                    Text(L.noPathsConfigured)
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        Spacer()
                        if tag.isMain != true {
                            Button { editingTag = tag } label: {
                                Image(systemName: "pencil")
                            }
                            .buttonStyle(.plain)
                        }

                        if !tag.isDefault && tag.isMain != true {
                            Button(role: .destructive) {
                                Task { try? await tagService.deleteTag(id: tag.id) }
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Section {
                Button { showCreateSheet = true } label: {
                    Label(L.newTag, systemImage: "plus.circle")
                }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $showCreateSheet) {
            CreateTagSheet(tagService: tagService, agentService: agentService)
        }
        .sheet(item: $editingTag) { tag in
            EditTagSheet(tagService: tagService, tag: tag)
        }
        .task {
            await tagService.loadTags()
            await syncTagPathsWithWhitelist()
        }
    }

    /// Remove tag allowedPaths that are no longer in the security whitelist.
    private func syncTagPathsWithWhitelist() async {
        let whitelist = Set(CommandPolicy.shared.allowedPaths)
        for tag in tagService.tags {
            // Skip main tag — its node ACL is managed by the server
            if tag.isMain == true { continue }
            let current = tag.nodeAcl.allowedPaths
            let filtered = current.filter { whitelist.contains($0) }
            if filtered.count != current.count {
                let acl = Tag.NodeAcl(
                    allowedPaths: filtered,
                    deniedPaths: tag.nodeAcl.deniedPaths
                )
                try? await tagService.updateTag(id: tag.id, nodeAcl: acl)
            }
        }
    }
}

// MARK: - Create Tag Sheet

struct CreateTagSheet: View {
    let tagService: TagService
    let agentService: AgentService?
    @Environment(\.dismiss) private var dismiss

    @State private var displayName = ""
    @State private var selectedPaths: Set<String> = []
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var whitelistPaths: [String] {
        CommandPolicy.shared.allowedPaths
    }

    var body: some View {
        VStack(spacing: 16) {
            Text(L.newTag).font(.headline)

            Form {
                TextField(L.tagName, text: $displayName)

                Section(L.allowedPaths) {
                    if whitelistPaths.isEmpty {
                        Text(L.addWhitelistFirst)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(whitelistPaths, id: \.self) { path in
                            Toggle(isOn: Binding(
                                get: { selectedPaths.contains(path) },
                                set: { isOn in
                                    if isOn { selectedPaths.insert(path) }
                                    else { selectedPaths.remove(path) }
                                }
                            )) {
                                Text(path)
                                    .font(.system(.body, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            HStack {
                Button(L.cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(L.create) {
                    Task { await createTag() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(displayName.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
            }
        }
        .padding()
        .frame(width: 480)
    }

    private func createTag() async {
        isSubmitting = true
        errorMessage = nil
        let trimmedName = displayName.trimmingCharacters(in: .whitespaces)
        let acl = selectedPaths.isEmpty ? nil : Tag.NodeAcl(
            allowedPaths: Array(selectedPaths),
            deniedPaths: []
        )
        do {
            // Server auto-creates owner + delegate agent pair for the new tag
            _ = try await tagService.createTag(
                displayName: trimmedName,
                nodeAcl: acl
            )
            // Refresh agent list so the auto-created owner agent appears
            if let agentService {
                await agentService.loadAgents()
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}

// MARK: - Edit Tag Sheet

struct EditTagSheet: View {
    let tagService: TagService
    let tag: Tag
    @Environment(\.dismiss) private var dismiss

    @State private var displayName: String
    @State private var selectedPaths: Set<String>
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var whitelistPaths: [String] {
        CommandPolicy.shared.allowedPaths
    }

    init(tagService: TagService, tag: Tag) {
        self.tagService = tagService
        self.tag = tag
        _displayName = State(initialValue: tag.displayName)
        _selectedPaths = State(initialValue: Set(tag.nodeAcl.allowedPaths))
    }

    private var isMainTag: Bool { tag.isMain == true }

    var body: some View {
        VStack(spacing: 16) {
            Text(L.editTag).font(.headline)

            Form {
                TextField(L.tagName, text: $displayName)

                if isMainTag {
                    Section(L.nodePermissions) {
                        Text(L.mainTagNodeAclNote)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section(L.allowedPaths) {
                        if whitelistPaths.isEmpty {
                            Text(L.addWhitelistFirst)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(whitelistPaths, id: \.self) { path in
                                Toggle(isOn: Binding(
                                    get: { selectedPaths.contains(path) },
                                    set: { isOn in
                                        if isOn { selectedPaths.insert(path) }
                                        else { selectedPaths.remove(path) }
                                    }
                                )) {
                                    Text(path)
                                        .font(.system(.body, design: .monospaced))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            HStack {
                Button(L.cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(L.save) {
                    Task { await saveTag() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(displayName.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
            }
        }
        .padding()
        .frame(width: 480)
    }

    private func saveTag() async {
        isSubmitting = true
        errorMessage = nil
        // Main tag: don't send nodeAcl changes (server manages it automatically)
        let acl: Tag.NodeAcl? = isMainTag ? nil : Tag.NodeAcl(
            allowedPaths: Array(selectedPaths),
            deniedPaths: tag.nodeAcl.deniedPaths
        )
        do {
            try await tagService.updateTag(
                id: tag.id,
                displayName: displayName.trimmingCharacters(in: .whitespaces),
                nodeAcl: acl
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}
