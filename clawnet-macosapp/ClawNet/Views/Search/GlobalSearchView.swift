import SwiftUI

/// Global message search sheet — searches messages across all conversations via API.
struct GlobalSearchView: View {
    let chatService: ChatService
    let onSelectResult: (String) -> Void // conversationId
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(L.searchMessages)
                    .font(.headline)
                Spacer()
                Button(L.close) { dismiss() }
                    .buttonStyle(.plain)
            }
            .padding()

            Divider()

            // Search input
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField(L.searchKeywordPlaceholder, text: $query)
                    .textFieldStyle(.plain)
                    .onSubmit { performSearch() }
                if !query.isEmpty {
                    Button(action: {
                        query = ""
                        results = []
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal)
            .padding(.vertical, 8)
            .onChange(of: query) {
                // Debounced search
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard !Task.isCancelled else { return }
                    performSearch()
                }
            }

            Divider()

            // Results
            if isSearching {
                Spacer()
                ProgressView(L.searching)
                Spacer()
            } else if results.isEmpty && !query.isEmpty {
                Spacer()
                ContentUnavailableView(
                    L.noMatchingMessages,
                    systemImage: "magnifyingglass",
                    description: Text(L.tryDifferentKeywords)
                )
                Spacer()
            } else if results.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text(L.enterKeywordToSearch)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            } else {
                List {
                    ForEach(results) { result in
                        SearchResultRow(result: result, query: query)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                onSelectResult(result.conversationId)
                                dismiss()
                            }
                    }
                }
                .listStyle(.plain)
            }
        }
        .frame(width: 480, height: 500)
    }

    private func performSearch() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            results = []
            return
        }

        isSearching = true
        Task {
            // Search via local messages (client-side, like the web app)
            let allMessages = chatService.allMessages
            let conversations = chatService.conversations
            let lowQ = q.lowercased()

            var found: [SearchResult] = []
            for msg in allMessages {
                guard msg.contentType == .text,
                      let text = msg.content.text,
                      text.lowercased().contains(lowQ) else { continue }

                let convTitle = conversations.first(where: { $0.id == msg.conversationId }).flatMap(\.title) ?? L.unknownConversation
                found.append(SearchResult(
                    id: msg.id,
                    messageId: msg.id,
                    conversationId: msg.conversationId,
                    conversationTitle: convTitle,
                    senderName: msg.sender.name,
                    senderType: msg.sender.type,
                    preview: text,
                    timestamp: msg.timestamp
                ))
            }

            // Sort newest first
            found.sort { $0.timestamp > $1.timestamp }
            results = found
            isSearching = false
        }
    }
}

// MARK: - Search Result Model

struct SearchResult: Identifiable {
    let id: String
    let messageId: String
    let conversationId: String
    let conversationTitle: String
    let senderName: String
    let senderType: Participant.ParticipantType
    let preview: String
    let timestamp: Date
}

// MARK: - Search Result Row

struct SearchResultRow: View {
    let result: SearchResult
    let query: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Avatar
            ZStack {
                Circle()
                    .fill(result.senderType == .agent ? Color.purple.opacity(0.2) : Color.blue.opacity(0.2))
                    .frame(width: 32, height: 32)
                Text(String(result.senderName.prefix(1)).uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(result.senderType == .agent ? .purple : .blue)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(result.senderName)
                        .font(.subheadline.bold())
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(result.conversationTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 3))
                    Spacer()
                    Text(result.timestamp, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                // Preview with highlighted query
                highlightedText(result.preview, query: query)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }

    private func highlightedText(_ text: String, query: String) -> Text {
        guard !query.isEmpty,
              let regex = try? NSRegularExpression(pattern: NSRegularExpression.escapedPattern(for: query), options: .caseInsensitive)
        else { return Text(text) }

        let nsText = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
        guard !matches.isEmpty else { return Text(text) }

        var result = Text("")
        var lastEnd = 0
        for match in matches {
            // Text before match
            if match.range.location > lastEnd {
                let before = nsText.substring(with: NSRange(location: lastEnd, length: match.range.location - lastEnd))
                result = result + Text(before)
            }
            // Highlighted match
            let matched = nsText.substring(with: match.range)
            result = result + Text(matched).foregroundStyle(.green).bold()
            lastEnd = match.range.location + match.range.length
        }
        // Remaining text
        if lastEnd < nsText.length {
            result = result + Text(nsText.substring(from: lastEnd))
        }
        return result
    }
}
