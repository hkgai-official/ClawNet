import SwiftUI
import Textual

/// A single message bubble in the chat view — WeChat-style with asymmetric corners.
struct MessageBubble: View {
    let message: ChatMessage
    var showAvatar: Bool = true
    var currentUserId: String = ""
    var isAgentDialog: Bool = false
    var onDialogApprove: ((String) -> Void)?
    var onDialogReject: ((String) -> Void)?
    var onDiscoveryConfirm: ((String) -> Void)?
    var onDiscoveryCancel: ((String) -> Void)?
    var onIntentAuthorize: ((String) -> Void)?
    var onIntentDeny: ((String) -> Void)?

    private var isUser: Bool {
        if currentUserId.isEmpty {
            return message.sender.type == .human
        }
        let sid = message.sender.id
        if sid == currentUserId { return true }
        // a2a: 我的 agent 也视为"我方"，放右侧（仅限 agent 对话）
        if isAgentDialog, let ownerId = message.sender.ownerId, ownerId == currentUserId {
            return true
        }
        if sid == "unknown" || sid == "restored" || sid.hasPrefix("temp-") {
            return message.sender.type == .human
        }
        return false
    }
    private var isAgent: Bool { message.sender.type == .agent }
    private var isSystem: Bool { message.contentType == .system }

    var body: some View {
        if isSystem {
            systemMessageView
        } else {
            regularMessageView
        }
    }

    // MARK: - System Message (centered pill)

