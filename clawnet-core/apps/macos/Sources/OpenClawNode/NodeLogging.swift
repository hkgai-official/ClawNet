import Foundation
import os

enum NodeLogging {
    private static let logger = os.Logger(subsystem: NodeConstants.subsystem, category: "bootstrap")

    private static let didBootstrap: Void = {
        logger.info("OpenClaw Node logging initialized")
    }()

    static func bootstrapIfNeeded() {
        _ = self.didBootstrap
    }
}
