import Foundation
import UserNotifications
import OSLog

/// Manages macOS user notifications for incoming messages.
final class NotificationService: @unchecked Sendable {
    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "notifications")
    private lazy var center = UNUserNotificationCenter.current()

    func requestPermission() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            if granted {
                logger.info("Notification permission granted")
            }
            return granted
        } catch {
            logger.error("Failed to request notification permission: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    func showMessageNotification(senderName: String, messagePreview: String, conversationId: String) {
        let content = UNMutableNotificationContent()
        content.title = senderName
        content.body = messagePreview
        content.sound = .default
        content.userInfo = ["conversationId": conversationId]
        content.threadIdentifier = conversationId

        let request = UNNotificationRequest(
            identifier: "msg-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        center.add(request) { [logger] error in
            if let error {
                logger.error("Failed to show notification: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func clearNotifications(for conversationId: String) {
        center.getDeliveredNotifications { [center] notifications in
            let matching = notifications
                .filter { $0.request.content.threadIdentifier == conversationId }
                .map(\.request.identifier)
            if !matching.isEmpty {
                center.removeDeliveredNotifications(withIdentifiers: matching)
            }
        }
    }
}
