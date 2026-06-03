import SwiftUI
import Textual
import UniformTypeIdentifiers

/// Scrollable list of chat messages with streaming support and date separators.
///
/// Uses a **flipped ScrollView** so that LazyVStack renders from the visual
/// bottom on the very first frame — no scrollTo hacks, no jump.
/// The outer ScrollView is vertically flipped via `scaleEffect(y: -1)`,
/// and every child is flipped back so content reads normally.
struct MessageListView: View {
    let messages: [ChatMessage]
    let streamingContent: String?
    let isLoading: Bool
    var currentUserId: String = ""
    var isAgentDialog: Bool = false
    var activeRunId: String?
    var streamingSender: Participant?
    var onDialogApprove: ((String) -> Void)?
    var onDialogReject: ((String) -> Void)?
    var onDiscoveryConfirm: ((String) -> Void)?
    var onDiscoveryCancel: ((String) -> Void)?
    var onIntentAuthorize: ((String) -> Void)?
    var onIntentDeny: ((String) -> Void)?

    private var shouldShowStreaming: Bool {
        guard streamingContent != nil else { return false }
        guard let runId = activeRunId else { return false }
        return messages.last?.id != runId
    }

    /// A2A 对话中，判断流式输出的 sender 是否属于"我方"
    private var streamingSenderIsUser: Bool {
        guard isAgentDialog, let sender = streamingSender else { return false }
        if sender.id == currentUserId { return true }
        if let ownerId = sender.ownerId, ownerId == currentUserId { return true }
        return false
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if shouldShowStreaming {
                    StreamingBubble(
                        content: streamingContent ?? "",
                        sender: streamingSender,
                        isUser: streamingSenderIsUser
                    )
                    .id("streaming-indicator")
                    .scaleEffect(x: 1, y: -1)
                }

                // Messages in reverse chronological order (newest first in data,
                // which becomes visual bottom after the outer flip).
                ForEach(Array(messages.enumerated().reversed()), id: \.element.id) { index, message in
                    MessageBubble(
                        message: message,
                        showAvatar: shouldShowAvatar(at: index),
                        currentUserId: currentUserId,
                        isAgentDialog: isAgentDialog,
                        onDialogApprove: onDialogApprove,
                        onDialogReject: onDialogReject,
                        onDiscoveryConfirm: onDiscoveryConfirm,
                        onDiscoveryCancel: onDiscoveryCancel,
                        onIntentAuthorize: onIntentAuthorize,
                        onIntentDeny: onIntentDeny
                    )
                    .equatable()
                    .scaleEffect(x: 1, y: -1)

                    if shouldShowDateSeparator(at: index) {
                        DateSeparator(date: message.timestamp)
                            .scaleEffect(x: 1, y: -1)
                    }
                }

                // Loading indicator — last in data order = visual top after flip
                if isLoading {
                    HStack {
                        Spacer()
                        Text(L.loading)
                            .font(SDFont.small)
                            .foregroundStyle(SDColor.textTertiary)
                        Spacer()
                    }
                    .padding(.vertical, SDSpacing.lg)
                    .scaleEffect(x: 1, y: -1)
                }
            }
            .padding(.vertical, SDSpacing.md)
        }
        .scrollIndicators(.never)
        .scaleEffect(x: 1, y: -1)
        .textual.textSelection(.enabled)
        .background(SDColor.bgPrimary)
    }

    private func shouldShowDateSeparator(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1].timestamp
        let curr = messages[index].timestamp
        return !Calendar.current.isDate(prev, inSameDayAs: curr)
    }

    private func shouldShowAvatar(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1]
        let curr = messages[index]
        if prev.sender.id != curr.sender.id { return true }
        let cardTypes: Set<ChatMessage.MessageContentType> = [
            .system, .dialogRequest, .dialogApproval, .dialogStatus,
            .taskProgress, .taskResult, .approvalRequest, .richCard
        ]
        if cardTypes.contains(prev.contentType) && !cardTypes.contains(curr.contentType) {
            return true
        }
        return false
    }
}

// MARK: - Date Separator

/// Centered date pill matching Web's date separator design.
struct DateSeparator: View {
    let date: Date

