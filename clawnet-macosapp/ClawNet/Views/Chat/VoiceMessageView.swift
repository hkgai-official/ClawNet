import SwiftUI
import AVFoundation

/// Renders a voice message with waveform animation and playback controls.
struct VoiceMessageView: View {
    let content: MessageContent
    let isUser: Bool
    @State private var isPlaying = false
    @State private var progress: Double = 0
    @State private var player: AVAudioPlayer?

    private var duration: Double { content.duration ?? 5 }

    /// Width scales with duration, capped at 200.
    private var bubbleWidth: CGFloat {
        min(80 + CGFloat(duration) * 8, 200)
    }

    private var tintColor: Color {
        isUser ? SDColor.primary : SDColor.agentPrimary
    }

    var body: some View {
        Button(action: togglePlay) {
            HStack(spacing: 6) {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(tintColor)

                waveformBars

                Text(formatDuration(duration))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(SDColor.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(width: bubbleWidth)
            .background(isUser ? SDColor.primary.opacity(0.15) : SDColor.textSecondary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .onDisappear {
            player?.stop()
        }
    }

    private var waveformBars: some View {
        HStack(spacing: 2) {
            ForEach(0..<12, id: \.self) { i in
                let offset = Double(i)
                let height: CGFloat = isPlaying
                    ? 6 + sin((progress * .pi * 8) + offset * 0.8) * 8
                    : 4 + sin(offset * 0.6) * 3
                RoundedRectangle(cornerRadius: 1)
                    .fill(tintColor.opacity(isPlaying ? 1 : 0.5))
                    .frame(width: 2.5, height: max(3, height))
                    .animation(.easeInOut(duration: 0.15), value: progress)
            }
        }
    }

    private func togglePlay() {
        if isPlaying {
            player?.pause()
            isPlaying = false
            return
        }

        guard let urlString = content.url, let url = URL(string: urlString) else { return }

        // Download and play
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let audioPlayer = try AVAudioPlayer(data: data)
                audioPlayer.prepareToPlay()
                audioPlayer.play()
                self.player = audioPlayer
                self.isPlaying = true

                // Animate progress
                while audioPlayer.isPlaying {
                    progress = audioPlayer.currentTime / audioPlayer.duration
                    try await Task.sleep(for: .milliseconds(50))
                }
                isPlaying = false
                progress = 0
            } catch {
                isPlaying = false
                progress = 0
            }
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return m > 0 ? "\(m)'\(String(format: "%02d", s))''" : "\(s)''"
    }
}
