import SwiftUI

/// Side drawer showing task execution logs with search and filtering.
struct ExecutionLogDrawer: View {
    let logs: [ExecutionLog]
    @Binding var isPresented: Bool

    @State private var searchText = ""
    @State private var selectedStep: String?
    @State private var expandedLogIds: Set<String> = []

    private var uniqueSteps: [String] {
        Array(Set(logs.map(\.step))).sorted()
    }

    private var filteredLogs: [ExecutionLog] {
        logs.filter { log in
            let matchesSearch = searchText.isEmpty ||
                log.message.localizedCaseInsensitiveContains(searchText) ||
                log.step.localizedCaseInsensitiveContains(searchText)
            let matchesStep = selectedStep == nil || log.step == selectedStep
            return matchesSearch && matchesStep
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "terminal")
                    .foregroundStyle(.secondary)
                Text(L.executionLog)
                    .font(.headline)
                Spacer()
                Button(action: { isPresented = false }) {
                    Image(systemName: "xmark")
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider()

            // Filters
            VStack(spacing: 8) {
                // Search
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                    TextField(L.searchLogs, text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.caption)
                }
                .padding(6)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))

                // Step filter
                if !uniqueSteps.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            FilterChip(label: L.all, isSelected: selectedStep == nil) {
                                selectedStep = nil
                            }
                            ForEach(uniqueSteps, id: \.self) { step in
                                FilterChip(label: step, isSelected: selectedStep == step) {
                                    selectedStep = step
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            Divider()

            // Log entries
            if filteredLogs.isEmpty {
                Spacer()
                ContentUnavailableView(L.noMatchingLogs, systemImage: "doc.text.magnifyingglass")
                Spacer()
            } else {
                List {
                    ForEach(filteredLogs) { log in
                        LogEntryRow(log: log, isExpanded: expandedLogIds.contains(log.id)) {
                            if expandedLogIds.contains(log.id) {
                                expandedLogIds.remove(log.id)
                            } else {
                                expandedLogIds.insert(log.id)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .frame(width: 380)
    }
}

// MARK: - Log Entry Row

struct LogEntryRow: View {
    let log: ExecutionLog
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                // Timestamp
                Text(formattedTime)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.tertiary)

                // Step badge
                Text(log.step)
                    .font(.system(size: 9, weight: .medium))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))

                // Level badge
                if let level = log.level {
                    Text(level.rawValue.uppercased())
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(levelColor(level))
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(levelColor(level).opacity(0.1), in: RoundedRectangle(cornerRadius: 2))
                }

                Spacer()

                if log.details != nil {
                    Button(action: onToggle) {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }

            Text(log.message)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(isExpanded ? nil : 2)

            // Expandable details
            if isExpanded, let details = log.details, !details.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(details.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        HStack(alignment: .top) {
                            Text("\(key):")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Text(value)
                                .font(.system(.caption2, design: .monospaced))
                        }
                    }
                }
                .padding(6)
                .background(.secondary.opacity(0.04), in: RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(.vertical, 2)
    }

    private var formattedTime: String {
        let date = Date(timeIntervalSince1970: log.timestamp)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private func levelColor(_ level: ExecutionLog.LogLevel) -> Color {
        switch level {
        case .info: .blue
        case .warning: .orange
        case .error: .red
        case .debug: .gray
        }
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(isSelected ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}
