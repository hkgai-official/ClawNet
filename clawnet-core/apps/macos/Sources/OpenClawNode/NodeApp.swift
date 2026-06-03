import AppKit
import Foundation
import Observation
import OSLog
import SwiftUI

@main
struct OpenClawNodeApp: App {
    @NSApplicationDelegateAdaptor(NodeAppDelegate.self) private var delegate
    @State private var state = NodeAppState.shared

    init() {
        NodeLogging.bootstrapIfNeeded()
    }

    var body: some Scene {
        MenuBarExtra {
            NodeMenuContent(state: self.state)
        } label: {
            NodeStatusLabel(state: self.state)
        }
        .menuBarExtraStyle(.menu)

        Settings {
            NodeSettingsView(state: self.state)
        }
    }
}

final class NodeAppDelegate: NSObject, NSApplicationDelegate {
    private let logger = Logger(subsystem: "ai.openclaw.node", category: "app-delegate")

    func applicationDidFinishLaunching(_ notification: Notification) {
        self.logger.info("OpenClaw Node app launched")
        Task { @MainActor in
            NodeAppState.shared.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            NodeAppState.shared.stop()
        }
    }
}
