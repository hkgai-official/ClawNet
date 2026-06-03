import SwiftUI

// MARK: - ClawNet Design System
// WeChat-inspired design tokens adapted for macOS native UI.

enum SDColor {
    // Primary - WeChat green
    static let primary = Color(hex: 0x07C160)
    static let primaryHover = Color(hex: 0x06AD56)
    static let primaryLight = Color(hex: 0x07C160).opacity(0.1)

    // Agent accent - purple
    static let agentPrimary = Color(hex: 0x722ED1)
    static let agentBadge = Color(hex: 0x9254DE)
    static let agentLight = Color(hex: 0x722ED1).opacity(0.08)

    // Message bubbles
    static let ownBubble = Color(hex: 0x95EC69)
    static let ownBubbleText = Color.black
    static let otherBubble = Color.white
    static let otherBubbleText = Color(hex: 0x1F1F1F)

    // Status
    static let success = Color(hex: 0x07C160)
    static let warning = Color(hex: 0xFF9500)
    static let error = Color(hex: 0xFA5151)
    static let info = Color(hex: 0x10AEFF)

    // Text
    static let textPrimary = Color(hex: 0x191919)
    static let textSecondary = Color(hex: 0x7A7A7A)
    static let textTertiary = Color(hex: 0xB2B2B2)
    static let textDisabled = Color(hex: 0xCCCCCC)

    // Backgrounds
    static let bgPrimary = Color(hex: 0xEDEDED)
    static let bgSecondary = Color(hex: 0xF5F5F5)
    static let bgTertiary = Color(hex: 0xFAFAFA)
    static let bgWhite = Color.white
    static let bgHover = Color.black.opacity(0.04)
    static let bgActive = Color.black.opacity(0.08)

    // Borders
    static let border = Color(hex: 0xD9D9D9)
    static let borderLight = Color(hex: 0xEBEBEB)
    static let divider = Color(hex: 0xF0F0F0)

    // Navigation bar
    static let navBarBg = Color(hex: 0xE7E7E7)

    // Avatar color palette
    static let avatarColors: [Color] = [
        Color(hex: 0x1890FF), // blue
        Color(hex: 0x52C41A), // green
        Color(hex: 0x722ED1), // purple
        Color(hex: 0xFA8C16), // orange
        Color(hex: 0xEB2F96), // pink
        Color(hex: 0x13C2C2), // cyan
        Color(hex: 0x2F54EB), // indigo
        Color(hex: 0xFAAD14), // gold
    ]

    /// Get a deterministic color from a name string.
    static func avatarColor(for name: String) -> Color {
        let hash = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return avatarColors[hash % avatarColors.count]
    }
}

// MARK: - Spacing & Radius

enum SDRadius {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 16
}

enum SDSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 16
    static let xxl: CGFloat = 20
}

// MARK: - Font Scale

enum SDFont {
    static let tiny: Font = .system(size: 10)
    static let caption: Font = .system(size: 11)
    static let small: Font = .system(size: 12)
    static let body: Font = .system(size: 14)
    static let subtitle: Font = .system(size: 15, weight: .medium)
    static let title: Font = .system(size: 18, weight: .semibold)
}

// MARK: - Color Extension

extension Color {
    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
