import SwiftUI

/// Reusable avatar component matching Web's Avatar design.
/// - Rounded rectangle (12px for ≥40, 8px for smaller)
/// - Color-coded by name hash, agents always purple
/// - Shows first Chinese character or uppercase first letter
struct AvatarView: View {
    let name: String
    var avatarURL: String?
    var type: Participant.ParticipantType?
    var size: CGFloat = 40

    private var initials: String {
        guard let first = name.trimmingCharacters(in: .whitespaces).first else { return "?" }
        // Chinese character → use directly; otherwise uppercase
        if first.unicodeScalars.first.map({ $0.value >= 0x4E00 && $0.value <= 0x9FA5 }) == true {
            return String(first)
        }
        return String(first).uppercased()
    }

    private var bgColor: Color {
        switch type {
        case .agent:  return SDColor.agentPrimary
        case .system: return SDColor.textSecondary
        default:      return SDColor.avatarColor(for: name)
        }
    }

    private var cornerRadius: CGFloat {
        size >= 40 ? SDRadius.lg : SDRadius.md
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(bgColor)
                .frame(width: size, height: size)

            Text(initials)
                .font(.system(size: size * 0.4, weight: .medium))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// Avatar with an optional "AI" badge overlay (bottom-right).
struct AvatarWithBadge: View {
    let name: String
    var avatarURL: String?
    var type: Participant.ParticipantType?
    var size: CGFloat = 40
    var showAgentBadge: Bool = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            AvatarView(name: name, avatarURL: avatarURL, type: type, size: size)

            if showAgentBadge || type == .agent {
                Text("AI")
                    .font(.system(size: max(size * 0.18, 7), weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: max(size * 0.4, 16), height: max(size * 0.4, 16))
                    .background(SDColor.agentPrimary, in: Circle())
                    .overlay(
                        Circle()
                            .stroke(Color.white, lineWidth: 1.5)
                    )
                    .offset(x: 2, y: 2)
            }
        }
    }
}

#Preview("Avatar Sizes") {
    HStack(spacing: 12) {
        AvatarView(name: "Alice", size: 28)
        AvatarView(name: "张三", size: 36)
        AvatarView(name: "Bob", size: 40)
        AvatarView(name: "Agent", type: .agent, size: 48)
    }
    .padding()
}

#Preview("Avatar with Badge") {
    HStack(spacing: 12) {
        AvatarWithBadge(name: "智能助手", type: .agent, size: 36)
        AvatarWithBadge(name: "AI Helper", type: .agent, size: 48)
    }
    .padding()
}
