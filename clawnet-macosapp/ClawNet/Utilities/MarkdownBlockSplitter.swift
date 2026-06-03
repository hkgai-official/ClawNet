import Foundation

struct MarkdownBlock: Identifiable {
    let id: Int
    let content: String
}

/// Splits markdown text into blocks at paragraph boundaries (`\n\n`),
/// keeping fenced code blocks (``` ```) intact.
func splitMarkdownIntoBlocks(_ text: String) -> [MarkdownBlock] {
    var blocks: [String] = []
    var currentBlock = ""
    var insideCodeFence = false

    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        // Toggle code fence state
        if trimmed.hasPrefix("```") {
            insideCodeFence.toggle()
        }

        if line.isEmpty && !insideCodeFence {
            // Empty line outside code fence = block boundary
            if !currentBlock.isEmpty {
                blocks.append(currentBlock)
                currentBlock = ""
            }
        } else {
            if !currentBlock.isEmpty {
                currentBlock += "\n"
            }
            currentBlock += line
        }
    }

    // Flush remaining
    if !currentBlock.isEmpty {
        blocks.append(currentBlock)
    }

    return blocks.enumerated().map { MarkdownBlock(id: $0.offset, content: $0.element) }
}
