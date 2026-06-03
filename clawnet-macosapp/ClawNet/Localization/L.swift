import SwiftUI

// MARK: - Language Enum

enum AppLanguage: String, CaseIterable, Identifiable {
    case zhHans = "zh-Hans"
    case zhHant = "zh-Hant"
    case en = "en"

    var id: String { rawValue }

    /// Each language displays its own name
    var displayName: String {
        switch self {
        case .zhHans: "简体中文"
        case .zhHant: "繁體中文"
        case .en: "English"
        }
    }
}

// MARK: - Language Manager

@MainActor @Observable
final class LanguageManager {
    static let shared = LanguageManager()

    var current: AppLanguage {
        didSet {
            rawLanguage = current.rawValue
        }
    }

    /// Closure that returns the current API client, injected by AppState.
    var apiProvider: (() -> ClawNetAPI?)?

    @ObservationIgnored
    @AppStorage("language") private var rawLanguage: String = AppLanguage.zhHans.rawValue

    private init() {
        let stored = AppStorage(wrappedValue: AppLanguage.zhHans.rawValue, "language")
        self.current = AppLanguage(rawValue: stored.wrappedValue) ?? .zhHans
    }

    func setLanguage(_ lang: AppLanguage) {
        current = lang
        syncToServer()
    }

    /// Called after login to sync from server preference
    func syncFromUser(languageRaw: String?) {
        if let raw = languageRaw, let lang = AppLanguage(rawValue: raw) {
            current = lang
        }
    }

    private func syncToServer() {
        guard let api = apiProvider?() else { return }
        Task {
            try? await api.updateLanguage(current.rawValue)
        }
    }
}

// MARK: - L (Localized Strings)

@MainActor
enum L {
    static var current: AppLanguage { LanguageManager.shared.current }
}