    var body: some View {
        HStack {
            Spacer()
            Text(formatDateSeparator(date))
                .font(SDFont.caption)
                .foregroundStyle(SDColor.textTertiary)
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.xs)
                .background(SDColor.bgSecondary, in: Capsule())
            Spacer()
        }
        .padding(.vertical, SDSpacing.md)
    }

    private func formatDateSeparator(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return L.today }
        if calendar.isDateInYesterday(date) { return L.yesterday }
        // Check day before yesterday
        if let twoDaysAgo = calendar.date(byAdding: .day, value: -2, to: Date()),
           calendar.isDate(date, inSameDayAs: twoDaysAgo) {
            return L.dayBeforeYesterday
        }
        let formatter = DateFormatter()
        let isCurrentYear = calendar.isDate(date, equalTo: Date(), toGranularity: .year)
        formatter.dateFormat = L.dateFormat(isCurrentYear)
        return formatter.string(from: date)
    }
}

// MARK: - Streaming Bubble

/// Animated bubble for a message being streamed — with blinking green cursor.
struct StreamingBubble: View {
    let content: String
    var sender: Participant?
    var isUser: Bool = false
    @State private var cursorVisible = true

    private var avatarName: String { sender?.name ?? "AI" }
    private var avatarType: Participant.ParticipantType { sender?.type ?? .agent }

    private var bubbleBg: Color { isUser ? SDColor.ownBubble : SDColor.otherBubble }
    private var bubbleText: Color { isUser ? SDColor.ownBubbleText : SDColor.otherBubbleText }

    var body: some View {
        HStack(alignment: .top, spacing: SDSpacing.md) {
            if isUser { Spacer(minLength: 60) }

            if !isUser {
                AvatarWithBadge(name: avatarName, type: avatarType, size: 36)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: SDSpacing.xs) {
                // Bubble with cursor
                HStack(alignment: .bottom, spacing: 0) {
                    StructuredText(markdown: content)
                        .font(.system(size: 14))
                        .foregroundStyle(bubbleText)
                        .textual.inlineStyle(isUser ? .clawNetOwn : .clawNetOther)
                        .textual.codeBlockStyle(ClawNetCodeBlockStyle(textColor: bubbleText))
                        .textual.blockQuoteStyle(ClawNetBlockQuoteStyle(barColor: bubbleText.opacity(0.2)))

                    Rectangle()
                        .fill(SDColor.primary)
                        .frame(width: 2, height: 16)
                        .opacity(cursorVisible ? 1 : 0)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: cursorVisible)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bubbleBg)
                .clipShape(
                    UnevenRoundedRectangle(
                        topLeadingRadius: isUser ? SDRadius.lg : SDRadius.xs,
                        bottomLeadingRadius: SDRadius.lg,
                        bottomTrailingRadius: SDRadius.lg,
                        topTrailingRadius: isUser ? SDRadius.xs : SDRadius.lg
                    )
                )
                .shadow(color: isUser ? .clear : .black.opacity(0.06), radius: 1, y: 1)

                HStack(spacing: SDSpacing.xs) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(L.generating)
                        .font(SDFont.caption)
                        .foregroundStyle(SDColor.textTertiary)
                }
            }

            if isUser {
                AvatarWithBadge(name: avatarName, type: avatarType, size: 36)
            }

            if !isUser { Spacer(minLength: 60) }
        }
        .padding(.horizontal, SDSpacing.xl)
        .padding(.vertical, SDSpacing.xxs)
        .onAppear { cursorVisible = false }
    }
}

// MARK: - Chat Input Bar

