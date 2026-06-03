import SwiftUI

/// Control bar shown during agent-to-agent dialog conversations.
struct AgentDialogControlBar: View {
    let session: DialogSession
    let agentService: AgentService
    @State private var showExtendInput = false
    @State private var additionalRounds = 5
    @State private var showTerminateConfirm = false

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                // Status badge
                statusBadge

                // Topic
                Text(session.topic)
                    .font(.caption)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)

                Spacer()

                // Round counter (one round = one back-and-forth exchange)
                HStack(spacing: 4) {
                    Text(L.rounds)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("\(displayRound)/\(displayMaxRounds)")
                        .font(.caption.monospacedDigit().bold())
                }
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(.secondary.opacity(0.15))
                    RoundedRectangle(cornerRadius: 2)
                        .fill(progressColor)
                        .frame(width: geo.size.width * progress)
                        .animation(.easeInOut, value: progress)
                }
            }
            .frame(height: 3)

            // Action buttons
            if session.status == .active || session.status == .paused {
                HStack(spacing: 8) {
                    Spacer()
                    if showExtendInput {
                        HStack(spacing: 4) {
                            Text(L.addRoundsPrefix)
                                .font(.caption)
                            TextField("", value: $additionalRounds, format: .number)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 40)
                            Text(L.addRoundsSuffix)
                                .font(.caption)
                            Button(L.confirm) {
                                Task {
                                    try? await agentService.extendDialog(sessionId: session.id, additionalRounds: additionalRounds)
                                    showExtendInput = false
                                }
                            }
                            .font(.caption)
                            Button(L.cancel) { showExtendInput = false }
                                .font(.caption)
                        }
                    } else {
                        Button(L.extend) { showExtendInput = true }
                            .font(.caption)
                        Button(L.terminate, role: .destructive) { showTerminateConfirm = true }
                            .font(.caption)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(nsColor: .controlBackgroundColor))
        .confirmationDialog(L.terminateDialog, isPresented: $showTerminateConfirm) {
            Button(L.confirmTerminate, role: .destructive) {
                Task { try? await agentService.terminateDialog(sessionId: session.id, reason: "owner_terminated") }
            }
        } message: {
            Text(L.confirmTerminateMessage)
        }
    }

    private var statusBadge: some View {
        Text(session.status.displayName)
            .font(.caption2.bold())
            .foregroundStyle(statusColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(statusColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
    }

    private var statusColor: Color {
        switch session.status {
        case .pendingApproval: .yellow
        case .active: .blue
        case .paused: .purple
        case .completed: .green
        case .terminated: .red
        }
    }

    private var displayRound: Int {
        (session.currentRound + 1) / 2
    }

    private var displayMaxRounds: Int {
        (session.maxRounds + 1) / 2
    }

    private var progressColor: Color {
        session.status == .completed ? .green : .blue
    }

    private var progress: CGFloat {
        guard displayMaxRounds > 0 else { return 0 }
        return CGFloat(displayRound) / CGFloat(displayMaxRounds)
    }
}
