import Foundation
import OSLog

/// JSONL-based operation logger for file change tracking.
/// Logs are stored in `.clawnet/logs/` with one file per day, append-only.
@MainActor
final class OperationLogger {
    static let shared = OperationLogger()

    private let logger = Logger(subsystem: "ai.clawnet.macos", category: "operation-logger")

    /// Commands that must be logged (all mutating file operations).
    static let loggableCommands: Set<String> = [
        "file.move", "file.rename", "file.copy", "file.write", "file.trash", "file.mkdir",
    ]

    // MARK: - Data Models

    struct LogEntry: Codable {
        let id: String
        let timestamp: Int64
        let sessionId: String?
        let command: String
        let params: [String: JSONValue]
        let result: String              // "success" or "error"
        let errorMessage: String?
        let reversible: Bool
        let reverseAction: ReverseAction?

        /// Entry type: nil = normal operation, "undo" = undo record, "rollback" = rollback record
        let type: String?
        /// For type=="undo": the operation ID that was undone
        let undoTargetId: String?
    }

    struct ReverseAction: Codable {
        let command: String
        let params: [String: JSONValue]
    }

    struct LogFilter {
        var sessionId: String?
        var command: String?
        var since: Int64?
        var until: Int64?
        var limit: Int = 50
        var offset: Int = 0
    }

    struct LogQueryResult {
        let entries: [LogEntry]
        let total: Int
        let hasMore: Bool
    }

    // MARK: - ID Generation

    static func generateId() -> String {
        let hex = (0..<4).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        return "op_\(hex)"
    }

    // MARK: - Write

    func log(_ entry: LogEntry, wsRoot: URL) {
        do {
            let logsDir = try ClawNetDataManager.ensureDirectory(ClawNetDataManager.logsDir(wsRoot: wsRoot))
            let fileName = Self.dateString(from: entry.timestamp) + ".jsonl"
            let fileURL = logsDir.appendingPathComponent(fileName)

            let data = try JSONEncoder().encode(entry)
            guard var line = String(data: data, encoding: .utf8) else { return }
            line += "\n"

            if FileManager.default.fileExists(atPath: fileURL.path) {
                let handle = try FileHandle(forWritingTo: fileURL)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(Data(line.utf8))
            } else {
                try Data(line.utf8).write(to: fileURL, options: [.atomic])
            }
        } catch {
            logger.error("Failed to write log: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Query

    func query(filter: LogFilter, wsRoot: URL) -> LogQueryResult {
        let logsDir = ClawNetDataManager.logsDir(wsRoot: wsRoot)
        let fm = FileManager.default

        guard fm.fileExists(atPath: logsDir.path) else {
            return LogQueryResult(entries: [], total: 0, hasMore: false)
        }

        // Determine date range for files to read
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let sinceMs = filter.since ?? Self.startOfDayMs()
        let untilMs = filter.until ?? now

        let sinceDate = Self.dateString(from: sinceMs)
        let untilDate = Self.dateString(from: untilMs)

        // Collect all matching log files
        var allEntries: [LogEntry] = []
        if let files = try? fm.contentsOfDirectory(atPath: logsDir.path) {
            let sortedFiles = files.filter { $0.hasSuffix(".jsonl") }.sorted()
            for file in sortedFiles {
                let dateStr = String(file.dropLast(6)) // remove .jsonl
                if dateStr < sinceDate || dateStr > untilDate { continue }

                let fileURL = logsDir.appendingPathComponent(file)
                guard let data = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }

                let decoder = JSONDecoder()
                for line in data.components(separatedBy: "\n") where !line.isEmpty {
                    guard let lineData = line.data(using: .utf8),
                          let entry = try? decoder.decode(LogEntry.self, from: lineData) else { continue }

                    // Apply filters
                    if entry.timestamp < sinceMs || entry.timestamp > untilMs { continue }
                    if let sid = filter.sessionId, entry.sessionId != sid { continue }
                    if let cmd = filter.command, entry.command != cmd { continue }

                    allEntries.append(entry)
                }
            }
        }

        // Sort by timestamp descending (most recent first)
        allEntries.sort { $0.timestamp > $1.timestamp }

        let total = allEntries.count
        let offset = min(filter.offset, total)
        let end = min(offset + filter.limit, total)
        let paged = Array(allEntries[offset..<end])

        return LogQueryResult(entries: paged, total: total, hasMore: end < total)
    }

    // MARK: - Lookup

    /// Find a specific log entry by ID across all log files in the workspace.
    func findEntry(operationId: String, wsRoot: URL) -> LogEntry? {
        let logsDir = ClawNetDataManager.logsDir(wsRoot: wsRoot)
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: logsDir.path) else { return nil }

        let decoder = JSONDecoder()
        // Search in reverse chronological order (most recent files first)
        for file in files.filter({ $0.hasSuffix(".jsonl") }).sorted().reversed() {
            let fileURL = logsDir.appendingPathComponent(file)
            guard let data = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            for line in data.components(separatedBy: "\n") where !line.isEmpty {
                guard let lineData = line.data(using: .utf8),
                      let entry = try? decoder.decode(LogEntry.self, from: lineData) else { continue }
                if entry.id == operationId { return entry }
            }
        }
        return nil
    }

    /// Check if an operation has been undone (exists an undo entry targeting it).
    func isUndone(operationId: String, wsRoot: URL) -> Bool {
        let logsDir = ClawNetDataManager.logsDir(wsRoot: wsRoot)
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: logsDir.path) else { return false }

        let decoder = JSONDecoder()
        for file in files.filter({ $0.hasSuffix(".jsonl") }).sorted().reversed() {
            let fileURL = logsDir.appendingPathComponent(file)
            guard let data = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            for line in data.components(separatedBy: "\n") where !line.isEmpty {
                guard let lineData = line.data(using: .utf8),
                      let entry = try? decoder.decode(LogEntry.self, from: lineData) else { continue }
                if entry.type == "undo" && entry.undoTargetId == operationId { return true }
            }
        }
        return false
    }

    // MARK: - Helpers

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        return f
    }()

    static func dateString(from timestampMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(timestampMs) / 1000.0)
        return dateFormatter.string(from: date)
    }

    static func startOfDayMs() -> Int64 {
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        return Int64(start.timeIntervalSince1970 * 1000)
    }
}

// MARK: - JSON Value (type-erased Codable)

/// A simple type-erased JSON value for storing arbitrary params in log entries.
enum JSONValue: Codable, Equatable {
    case string(String)
    case int(Int64)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int64.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if container.decodeNil() { self = .null }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }
}

/// Convert [String: Any] params to [String: JSONValue] for logging.
func paramsToJSONValues(_ params: [String: Any]) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    for (key, value) in params {
        switch value {
        case let v as String: result[key] = .string(v)
        case let v as Bool: result[key] = .bool(v)
        case let v as Int: result[key] = .int(Int64(v))
        case let v as Int64: result[key] = .int(v)
        case let v as Double: result[key] = .double(v)
        default: result[key] = .null
        }
    }
    return result
}
