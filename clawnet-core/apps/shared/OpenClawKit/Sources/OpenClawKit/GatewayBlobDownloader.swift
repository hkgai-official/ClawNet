import Foundation
import OSLog

/// Downloads binary data from the gateway's ephemeral blob store via HTTP GET /blobs/:id.
public struct GatewayBlobDownloader: Sendable {
    private static let logger = Logger(subsystem: "ai.openclaw", category: "blob-download")

    /// Download a blob from the gateway blob store.
    /// Returns the raw data on success, or nil on failure.
    public static func download(
        blobId: String,
        endpoint: GatewayBlobUploader.Endpoint
    ) async -> Data? {
        let url = endpoint.httpBaseURL.appendingPathComponent("blobs").appendingPathComponent(blobId)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token = endpoint.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 60

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                self.logger.error("blob download: non-HTTP response")
                return nil
            }
            guard httpResponse.statusCode == 200 else {
                self.logger.error(
                    "blob download failed: status=\(httpResponse.statusCode, privacy: .public)")
                return nil
            }
            self.logger.info(
                "blob download ok: blobId=\(blobId, privacy: .public) size=\(data.count, privacy: .public)"
            )
            return data
        } catch {
            self.logger.error(
                "blob download error: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
