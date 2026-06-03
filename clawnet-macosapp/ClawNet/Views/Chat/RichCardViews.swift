import SwiftUI

// MARK: - Approval Card

/// Displays an operation approval request with approve/reject actions.
struct ApprovalCardView: View {
    let approval: ApprovalRequest
    var onApprove: (() -> Void)?
    var onReject: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "shield.checkered")
                    .foregroundStyle(.orange)
                Text(L.approvalRequest)
                    .font(.subheadline.bold())
                Spacer()
                approvalStatusBadge
            }

            Text(approval.operationType)
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            Text(approval.description)
                .font(.subheadline)

            if approval.status == .pending {
                HStack(spacing: 8) {
                    Spacer()
                    Button(L.reject, role: .destructive) { onReject?() }
                        .controlSize(.small)
                    Button(L.approve) { onApprove?() }
                        .controlSize(.small)
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 300)
        .background(.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.secondary.opacity(0.15)))
    }

    private var approvalStatusBadge: some View {
        Group {
            switch approval.status {
            case .pending:
                Text(L.pending).font(.caption2.bold()).foregroundStyle(.orange)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            case .approved:
                Text(L.approved).font(.caption2.bold()).foregroundStyle(.green)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            case .rejected:
                Text(L.rejected).font(.caption2.bold()).foregroundStyle(.red)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            case .modified:
                Text(L.modified).font(.caption2.bold()).foregroundStyle(.blue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            }
        }
    }
}

// MARK: - Task Progress Card

/// Displays task execution progress with stage and percentage.
struct TaskProgressCardView: View {
    let progress: TaskProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "gearshape.2")
                    .foregroundStyle(.blue)
                Text(L.taskInProgress)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(Int(progress.progress * 100))%")
                    .font(.caption.monospacedDigit().bold())
                    .foregroundStyle(.blue)
            }

            Text(progress.stage)
                .font(.caption)
                .foregroundStyle(.secondary)

            ProgressView(value: progress.progress)
                .tint(.blue)

            if let details = progress.details, !details.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(details.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        HStack {
                            Text(key).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text(value).font(.caption2)
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(12)
        .frame(maxWidth: 280)
        .background(.blue.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.blue.opacity(0.15)))
    }
}

// MARK: - Task Result Card

/// Displays completed task results with success/failure status.
struct TaskResultCardView: View {
    let result: TaskResult
    @State private var showDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(result.success ? .green : .red)
                Text(result.success ? L.taskCompleted : L.taskFailed)
                    .font(.subheadline.bold())
                Spacer()
            }

            Text(result.summary)
                .font(.subheadline)

            if let error = result.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
            }

            if let details = result.details {
                DisclosureGroup(L.details, isExpanded: $showDetails) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let files = details.filesProcessed {
                            HStack {
                                Text(L.filesProcessed).font(.caption).foregroundStyle(.secondary)
                                Text("\(files)").font(.caption)
                            }
                        }
                        if let logs = details.logs, !logs.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L.logs).font(.caption).foregroundStyle(.secondary)
                                ForEach(logs.prefix(10), id: \.self) { log in
                                    Text(log)
                                        .font(.system(.caption2, design: .monospaced))
                                        .lineLimit(2)
                                }
                            }
                        }
                    }
                }
                .font(.caption)
            }
        }
        .padding(12)
        .frame(maxWidth: 300)
        .background((result.success ? Color.green : Color.red).opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke((result.success ? Color.green : Color.red).opacity(0.15)))
    }
}

// MARK: - Dialog Request Card

/// Initiator's view: status-only, no action buttons. Shows topic, agents, and live status.
struct DialogRequestCardView: View {
    let rawData: [String: Any]