    private var systemMessageView: some View {
        HStack {
            Spacer()
            Text(message.textContent.isEmpty ? L.systemMessage : message.textContent)
                .font(SDFont.small)
                .foregroundStyle(SDColor.textTertiary)
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.xs)
                .background(SDColor.bgSecondary, in: Capsule())
            Spacer()
        }
        .padding(.vertical, SDSpacing.md)
    }

    // MARK: - Regular Message

    /// A2A 对话中"我的 Agent"也需要显示头像和名称
    private var showSenderIdentity: Bool {
        showAvatar && (!isUser || isAgentDialog)
    }

    private var regularMessageView: some View {
        HStack(alignment: .top, spacing: SDSpacing.md) {
            if isUser { Spacer(minLength: 60) }

            // Avatar (left side for others)
            if !isUser && showSenderIdentity {
                AvatarWithBadge(
                    name: message.sender.name,
                    type: message.sender.type,
                    size: 36
                )
            } else if !isUser {
                Spacer().frame(width: 36)
            }

            // Content column
            VStack(alignment: isUser ? .trailing : .leading, spacing: SDSpacing.xs) {
                // Sender name + agent badge
                if showSenderIdentity {
                    HStack(spacing: SDSpacing.xs) {
                        if isAgent, let ownerName = message.sender.ownerName {
                            Text("\(ownerName) 的 \(message.sender.name)")
                                .font(SDFont.small)
                                .foregroundStyle(SDColor.textSecondary)
                        } else {
                            Text(message.sender.name)
                                .font(SDFont.small)
                                .foregroundStyle(SDColor.textSecondary)
                        }
                        if isAgent {
                            Text("AI")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(SDColor.agentPrimary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    .padding(isUser ? .trailing : .leading, SDSpacing.xs)
                }

                // Bubble
                messageContent
                    .contextMenu {
                        if !message.textContent.isEmpty {
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(message.textContent, forType: .string)
                            } label: {
                                Label(L.copyText, systemImage: "doc.on.doc")
                            }
                        }
                    }

                // Timestamp + status
                HStack(spacing: SDSpacing.xs) {
                    if isUser {
                        statusIcon
                    }
                    Text(message.timestamp, style: .time)
                        .font(SDFont.caption)
                        .foregroundStyle(SDColor.textTertiary)
                    if !isUser {
                        statusIcon
                    }
                }
                .padding(.horizontal, SDSpacing.xs)
            }

            // Avatar (right side for "my agent" in A2A)
            if isUser && isAgentDialog && showAvatar {
                AvatarWithBadge(
                    name: message.sender.name,
                    type: message.sender.type,
                    size: 36
                )
            }

            if !isUser { Spacer(minLength: 60) }
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.xxs)
    }

    // MARK: - Status Icon

    @ViewBuilder
    private var statusIcon: some View {
        switch message.status {
        case .sending:
            Image(systemName: "clock")
                .font(.system(size: 10))
                .foregroundStyle(SDColor.textTertiary)
        case .sent:
            Image(systemName: "checkmark")
                .font(.system(size: 10))
                .foregroundStyle(SDColor.textTertiary)
        case .read:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 10))
                .foregroundStyle(SDColor.primary)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 10))
                .foregroundStyle(SDColor.error)
        case .none:
            EmptyView()
        }
    }

    // MARK: - Message Content

    @ViewBuilder
    private var messageContent: some View {
        switch message.contentType {
        case .text:
            textBubble

        case .image:
            ImageMessageView(content: message.content, isUser: isUser)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.md))

        case .video:
            VideoMessageView(content: message.content, isUser: isUser)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.md))

        case .voice:
            VoiceMessageView(content: message.content, isUser: isUser)

        case .file:
            FileMessageView(content: message.content, isUser: isUser)

        case .richCard:
            if let raw = message.content.rawData,
               raw["cardType"] as? String == "intent_authorization" {
                let authId = raw["authorizationId"] as? String ?? ""
                IntentAuthorizationCardView(
                    rawData: raw,
                    onApprove: { onIntentAuthorize?(authId) },
                    onDeny: { onIntentDeny?(authId) }
                )
                .background(SDColor.bgWhite)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
            } else {
                RichCardView(content: message.content)
                    .background(SDColor.bgWhite)
                    .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                    .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
            }

        case .taskProgress:
            taskProgressCard
                .background(SDColor.bgWhite)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)

        case .taskResult:
            taskResultCard
                .background(SDColor.bgWhite)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)

        case .dialogRequest:
            if let raw = message.content.rawData {
                let targetOwnerId = (raw["targetOwner"] as? [String: Any])?["id"] as? String
                if targetOwnerId == currentUserId {
                    EmptyView()
                } else {
                    DialogRequestCardView(rawData: raw)
                        .background(SDColor.bgWhite)
                        .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                        .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
                }
            } else {
                EmptyView()
            }

        case .dialogApproval:
            if let raw = message.content.rawData {
                let initiatorOwnerId = (raw["initiatorOwner"] as? [String: Any])?["id"] as? String
                if initiatorOwnerId == currentUserId {
                    EmptyView()
                } else {
                    let sessionId = raw["sessionId"] as? String ?? ""
                    DialogApprovalCardView(
                        rawData: raw,
                        onApprove: { onDialogApprove?(sessionId) },
                        onReject: { onDialogReject?(sessionId) }
                    )
                    .background(SDColor.bgWhite)
                    .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                    .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
                }
            } else {
                EmptyView()
            }

        case .approvalRequest:
            ApprovalCardView(approval: ApprovalRequest(
                id: message.content.id ?? message.id,
                operationType: message.content.name ?? L.approvalRequest,
                description: message.content.text ?? "",
                status: .pending
            ))
            .background(SDColor.bgWhite)
            .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
            .shadow(color: .black.opacity(0.06), radius: 1, y: 1)

        case .discoveryProgress:
            if let raw = message.content.rawData {
                DiscoveryTaskCardView(
                    rawData: raw,
                    onConfirm: { taskId in onDiscoveryConfirm?(taskId) },
                    onCancel: { taskId in onDiscoveryCancel?(taskId) }
                )
                .background(SDColor.bgWhite)
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.lg))
                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
            } else {
                EmptyView()
            }

        case .dialogStatus:
            Text(message.textContent.isEmpty ? "[\(message.contentType.rawValue)]" : message.textContent)
                .font(.system(size: 13))
                .foregroundStyle(SDColor.textSecondary)
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.md)
                .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))

        case .system:
            EmptyView() // handled above
        }
    }

    // MARK: - Task Cards (from rawData)

    private var taskProgressCard: some View {
        let raw = message.content.rawData
        return TaskProgressCardView(progress: TaskProgress(
            taskId: raw?["task_id"] as? String ?? message.id,
            stage: raw?["stage"] as? String ?? message.content.name ?? L.processing,
            progress: Double(raw?["progress"] as? Int ?? 0) / 100.0,
            details: raw?["details"] as? [String: String]
        ))
    }

    private var taskResultCard: some View {
        let raw = message.content.rawData
        return TaskResultCardView(result: TaskResult(
            taskId: raw?["task_id"] as? String ?? message.id,
            success: raw?["success"] as? Bool ?? (message.content.mimeType != "error"),
            summary: raw?["summary"] as? String ?? message.content.text ?? L.taskCompleted,
            error: raw?["error"] as? String
        ))
    }

    // MARK: - Text Bubble (WeChat-style)

    /// Threshold above which markdown is split into blocks for lazy rendering.
    private static let blockRenderThreshold = 3000

    private var textBubble: some View {
        Group {
            if message.textContent.count > Self.blockRenderThreshold {
                chunkedMarkdownContent
            } else {
                singleMarkdownContent
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(isUser ? SDColor.ownBubble : SDColor.otherBubble)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: isUser ? SDRadius.lg : SDRadius.xs,
                bottomLeadingRadius: SDRadius.lg,
                bottomTrailingRadius: SDRadius.lg,
                topTrailingRadius: isUser ? SDRadius.xs : SDRadius.lg
            )
        )
        .shadow(color: isUser ? .clear : .black.opacity(0.06), radius: 1, y: 1)
    }

    private var singleMarkdownContent: some View {
        StructuredText(markdown: message.textContent)
            .font(.system(size: 14))
            .foregroundStyle(isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText)
            .textual.inlineStyle(isUser ? .clawNetOwn : .clawNetOther)
            .textual.codeBlockStyle(ClawNetCodeBlockStyle(textColor: isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText))
            .textual.blockQuoteStyle(ClawNetBlockQuoteStyle(barColor: (isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText).opacity(0.3)))
    }

    private var chunkedMarkdownContent: some View {
        let blocks = splitMarkdownIntoBlocks(message.textContent)
        return LazyVStack(alignment: .leading, spacing: 8) {
            ForEach(blocks) { block in
                StructuredText(markdown: block.content)
                    .font(.system(size: 14))
                    .foregroundStyle(isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText)
                    .textual.inlineStyle(isUser ? .clawNetOwn : .clawNetOther)
                    .textual.codeBlockStyle(ClawNetCodeBlockStyle(textColor: isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText))
                    .textual.blockQuoteStyle(ClawNetBlockQuoteStyle(barColor: (isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText).opacity(0.3)))
            }
        }
    }
}

extension MessageBubble: Equatable {
    static func == (lhs: MessageBubble, rhs: MessageBubble) -> Bool {
        lhs.message == rhs.message
            && lhs.showAvatar == rhs.showAvatar
            && lhs.currentUserId == rhs.currentUserId
            && lhs.isAgentDialog == rhs.isAgentDialog
    }
}

// MARK: - Previews

#Preview("User Message") {
    MessageBubble(message: PreviewData.messages[0])
        .padding()
        .background(SDColor.bgPrimary)
}

#Preview("Agent Message") {
    MessageBubble(message: PreviewData.messages[1])
        .padding()
        .background(SDColor.bgPrimary)
}

#Preview("Sending Message") {
    MessageBubble(message: PreviewData.messages[2])
        .padding()
        .background(SDColor.bgPrimary)
}
