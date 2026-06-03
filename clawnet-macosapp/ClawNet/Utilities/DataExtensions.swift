import Foundation
import CryptoKit

extension Data {
    /// SHA-256 hex digest of the data.
    var sha256Hex: String {
        let digest = SHA256.hash(data: self)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
