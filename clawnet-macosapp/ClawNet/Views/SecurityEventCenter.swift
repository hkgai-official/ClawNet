import SwiftUI

/// Full-panel security event center showing audit logs, dialog approvals, and access denials.
struct SecurityEventCenter: View {
    @Bindable var auditService: AuditService

    @State private var searchText = ""
    @State private var selectedCategory: AuditEvent.AuditCategory?

    private var filteredEvents: [AuditEvent] {
        auditService.events.filter { event in
            let matchesSearch = searchText.isEmpty ||
                (event.agentName?.localizedCaseInsensitiveContains(searchText) ?? false) ||
                event.details.values.contains(where: { $0.localizedCaseInsensitiveContains(searchText) })
            let matchesCategory = selectedCategory == nil || event.category == selectedCategory
            return matchesSearch && matchesCategory
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "shield.lefthalf.filled")
                    .foregroundStyle(.orange)
                Text(L.securityEvents)
                    .font(.headline)
                Spacer()
                if auditService.unreadCount > 0 {
                    Button(L.allReadAction) {
                        auditService.markAllAsRead()
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            .padding(.top)
            .padding(.bottom, 8)

            // Search bar
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .font(.caption)
                TextField(L.searchEvents, text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.caption)
            }
            .padding(6)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal)

            // Category filter chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    CategoryChip(label: L.all, isSelected: selectedCategory == nil) {
                        selectedCategory = nil
                    }
                    ForEach(AuditEvent.AuditCategory.allCases) { cat in
                        CategoryChip(label: cat.rawValue, isSelected: selectedCategory == cat) {
                            selectedCategory = cat
                        }
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical, 8)

            Divider()

            // Event list
            if filteredEvents.isEmpty {
                Spacer()
                ContentUnavailableView(
                    auditService.events.isEmpty ? L.noSecurityEvents : L.noMatchingEvents,
                    systemImage: "shield.checkered",
                    description: Text(auditService.events.isEmpty ? L.securityEventsDescription : L.adjustFilter)
                )
                Spacer()
            } else {
                List {
                    ForEach(filteredEvents) { event in
                        AuditEventRow(event: event)
                            .onAppear {
                                if !event.isRead {
                                    auditService.markAsRead(id: event.id)
                                }
                            }
                    }
                }
                .listStyle(.plain)
            }
        }
        .task {
            await auditService.loadEvents()
        }
    }
}

// MARK: - Audit Event Row

private struct AuditEventRow: View {
    let event: AuditEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Category icon
            Image(systemName: event.category.icon)
                .font(.system(size: 16))
                .foregroundStyle(categoryColor)
                .frame(width: 28, height: 28)
                .background(categoryColor.opacity(0.1), in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                // Header: category + timestamp
                HStack {
                    Text(event.category.rawValue)
                        .font(.caption.bold())
                        .foregroundStyle(categoryColor)
                    Spacer()
                    Text(formattedTime)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.tertiary)
                    if !event.isRead {
                        Circle()
                            .fill(.blue)
                            .frame(width: 6, height: 6)
                    }
                }

                // Main content
                Text(eventDescription)
                    .font(.callout)
                    .lineLimit(2)

                // Detail: reason / path / detail
                if let detail = event.details["detail"] ?? event.details["reason"], !detail.isEmpty {
                    Text("\(L.detailLabel) \(detail)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var eventDescription: String {
        let agent = event.agentName ?? "Agent"
        switch event.eventType {
        case "audit.boundary_violation":
            let violationType = event.details["violation_type"] ?? "unknown"
            let attempted = event.details["attempted_path"] ?? L.unknownPath
            let tag = event.tagRole ?? event.details["tag_name"] ?? L.unknownTag
            return L.boundaryViolation(tag, agent, violationType, attempted)
        case "audit.access_denied", "audit.file_access":
            let path = event.details["path"] ?? L.unknownPath
            let command = event.details["command"] ?? "file_access"
            return L.accessDenied(agent, command, path)
        case "dialog.approval_request":
            let topic = event.details["topic"] ?? ""
            let owner = event.details["initiator_owner"] ?? ""
            return L.dialogApprovalEvent(owner, agent, topic)
        case "approval.requested":
            return L.approvalRequested(agent)
        default:
            return "\(agent): \(event.eventType)"
        }
    }

    private var categoryColor: Color {
        switch event.category {
        case .boundaryViolation: .red
        case .accessDenied: .orange
        case .dialogApproval: .blue
        case .approval: .purple
        case .other: .gray
        }
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: event.timestamp)
    }
}

// MARK: - Category Chip

private struct CategoryChip: View {
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
