import Foundation

enum ServerConfig {
    static let defaultServerURL: String = {
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads")
            .appendingPathComponent("server-config.json")
        guard let data = try? Data(contentsOf: configURL),
              let dict = try? JSONDecoder().decode([String: String].self, from: data),
              let url = dict["serverURL"], !url.isEmpty
        else {
            return "http://localhost:9000"
        }
        return url
    }()
}
