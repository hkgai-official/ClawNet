import Foundation

public enum OpenClawFileCommand: String, Codable, Sendable {
    case read = "file.read"
    case write = "file.write"
    case stat = "file.stat"
    case list = "file.list"
    case search = "file.search"
}

public struct OpenClawFileReadParams: Codable, Sendable, Equatable {
    public var path: String
    public var offset: Int?
    public var limit: Int?
    public var encoding: String?

    public init(
        path: String,
        offset: Int? = nil,
        limit: Int? = nil,
        encoding: String? = nil)
    {
        self.path = path
        self.offset = offset
        self.limit = limit
        self.encoding = encoding
    }
}

public struct OpenClawFileWriteParams: Codable, Sendable, Equatable {
    public var path: String
    public var content: String?
    public var encoding: String?
    public var createDirs: Bool?
    public var append: Bool?
    /// When set, node downloads the blob from the gateway and writes it to path.
    /// Mutually exclusive with content — blobId takes priority.
    public var blobId: String?

    public init(
        path: String,
        content: String? = nil,
        encoding: String? = nil,
        createDirs: Bool? = nil,
        append: Bool? = nil,
        blobId: String? = nil)
    {
        self.path = path
        self.content = content
        self.encoding = encoding
        self.createDirs = createDirs
        self.append = append
        self.blobId = blobId
    }
}

public struct OpenClawFileStatParams: Codable, Sendable, Equatable {
    public var path: String

    public init(path: String) {
        self.path = path
    }
}

public struct OpenClawFileListParams: Codable, Sendable, Equatable {
    public var path: String

    public init(path: String) {
        self.path = path
    }
}

public struct OpenClawFileSearchParams: Codable, Sendable, Equatable {
    public var path: String
    public var keywords: [String]
    public var depth: Int?
    public var maxResults: Int?

    public init(
        path: String,
        keywords: [String],
        depth: Int? = nil,
        maxResults: Int? = nil)
    {
        self.path = path
        self.keywords = keywords
        self.depth = depth
        self.maxResults = maxResults
    }
}
