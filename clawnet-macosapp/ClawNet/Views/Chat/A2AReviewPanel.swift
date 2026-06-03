import SwiftUI

/// Review panel shown in A2A dialogs when a draft is pending user review.
struct A2AReviewPanel: View {
    @Bindable var review: DraftReview
    let onRequestMain: () async -> Void
    let onRefine: (String, String) async -> Void
    let onSubmit: () async -> Void

    @State private var tagRefineText = ""
    @State private var mainRefineText = ""

    var body: some View {
        ScrollView {
            VStack(spacing: SDSpacing.md) {
                tagDraftSection
                mainAssistantSection
                manualInputSection
                sendButton
            }
            .padding(SDSpacing.lg)
        }
        .background(SDColor.bgWhite)
    }

    // MARK: - Radio Button Helper
    private func radioButton(selected: Bool) -> some View {
        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
            .font(.system(size: 16))
            .foregroundStyle(selected ? SDColor.primary : SDColor.textTertiary)
    }

    // MARK: - Tag Agent Draft
    private var tagDraftSection: some View {
        VStack(alignment: .leading, spacing: SDSpacing.sm) {
            HStack {
                Button { review.selectedSource = .tag } label: {
                    HStack(spacing: SDSpacing.sm) {
                        radioButton(selected: review.selectedSource == .tag)
                        AvatarWithBadge(name: review.tagAgentName, type: .agent, size: 24)
                        Text(review.tagAgentName)
                            .font(SDFont.subtitle)
                            .foregroundStyle(SDColor.textPrimary)
                    }
                }
                .buttonStyle(.plain)
                Spacer()
                statusBadge(review.tagDraftStatus)
            }

            Text(review.tagDraftText)
                .font(SDFont.body)
                .foregroundStyle(SDColor.textPrimary)
                .textSelection(.enabled)
                .padding(SDSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))

            HStack(spacing: SDSpacing.sm) {
                TextField(L.refineInstruction, text: $tagRefineText)
                    .textFieldStyle(.roundedBorder)
                    .font(SDFont.body)
                    .disabled(review.tagDraftStatus == .refining)

                Button(L.refine) {
                    let instruction = tagRefineText
                    tagRefineText = ""
                    Task { await onRefine("tag", instruction) }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .padding(.horizontal, SDSpacing.lg)
                .padding(.vertical, SDSpacing.sm)
                .background(SDColor.primary, in: RoundedRectangle(cornerRadius: SDRadius.md))
                .disabled(tagRefineText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || review.tagDraftStatus == .refining)
            }
        }
        .padding(SDSpacing.md)
        .background(RoundedRectangle(cornerRadius: SDRadius.lg).stroke(review.selectedSource == .tag ? SDColor.primary : SDColor.borderLight, lineWidth: review.selectedSource == .tag ? 2 : 1))
    }