    private var topic: String { rawData["topic"] as? String ?? "" }
    private var status: String { rawData["status"] as? String ?? "pending" }
    private var myAgentName: String {
        (rawData["myAgent"] as? [String: Any])?["displayName"] as? String ?? L.myAssistant
    }
    private var targetAgentName: String {
        (rawData["targetAgent"] as? [String: Any])?["displayName"] as? String ?? L.otherAgent
    }
    private var contactTagDisplayName: String? {
        (rawData["contactTag"] as? [String: Any])?["displayName"] as? String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 14))
                    .foregroundStyle(.blue)
                Text(L.dialogRequestSent)
                    .font(.subheadline.bold())
                Spacer()
            }

            Text(L.authRequestSent)
                .font(.caption)
                .foregroundStyle(.secondary)

            if !topic.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L.topic)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(topic)
                        .font(.caption)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                }
            }

            HStack(spacing: 4) {
                Text(myAgentName)
                    .font(.caption.bold())
                    .foregroundStyle(.blue)
                Image(systemName: "arrow.right")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text(targetAgentName)
                    .font(.caption.bold())
                    .foregroundStyle(.purple)
                if let tagName = contactTagDisplayName {
                    Text(tagName)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
                        .foregroundStyle(.purple)
                }
            }

            dialogStatusBadge
        }
        .padding(12)
        .frame(maxWidth: 280)
        .background(.blue.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.blue.opacity(0.15)))
    }

    private var dialogStatusBadge: some View {
        let config: (bg: Color, fg: Color, icon: String, text: String, spinning: Bool) = switch status {
        case "confirmed":
            (.green.opacity(0.1), .green, "checkmark.circle.fill", L.dialogConfirmed, false)
        case "completed":
            (.green.opacity(0.1), .green, "checkmark.seal.fill", L.dialogCompleted, false)
        case "cancelled":
            (.red.opacity(0.1), .red, "xmark.circle.fill", L.dialogRejected, false)
        default:
            (.orange.opacity(0.1), .orange, "clock", L.waitingAuth, true)
        }
        return HStack(spacing: 4) {
            if config.spinning {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: config.icon)
                    .font(.system(size: 12))
                    .foregroundStyle(config.fg)
            }
            Text(config.text)
                .font(.caption2.bold())
                .foregroundStyle(config.fg)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(config.bg, in: RoundedRectangle(cornerRadius: 4))
    }
}

// MARK: - Dialog Approval Card

/// Responder's view with approve/reject actions (only when pending).
struct DialogApprovalCardView: View {
    let rawData: [String: Any]
    var onApprove: (() -> Void)?
    var onReject: (() -> Void)?

    private var topic: String { rawData["topic"] as? String ?? "" }
    private var status: String { rawData["status"] as? String ?? "pending" }
    private var initiatorAgentName: String {
        (rawData["initiatorAgent"] as? [String: Any])?["displayName"] as? String ?? L.otherAgent
    }
    private var initiatorOwnerName: String {
        (rawData["initiatorOwner"] as? [String: Any])?["displayName"] as? String ?? L.otherParty
    }
    private var myAgentName: String {
        (rawData["myAgent"] as? [String: Any])?["displayName"] as? String ?? L.myAssistant
    }
    private var contactTagDisplayName: String? {
        (rawData["contactTag"] as? [String: Any])?["displayName"] as? String
    }
    private var isPending: Bool { status == "pending" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "shield")
                    .font(.system(size: 14))
                    .foregroundStyle(.orange)
                Text(L.dialogAuthRequest)
                    .font(.subheadline.bold())
                Spacer()
                if let tagName = contactTagDisplayName {
                    Text(tagName)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
                        .foregroundStyle(.orange)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                infoRow(label: L.initiator, value: L.agentOf(initiatorOwnerName, initiatorAgentName))
                if !topic.isEmpty {
                    infoRow(label: L.topic, value: topic)
                }
                infoRow(label: L.myAgent, value: myAgentName)
            }

