import Foundation
import OSLog

/// Replaces KeychainHelper with file-based + UserDefaults storage.
/// - serverURL: stored in UserDefaults (not sensitive, read frequently)
/// - accessToken / refreshToken: stored in a JSON file under Application Support
///   with 0600 permissions (user-only read/write)
enum CredentialStore {
    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "credential-store")
    private static let defaultsPrefix = "ai.clawnet."
    private static let credentialFileName = "credentials.json"

    enum Keys: String, CaseIterable {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case serverURL = "server_url"
    }

    // MARK: - Public API (same interface as old KeychainHelper)

    static func save(key: String, value: String) throws {
        if key == Keys.serverURL.rawValue {
            UserDefaults.standard.set(value, forKey: defaultsPrefix + key)
        } else {
            var creds = loadCredentialsFile()
            creds[key] = value
            try saveCredentialsFile(creds)
        }
    }

    static func load(key: String) -> String? {
        if key == Keys.serverURL.rawValue {
            return UserDefaults.standard.string(forKey: defaultsPrefix + key)
        }
        let creds = loadCredentialsFile()
        return creds[key]
    }

    static func delete(key: String) {
        if key == Keys.serverURL.rawValue {
            UserDefaults.standard.removeObject(forKey: defaultsPrefix + key)
        } else {
            var creds = loadCredentialsFile()
            creds.removeValue(forKey: key)
            try? saveCredentialsFile(creds)
        }
    }

    static func deleteAll() {
        UserDefaults.standard.removeObject(forKey: defaultsPrefix + Keys.serverURL.rawValue)
        let url = credentialsFileURL()
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - File-based credential storage

    private static func appSupportDirectory() -> URL {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("ai.clawnet.macos", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private static func credentialsFileURL() -> URL {
        appSupportDirectory().appendingPathComponent(credentialFileName)
    }

    private static func loadCredentialsFile() -> [String: String] {
        let url = credentialsFileURL()
        guard let data = try? Data(contentsOf: url) else { return [:] }
        guard let dict = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return dict
    }

    private static func saveCredentialsFile(_ creds: [String: String]) throws {
        let url = credentialsFileURL()
        let data = try JSONEncoder().encode(creds)
        try data.write(to: url, options: .atomic)
        // Set file permissions to 0600 (owner read/write only)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: url.path
        )
    }
}
