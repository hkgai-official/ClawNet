import SwiftUI
import Textual

// MARK: - Inline Styles

extension InlineStyle {
    static let clawNetOwn = InlineStyle()
        .code(.monospaced, .fontScale(0.88), .backgroundColor(Color.black.opacity(0.06)))
        .strong(.fontWeight(.semibold))
        .emphasis(.italic)
        .link(.foregroundColor(.blue), .underlineStyle(.single))

    static let clawNetOther = InlineStyle()
        .code(.monospaced, .fontScale(0.88), .backgroundColor(Color.black.opacity(0.05)))
        .strong(.fontWeight(.semibold))
        .emphasis(.italic)
        .link(.foregroundColor(SDColor.primary), .underlineStyle(.single))
}

// MARK: - Code Block Style

struct ClawNetCodeBlockStyle: StructuredText.CodeBlockStyle {
    let textColor: Color

    func makeBody(configuration: StructuredText.CodeBlockStyleConfiguration) -> some View {
        Overflow {
            configuration.label
                .textual.fontScale(0.88)
                .monospaced()
                .padding(10)
        }
        .background(Color.black.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: SDRadius.sm))
        .textual.blockSpacing(.fontScaled(top: 0.25, bottom: 0.25))
    }
}

// MARK: - Block Quote Style

struct ClawNetBlockQuoteStyle: StructuredText.BlockQuoteStyle {
    let barColor: Color

    func makeBody(configuration: StructuredText.BlockStyleConfiguration) -> some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(barColor)
                .frame(width: 3)
            configuration.label
                .padding(.leading, 8)
                .opacity(0.7)
        }
        .textual.blockSpacing(.fontScaled(top: 0.25, bottom: 0.25))
    }
}