            if isPending {
                HStack(spacing: 8) {
                    Spacer()
                    Button(action: { onReject?() }) {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark")
                                .font(.system(size: 11))
                            Text(L.reject)
                        }
                    }
                    .controlSize(.small)
                    .buttonStyle(.bordered)
                    .tint(.red)

                    Button(action: { onApprove?() }) {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11))
                            Text(L.authorizeDialog)
                        }
                    }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
            } else {
                approvalStatusBadge
            }
        }
        .padding(12)
        .frame(maxWidth: 300)
        .background(.orange.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.orange.opacity(0.15)))
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 55, alignment: .trailing)
            Text(value)
                .font(.caption)
                .foregroundStyle(.primary)
        }
    }

    private var approvalStatusBadge: some View {
        let isApproved = status == "approved" || status == "completed"
        return HStack(spacing: 4) {
            Image(systemName: isApproved ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(isApproved ? .green : .red)
            Text(isApproved ? L.authorizedInProgress : L.rejected)
                .font(.caption2.bold())
                .foregroundStyle(isApproved ? .green : .red)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background((isApproved ? Color.green : Color.red).opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
    }
}

// MARK: - Intent Authorization Card

/// Initiator's side: asks user to approve/deny before A2A dialog is created.
struct IntentAuthorizationCardView: View {
    let rawData: [String: Any]
    var onApprove: (() -> Void)?
    var onDeny: (() -> Void)?

    private var authorizationId: String { rawData["authorizationId"] as? String ?? "" }
    private var agentName: String { rawData["agentName"] as? String ?? L.myAssistant }
    private var status: String { rawData["status"] as? String ?? "pending" }
    private var targets: [[String: String]] {
        rawData["targets"] as? [[String: String]] ?? []
    }
    private var isPending: Bool { status == "pending" }
    private var isMainAgent: Bool { rawData["isMainAgent"] as? Bool ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isMainAgent && isPending {
                // Main agent security warning — auto-deny
                HStack(spacing: 6) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 14))
                        .foregroundStyle(.red)
                    Text(L.securityReminder)
                        .font(.subheadline.bold())
                    Spacer()
                    intentStatusBadge
                }

                Text(L.mainAgentSecurityNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack {
                    Spacer()
                    Button(action: { onDeny?() }) {
                        Text(L.understood)
                    }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
                }
            } else {
                // Normal authorization flow
                HStack(spacing: 6) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 14))
                        .foregroundStyle(.orange)
                    Text(L.dialogAuthorizationRequest)
                        .font(.subheadline.bold())
                    Spacer()
                    intentStatusBadge
                }

                Text(L.agentWantsToDialog(agentName))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                // Target list
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(targets.enumerated()), id: \.offset) { _, target in
                        HStack(spacing: 6) {
                            Image(systemName: "person.circle")
                                .font(.system(size: 12))
                                .foregroundStyle(.purple)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(target["target_user_name"] ?? L.unknownUser)
                                        .font(.caption.bold())
                                    if let tagName = target["contact_tag_display_name"], !tagName.isEmpty {
                                        Text(tagName)
                                            .font(.caption2)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 1)
                                            .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
                                            .foregroundStyle(.purple)
                                    }
                                }
                                Text(target["topic"] ?? "")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                    }
                }

                if isPending {
                    HStack(spacing: 8) {
                        Spacer()
                        Button(action: { onDeny?() }) {
                            HStack(spacing: 4) {
                                Image(systemName: "xmark")
                                    .font(.system(size: 11))
                                Text(L.reject)
                            }
                        }
                        .controlSize(.small)
                        .buttonStyle(.bordered)
                        .tint(.red)

                        Button(action: { onApprove?() }) {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11))
                                Text(L.authorize)
                            }
                        }
                        .controlSize(.small)
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 300)
        .background(.orange.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.orange.opacity(0.15)))
    }

    private var intentStatusBadge: some View {
        Group {
            switch status {
            case "approved":
                Text(L.authorized).font(.caption2.bold()).foregroundStyle(.green)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            case "denied":
                Text(L.denied).font(.caption2.bold()).foregroundStyle(.red)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            default:
                Text(L.pendingAuth).font(.caption2.bold()).foregroundStyle(.orange)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
            }
        }
    }
}

// MARK: - Generic Rich Card

/// Generic rich card supporting file_card, reference_card, execution_log, citation_card types.
struct RichCardView: View {
    let content: MessageContent
    @State private var showLog = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let name = content.name {
                HStack {
                    Image(systemName: cardIcon)
                        .foregroundStyle(.secondary)
                    Text(name)
                        .font(.subheadline.bold())
                        .lineLimit(2)
                }
            }

            if let text = content.text {
                if content.mimeType == "execution_log" || content.mimeType == "code" {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(text)
                            .font(.system(.caption, design: .monospaced))
                            .padding(8)
                    }
                    .frame(maxHeight: 120)
                    .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                } else {
                    Text(text)
                        .font(.subheadline)
                }
            }

            if let url = content.url {
                Link(url, destination: URL(string: url) ?? URL(string: "about:blank")!)
                    .font(.caption)
            }
        }
        .padding(12)
        .frame(maxWidth: 280)
        .background(.secondary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.secondary.opacity(0.15)))
    }

    private var cardIcon: String {
        switch content.mimeType {
        case "file_card": return "doc"
        case "reference_card": return "link"
        case "execution_log": return "terminal"
        case "citation_card": return "quote.bubble"
        default: return "rectangle.on.rectangle"
        }
    }
}
