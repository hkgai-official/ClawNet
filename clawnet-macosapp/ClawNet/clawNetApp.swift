import SwiftUI

@main
struct ClawNetApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    BookmarkStore.shared.restoreAll()
                }
        }

        Settings {
            SettingsView()
                .environment(appState)
        }
    }
}