    // MARK: - Main Assistant
    private var mainAssistantSection: some View {
        VStack(spacing: SDSpacing.sm) {
            if !review.showMainDraft {
                Button {
                    Task { await onRequestMain() }
                } label: {
                    HStack(spacing: SDSpacing.sm) {
                        Image(systemName: "brain.head.profile")
                            .font(.system(size: 14))
                        Text(L.mainAssistant)
                            .font(SDFont.subtitle)
                    }
                    .foregroundStyle(SDColor.agentPrimary)
                    .padding(.horizontal, SDSpacing.xl)
                    .padding(.vertical, SDSpacing.md)
                    .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: SDRadius.md))
                }
                .buttonStyle(.plain)
            } else {
                mainDraftSection
            }
        }
    }

    private var mainDraftSection: some View {
        VStack(alignment: .leading, spacing: SDSpacing.sm) {
            HStack {
                Button { review.selectedSource = .main } label: {
                    HStack(spacing: SDSpacing.sm) {
                        radioButton(selected: review.selectedSource == .main)
                        Image(systemName: "brain.head.profile")
                            .foregroundStyle(SDColor.agentPrimary)
                        Text(L.mainAssistant)
                            .font(SDFont.subtitle)
                            .foregroundStyle(SDColor.textPrimary)
                    }
                }
                .buttonStyle(.plain)
                Spacer()
                if let status = review.mainDraftStatus {
                    statusBadge(status)
                }
            }

            if review.mainDraftStatus == .generating {
                HStack {
                    ProgressView().scaleEffect(0.8)
                    Text(L.generating)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textSecondary)
                }
                .padding(SDSpacing.md)
            } else if let text = review.mainDraftText {
                Text(text)
                    .font(SDFont.body)
                    .foregroundStyle(SDColor.textPrimary)
                    .textSelection(.enabled)
                    .padding(SDSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))

                HStack(spacing: SDSpacing.sm) {
                    TextField(L.refineInstruction, text: $mainRefineText)
                        .textFieldStyle(.roundedBorder)
                        .font(SDFont.body)
                        .disabled(review.mainDraftStatus == .refining)

                    Button(L.refine) {
                        let instruction = mainRefineText
                        mainRefineText = ""
                        Task { await onRefine("main", instruction) }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .padding(.horizontal, SDSpacing.lg)
                    .padding(.vertical, SDSpacing.sm)
                    .background(SDColor.agentPrimary, in: RoundedRectangle(cornerRadius: SDRadius.md))
                    .disabled(mainRefineText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || review.mainDraftStatus == .refining)
                }
            }
        }
        .padding(SDSpacing.md)
        .background(RoundedRectangle(cornerRadius: SDRadius.lg).stroke(review.selectedSource == .main ? SDColor.agentPrimary : SDColor.borderLight, lineWidth: review.selectedSource == .main ? 2 : 1))
    }

    // MARK: - Manual Input
    private var manualInputSection: some View {
        VStack(alignment: .leading, spacing: SDSpacing.sm) {
            Button { review.selectedSource = .manual } label: {
                HStack(spacing: SDSpacing.sm) {
                    radioButton(selected: review.selectedSource == .manual)
                    Text(L.manualReplyHint)
                        .font(SDFont.small)
                        .foregroundStyle(SDColor.textSecondary)
                }
            }
            .buttonStyle(.plain)

            TextEditor(text: Binding(get: { review.manualText }, set: { review.manualText = $0; review.selectedSource = .manual }))
                .font(SDFont.body)
                .frame(minHeight: 50, maxHeight: 100)
                .padding(SDSpacing.xs)
                .background(SDColor.bgSecondary, in: RoundedRectangle(cornerRadius: SDRadius.md))
                .overlay(RoundedRectangle(cornerRadius: SDRadius.md).stroke(review.selectedSource == .manual ? SDColor.primary : SDColor.borderLight, lineWidth: review.selectedSource == .manual ? 2 : 1))
        }
    }

    // MARK: - Send Button
    private var sendButton: some View {
        HStack {
            Spacer()
            Button {
                Task { await onSubmit() }
            } label: {
                HStack(spacing: SDSpacing.sm) {
                    Text(sendButtonText)
                        .font(SDFont.subtitle)
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 13))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, SDSpacing.xxl)
                .padding(.vertical, SDSpacing.md)
                .background(review.canSubmit ? SDColor.primary : SDColor.textDisabled, in: RoundedRectangle(cornerRadius: SDRadius.md))
            }
            .buttonStyle(.plain)
            .disabled(!review.canSubmit)
        }
    }

    private var sendButtonText: String {
        switch review.selectedSource {
        case .tag: return L.sendTagReply(review.tagAgentName)
        case .main: return L.sendMainReply
        case .manual: return L.sendManualReply
        }
    }

    private func statusBadge(_ status: DraftStatus) -> some View {
        Text(status == .generating ? L.statusGenerating : status == .refining ? L.statusRefining : L.statusReady)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(status == .ready ? SDColor.success : SDColor.warning)
            .padding(.horizontal, SDSpacing.sm)
            .padding(.vertical, 2)
            .background((status == .ready ? SDColor.success : SDColor.warning).opacity(0.12), in: RoundedRectangle(cornerRadius: SDRadius.sm))
    }
}
