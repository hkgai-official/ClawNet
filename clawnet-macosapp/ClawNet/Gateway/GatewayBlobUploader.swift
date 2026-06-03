import Foundation
import OSLog

/// Uploads binary data to the gateway's ephemeral blob store via HTTP POST /blobs.
struct GatewayBlobUploader: Sendable {
    struct Endpoint: Sendable {
        let httpBaseURL: URL
        let token: String?

        init(httpBaseURL: URL, token: String?) {
            self.httpBaseURL = httpBaseURL
            self.token = token
        }

        static func fromWebSocketURL(_ wsURL: URL, token: String?) -> Endpoint {
            var components = URLComponents(url: wsURL, resolvingAgainstBaseURL: false)!
            if components.scheme == "wss" {
                components.scheme = "https"
            } else {
                components.scheme = "http"
            }
            return Endpoint(httpBaseURL: components.url!, token: token)
        }
    }

    private static let logger = Logger(subsystem: "ai.clawnet.macos", category: "blob-upload")

    static func upload(data: Data, endpoint: Endpoint) async -> String? {
        let url = endpoint.httpBaseURL.appendingPathComponent("blobs")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let token = endpoint.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 60

        do {
            let (responseData, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                self.logger.error("blob upload: non-HTTP response")
                return nil
            }
            guard httpResponse.statusCode == 201 else {
                self.logger.error("blob upload failed: status=\(httpResponse.statusCode, privacy: .public)")
                return nil
            }
            guard let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
                  let blobId = json["blobId"] as? String
            else {
                self.logger.error("blob upload: invalid response body")
                return nil
            }
            self.logger.info("blob upload ok: blobId=\(blobId, privacy: .public) size=\(data.count, privacy: .public)")
            return blobId
        } catch {
            self.logger.error("blob upload error: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
