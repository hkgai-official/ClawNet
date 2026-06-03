import SwiftUI

/// Displays a multi-user discovery task with progress tracking, query lists, and actions.
/// Reads all data from rawData dictionary (server snake_case keys).
struct DiscoveryTaskCardView: View {
    let rawData: [String: Any]
    var onConfirm: ((String) -> Void)?
    var onCancel: ((String) -> Void)?

    // MARK: - Data Extraction

    private var taskId: String { rawData["task_id"] as? String ?? "" }
    private var status: String { rawData["status"] as? String ?? "pending" }
    private var originalIntent: String { rawData["original_intent"] as? String ?? "" }
    private var maxHops: Int { rawData["max_hops"] as? Int ?? 5 }
    private var currentHopCount: Int { rawData["current_hop_count"] as? Int ?? 0 }

    private var pendingQueries: [[String: Any]] {
        rawData["pending_queries"] as? [[String: Any]] ?? []
    }
    private var activeSessions: [[String: Any]] {
        rawData["active_sessions"] as? [[String: Any]] ?? []
    }
    private var completedResults: [[String: Any]] {
        rawData["completed_results"] as? [[String: Any]] ?? []
    }

    private var isActive: Bool { status == "pending" || status == "running" }
    private var isCompleted: Bool { status == "completed" || status == "completing" }
    private var isFailed: Bool { status == "failed" || status == "cancelled" }

    private var totalItems: Int { completedResults.count + activeSessions.count + pendingQueries.count }
    private var progressPercent: Double {
        guard totalItems > 0 else { return 0 }
        return Double(completedResults.count) / Double(totalItems)
    }

    private var statusColor: Color {
        if isCompleted { return Color(hex: 0x52C41A) }
        if isFailed { return Color(hex: 0xFF4D4F) }
        return SDColor.agentPrimary // purple for active/pending
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerSection
            if !originalIntent.isEmpty { intentSection }
            progressSection
            if !completedResults.isEmpty { completedSection }
            if !activeSessions.isEmpty { activeSection }
            if !pendingQueries.isEmpty { pendingSection }
            actionButtons
        }
        .padding(12)
        .frame(maxWidth: 320)
        .background(statusColor.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(statusColor.opacity(0.15)))
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.3.sequence")
                .font(.system(size: 14))
                .foregroundStyle(statusColor)
            Text(L.multiUserDiscovery)
                .font(.subheadline.bold())
            Spacer()
            statusBadge
        }
    }

    private var statusBadge: some View {
        let config: (text: String, color: Color) = switch status {
        case "pending": (L.pendingConfirm, .orange)
        case "running": (L.running, SDColor.agentPrimary)
        case "completing": (L.summarizing, SDColor.agentPrimary)
        case "completed": (L.completed, Color(hex: 0x52C41A))
        case "cancelled": (L.cancelled, Color(hex: 0xFF4D4F))
        case "failed": (L.failed, Color(hex: 0xFF4D4F))
        default: (status, .secondary)
        }
        return Text(config.text)
            .font(.caption2.bold())
            .foregroundStyle(config.color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(config.color.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
    }

    // MARK: - Intent

    private var intentSection: some View {
        Text(originalIntent)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(3)
    }

    // MARK: - Progress Bar

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(L.completedOf(completedResults.count, totalItems))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(progressPercent * 100))%")
                    .font(.caption2.monospacedDigit().bold())
                    .foregroundStyle(statusColor)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(statusColor.opacity(0.12))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(statusColor)
                        .frame(width: geo.size.width * progressPercent, height: 4)
                }
            }
            .frame(height: 4)
        }
    }

    // MARK: - Completed Results

    private var completedSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(completedResults.enumerated()), id: \.offset) { _, item in
                let owner = item["target_owner"] as? String ?? "?"
                let summary = item["summary"] as? String ?? ""
                let itemStatus = item["status"] as? String ?? "completed"
                let isSuccess = itemStatus == "completed" || itemStatus == "resolved"

                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(isSuccess ? Color(hex: 0x52C41A) : Color(hex: 0xFF4D4F))
                        .frame(width: 14)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(owner)
                            .font(.caption.bold())
                        if !summary.isEmpty {
                            Text(summary)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Active Sessions

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(activeSessions.enumerated()), id: \.offset) { _, item in
                let owner = item["target_owner"] as? String ?? "?"
                let topic = item["topic"] as? String ?? ""

                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                        .frame(width: 14)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(L.contacting(owner))
                            .font(.caption.bold())
                            .foregroundStyle(SDColor.agentPrimary)
                        if !topic.isEmpty {
                            Text(topic)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Pending Queries

    private var pendingSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(pendingQueries.enumerated()), id: \.offset) { _, item in
                let owner = item["target_owner"] as? String ?? "?"
                let topic = item["topic"] as? String ?? ""

                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .frame(width: 14)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(L.pendingContact(owner))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if !topic.isEmpty {
                            Text(topic)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Action Buttons

    @ViewBuilder
    private var actionButtons: some View {
        if isActive {
            HStack(spacing: 8) {
                Spacer()
                if status == "pending" {
                    Button(action: { onConfirm?(taskId) }) {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11))
                            Text(L.confirmExecute)
                        }
                    }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .tint(SDColor.agentPrimary)
                }
                Button(role: .destructive, action: { onCancel?(taskId) }) {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11))
                        Text(L.cancel)
                    }
                }
                .controlSize(.small)
            }
        }
    }
}