/// Text input bar for composing messages with file attachment, emoji, and voice support.
struct ChatInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    var onAttachFile: (([URL]) -> Void)?

    @State private var pendingFiles: [URL] = []
    @State private var isUploading = false
    @State private var editorHeight: CGFloat = ChatTextEditor.minEditorHeight
    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingFiles.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            // Pending file previews
            if !pendingFiles.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SDSpacing.md) {
                        ForEach(pendingFiles, id: \.absoluteString) { url in
                            FilePreviewChip(url: url) {
                                pendingFiles.removeAll { $0 == url }
                            }
                        }
                    }
                    .padding(.horizontal, SDSpacing.xl)
                    .padding(.vertical, SDSpacing.sm)
                }
                Rectangle()
                    .fill(SDColor.divider)
                    .frame(height: 1)
            }

            // Toolbar row
            HStack(spacing: SDSpacing.xxs) {
                toolbarButton(icon: "paperclip", help: L.sendFile, action: openFilePicker)
                toolbarButton(icon: "photo", help: L.sendImage, action: openImagePicker)
                toolbarButton(icon: "face.smiling", help: L.emoji, action: {
                    NSApp.orderFrontCharacterPalette(nil)
                })
                Spacer()
            }
            .padding(.horizontal, SDSpacing.lg)
            .padding(.top, SDSpacing.md)

            // Input row
            HStack(alignment: .bottom, spacing: SDSpacing.lg) {
                // Multi-line text editor: Enter sends, Shift+Enter inserts newline
                ChatTextEditor(text: $text, isFocused: $isFocused, onSubmit: {
                    guard !isStreaming else { return false }
                    handleSend()
                    return true
                }, dynamicHeight: $editorHeight)
                .frame(height: editorHeight)
                .background(
                    RoundedRectangle(cornerRadius: SDRadius.md)
                        .fill(isFocused ? SDColor.bgWhite : SDColor.bgSecondary)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: SDRadius.md)
                        .stroke(isFocused ? SDColor.primary : Color.clear, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: SDRadius.md))

                // Send / Stop button
                if isStreaming {
                    Button(action: onStop) {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(SDColor.error)
                    }
                    .buttonStyle(.plain)
                    .help(L.stopGenerating)
                } else if isUploading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 40, height: 40)
                } else {
                    Button(action: handleSend) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(
                                canSend ? SDColor.primary : SDColor.textDisabled,
                                in: RoundedRectangle(cornerRadius: SDRadius.md)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .help(L.send)
                }
            }
            .padding(.horizontal, SDSpacing.xl)
            .padding(.bottom, SDSpacing.lg)
            .padding(.top, SDSpacing.xs)

            // Hint
            Text(L.enterSendShiftEnterNewline)
                .font(SDFont.caption)
                .foregroundStyle(SDColor.textDisabled)
                .padding(.horizontal, SDSpacing.xl)
                .padding(.bottom, SDSpacing.md)
        }
        .background(SDColor.bgWhite)
    }

    private func toolbarButton(icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(SDColor.textSecondary)
                .frame(width: 36, height: 36)
                .background(Color.clear)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private func handleSend() {
        if !pendingFiles.isEmpty {
            let files = pendingFiles
            pendingFiles = []
            onAttachFile?(files)
        }
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            onSend()
        }
    }

    private func openFilePicker() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = L.selectFile
        if panel.runModal() == .OK {
            let urls = panel.urls
            if let onAttachFile {
                onAttachFile(urls)
            } else {
                pendingFiles.append(contentsOf: urls)
            }
        }
    }

    private func openImagePicker() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image, .movie]
        panel.message = L.selectImageOrVideo
        if panel.runModal() == .OK {
            let urls = panel.urls
            if let onAttachFile {
                onAttachFile(urls)
            } else {
                pendingFiles.append(contentsOf: urls)
            }
        }
    }
}

/// Small chip showing a pending file with remove button.
struct FilePreviewChip: View {
    let url: URL
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: SDSpacing.md) {
            // File icon
            ZStack {
                RoundedRectangle(cornerRadius: SDRadius.sm)
                    .fill(SDColor.primary.opacity(0.1))
                    .frame(width: 32, height: 32)
                Image(systemName: fileIcon)
                    .font(.system(size: 14))
                    .foregroundStyle(SDColor.primary)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(url.lastPathComponent)
                    .font(.system(size: 13))
                    .foregroundStyle(SDColor.textPrimary)
                    .lineLimit(1)
                    .frame(maxWidth: 120, alignment: .leading)
            }
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(SDColor.textDisabled)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, SDSpacing.lg)
        .padding(.vertical, SDSpacing.md)
        .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))
    }

    private var fileIcon: String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg", "png", "gif", "webp", "heic": return "photo"
        case "mp4", "mov", "avi": return "film"
        case "pdf": return "doc.richtext"
        case "doc", "docx": return "doc.text"
        default: return "doc"
        }
    }
}

