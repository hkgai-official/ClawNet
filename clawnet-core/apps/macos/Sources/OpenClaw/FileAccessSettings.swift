import Observation
import SwiftUI

struct FileAccessSettings: View {
    @State private var model = FileAccessSettingsModel()
    @State private var newPattern: String = ""
    @State private var newDeniedPattern: String = ""

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {
                Text("File Access")
                    .font(.title3.weight(.semibold))

                Text("Controls how agents can read and write files on this Mac via the node file commands (file.read, file.write).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                self.modeSection
                Divider()
                self.allowedPathsSection
                Divider()
                self.deniedPathsSection
                Divider()
                FileAccessLogsSection()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 16)
        }
        .onAppear { self.model.refresh() }
    }

    private var modeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Access mode")
                .font(.callout.weight(.semibold))

            Picker("Mode", selection: Binding(
                get: { self.model.mode },
                set: { self.model.setMode($0) }))
            {
                ForEach(FileAccessMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(width: 220)

            Text(self.modeDescription)
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var modeDescription: String {
        switch self.model.mode {
        case .deny:
            return "All file operations via file.read/file.write are blocked."
        case .scoped:
            return "File access is restricted to paths in the allowlist below. " +
                "Requests outside the allowlist will trigger a prompt."
        case .full:
            return "All file operations are allowed (except explicitly denied paths). Use with caution."
        }
    }

    private var allowedPathsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Allowed paths")
                .font(.callout.weight(.semibold))

            HStack(spacing: 8) {
                TextField("Path pattern (e.g. /Users/me/Documents/*)", text: self.$newPattern)
                    .textFieldStyle(.roundedBorder)
                Button("Add") {
                    self.model.addAllowedPath(self.newPattern)
                    self.newPattern = ""
                }
                .buttonStyle(.bordered)
                .disabled(self.newPattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            Text("Supports glob patterns: * (match within directory), ** (match across directories).")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if self.model.allowedPaths.isEmpty {
                Text("No allowed paths configured. In scoped mode, all file access will prompt.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(self.model.allowedPaths) { entry in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.pattern)
                                    .font(.body.monospaced())
                                HStack(spacing: 8) {
                                    Text("ops: \(entry.operations.joined(separator: ", "))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let lastUsed = entry.lastUsedAt {
                                        let date = Date(timeIntervalSince1970: lastUsed / 1000)
                                        Text("last used: \(date, style: .relative)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            Spacer()
                            Button(role: .destructive) {
                                self.model.removeAllowedPath(id: entry.id)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
    }

    private var deniedPathsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Denied paths")
                .font(.callout.weight(.semibold))

            Text("These paths are always blocked, even in \"Allow All\" mode.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                TextField("Denied pattern (e.g. **/.ssh/id_*)", text: self.$newDeniedPattern)
                    .textFieldStyle(.roundedBorder)
                Button("Add") {
                    self.model.addDeniedPath(self.newDeniedPattern)
                    self.newDeniedPattern = ""
                }
                .buttonStyle(.bordered)
                .disabled(self.newDeniedPattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if self.model.deniedPaths.isEmpty {
                Text("No denied paths configured.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(self.model.deniedPaths, id: \.self) { pattern in
                        HStack(spacing: 8) {
                            Text(pattern)
                                .font(.body.monospaced())
                            Spacer()
                            Button(role: .destructive) {
                                self.model.removeDeniedPath(pattern)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
    }
}

@MainActor
@Observable
final class FileAccessSettingsModel {
    var mode: FileAccessMode = .scoped
    var allowedPaths: [FileAccessAllowedPath] = []
    var deniedPaths: [String] = []

    func refresh() {
        let config = FileAccessStore.load()
        self.mode = config.mode
        self.allowedPaths = config.allowedPaths
        self.deniedPaths = config.deniedPaths
    }

    func setMode(_ mode: FileAccessMode) {
        self.mode = mode
        FileAccessStore.update { $0.mode = mode }
    }

    func addAllowedPath(_ pattern: String) {
        let trimmed = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let entry = FileAccessAllowedPath(pattern: trimmed)
        self.allowedPaths.append(entry)
        FileAccessStore.update { $0.allowedPaths.append(entry) }
    }

    func removeAllowedPath(id: UUID) {
        self.allowedPaths.removeAll { $0.id == id }
        FileAccessStore.update { $0.allowedPaths.removeAll { $0.id == id } }
    }

    func addDeniedPath(_ pattern: String) {
        let trimmed = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard !self.deniedPaths.contains(trimmed) else { return }
        self.deniedPaths.append(trimmed)
        FileAccessStore.update { $0.deniedPaths.append(trimmed) }
    }

    func removeDeniedPath(_ pattern: String) {
        self.deniedPaths.removeAll { $0 == pattern }
        FileAccessStore.update { $0.deniedPaths.removeAll { $0 == pattern } }
    }
}

// MARK: - Activity Logs

struct FileAccessLogsSection: View {
    private var logger = FileAccessLogger.shared
    @State private var filterAllowed: Bool? = nil // nil = all, true = allowed, false = denied

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Recent Activity")
                    .font(.callout.weight(.semibold))

                Spacer()

                Picker("", selection: self.$filterAllowed) {
                    Text("All").tag(nil as Bool?)
                    Text("Allowed").tag(true as Bool?)
                    Text("Denied").tag(false as Bool?)
                }
                .pickerStyle(.segmented)
                .frame(width: 180)

                Button {
                    self.logger.clear()
                } label: {
                    Image(systemName: "trash")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help("Clear logs")
                .disabled(self.logger.entries.isEmpty)
            }

            if self.filteredEntries.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 6) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.title2)
                            .foregroundStyle(.quaternary)
                        Text("No file access events recorded yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 20)
                    Spacer()
                }
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(self.filteredEntries.prefix(50)) { entry in
                            FileAccessLogRow(entry: entry)
                            if entry.id != self.filteredEntries.prefix(50).last?.id {
                                Divider().padding(.leading, 24)
                            }
                        }
                    }
                }
                .frame(height: 200)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(.separator, lineWidth: 0.5)
                )

                if self.filteredEntries.count > 50 {
                    Text("Showing 50 of \(self.filteredEntries.count) events")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    private var filteredEntries: [FileAccessLogEntry] {
        guard let filter = self.filterAllowed else {
            return self.logger.entries
        }
        return self.logger.entries.filter { $0.allowed == filter }
    }
}

struct FileAccessLogRow: View {
    let entry: FileAccessLogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(self.entry.allowed ? Color.green : Color.red)
                .frame(width: 8, height: 8)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(self.abbreviatedPath)
                        .font(.callout.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(self.entry.path)

                    Spacer()

                    Text(self.entry.operation.uppercased())
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(self.operationColor.opacity(0.12))
                        .foregroundStyle(self.operationColor)
                        .clipShape(RoundedRectangle(cornerRadius: 3))

                    Text(self.relativeTime)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(width: 60, alignment: .trailing)
                }

                Text(self.entry.reason)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
    }

    private var abbreviatedPath: String {
        let path = self.entry.path
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            return "~" + String(path.dropFirst(home.count))
        }
        return path
    }

    private var operationColor: Color {
        self.entry.operation == "write" ? .orange : .blue
    }

    private var relativeTime: String {
        let date = Date(timeIntervalSince1970: self.entry.timestamp / 1000)
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return "just now" }
        if elapsed < 3600 { return "\(Int(elapsed / 60))m ago" }
        if elapsed < 86400 { return "\(Int(elapsed / 3600))h ago" }
        return "\(Int(elapsed / 86400))d ago"
    }
}

#if DEBUG
struct FileAccessSettings_Previews: PreviewProvider {
    static var previews: some View {
        FileAccessSettings()
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}
#endif