// MARK: - Chat Text Editor (NSViewRepresentable)

/// Wraps NSTextView so that Enter sends and Shift+Enter inserts a newline.
/// Dynamically sizes to fit content (single line when empty, grows up to maxHeight).
struct ChatTextEditor: NSViewRepresentable {
    @Binding var text: String
    var isFocused: FocusState<Bool>.Binding
    var onSubmit: () -> Bool

    @Binding var dynamicHeight: CGFloat

    static let minEditorHeight: CGFloat = 36
    static let maxEditorHeight: CGFloat = 160

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false

        let textView = SubmitTextView()
        textView.delegate = context.coordinator
        textView.onSubmit = onSubmit
        textView.isRichText = false
        textView.allowsUndo = true
        textView.font = NSFont.systemFont(ofSize: 14)
        textView.textColor = NSColor.labelColor
        textView.drawsBackground = false
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.string = text

        scrollView.documentView = textView
        context.coordinator.textView = textView

        DispatchQueue.main.async {
            context.coordinator.recalcHeight()
        }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            textView.string = text
            textView.selectedRanges = selectedRanges
            DispatchQueue.main.async {
                context.coordinator.recalcHeight()
            }
        }
        // Enable scrolling only when content exceeds max height
        scrollView.hasVerticalScroller = dynamicHeight >= Self.maxEditorHeight
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChatTextEditor
        weak var textView: NSTextView?

        init(_ parent: ChatTextEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
            recalcHeight()
        }

        func textDidBeginEditing(_ notification: Notification) {
            parent.isFocused.wrappedValue = true
        }

        func textDidEndEditing(_ notification: Notification) {
            parent.isFocused.wrappedValue = false
        }

        func recalcHeight() {
            guard let tv = textView, let container = tv.textContainer, let lm = tv.layoutManager else { return }
            lm.ensureLayout(for: container)
            let usedRect = lm.usedRect(for: container)
            let inset = tv.textContainerInset
            let contentHeight = usedRect.height + inset.height * 2
            let clamped = min(max(contentHeight, ChatTextEditor.minEditorHeight), ChatTextEditor.maxEditorHeight)
            if abs(parent.dynamicHeight - clamped) > 0.5 {
                parent.dynamicHeight = clamped
            }
        }
    }
}

/// NSTextView subclass that intercepts Enter to send and Shift+Enter to insert newline.
/// Respects IME composition: when marked text is present, Enter confirms the
/// candidate instead of sending the message.
final class SubmitTextView: NSTextView {
    var onSubmit: (() -> Bool)?

    override func keyDown(with event: NSEvent) {
        let isReturn = event.keyCode == 36
        let shiftHeld = event.modifierFlags.contains(.shift)

        // IME is composing (marked text visible) — let the input method handle Enter.
        if isReturn && hasMarkedText() {
            super.keyDown(with: event)
            return
        }

        if isReturn && !shiftHeld {
            let handled = onSubmit?() ?? false
            if handled { return }
            // Not handled (e.g. streaming) — swallow the key instead of inserting newline.
            return
        }

        if isReturn && shiftHeld {
            insertNewline(nil)
            return
        }

        super.keyDown(with: event)
    }
}

// MARK: - Previews

#Preview("Message List") {
    MessageListView(
        messages: PreviewData.messages,
        streamingContent: nil,
        isLoading: false
    )
    .frame(width: 500, height: 400)
}

#Preview("With Streaming") {
    MessageListView(
        messages: PreviewData.messages,
        streamingContent: "I'm analyzing the code structure and will provide suggestions...",
        isLoading: false
    )
    .frame(width: 500, height: 400)
}

#Preview("Input Bar") {
    ChatInputBar(text: .constant("Hello"), isStreaming: false, onSend: {}, onStop: {})
        .frame(width: 500)
}
