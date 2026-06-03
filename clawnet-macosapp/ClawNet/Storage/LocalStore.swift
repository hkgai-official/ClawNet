import Foundation
import GRDB
import OSLog

/// Central local SQLite database for offline caching of conversations and messages.
actor LocalStore {
    static let shared = LocalStore()

    private var dbPool: DatabasePool?
    private let logger = Logger(subsystem: "ai.clawnet", category: "LocalStore")

    private init() {}

    // MARK: - Setup

    func setup() throws {
        let dir = Self.appSupportDirectory()
        let dbPath = dir.appendingPathComponent("clawnet.db").path
        let config = Configuration()

        let pool = try DatabasePool(path: dbPath, configuration: config)
        try migrator.migrate(pool)
        self.dbPool = pool
        logger.info("Database opened at \(dbPath, privacy: .public)")
    }

    private static func appSupportDirectory() -> URL {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("ai.clawnet.macos")
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: - Migrations

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        #if DEBUG
        migrator.eraseDatabaseOnSchemaChange = true
        #endif

        migrator.registerMigration("v1_create_tables") { db in
            try db.create(table: "conversations") { t in
                t.primaryKey("id", .text).notNull()
                t.column("type", .text).notNull()
                t.column("title", .text)
                t.column("participantsJson", .text).notNull().defaults(to: "[]")
                t.column("lastMessagePreview", .text)
                t.column("lastMessageAt", .datetime)
                t.column("unreadCount", .integer).notNull().defaults(to: 0)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "messages") { t in
                t.primaryKey("id", .text).notNull()
                t.column("conversationId", .text).notNull()
                t.column("senderJson", .text).notNull()
                t.column("contentType", .text).notNull()
                t.column("contentJson", .text).notNull()
                t.column("timestamp", .datetime).notNull()
                t.column("status", .text)
            }

            try db.create(
                index: "idx_messages_conv_time",
                on: "messages",
                columns: ["conversationId", "timestamp"]
            )

            try db.create(table: "syncState") { t in
                t.primaryKey("conversationId", .text).notNull()
                t.column("lastSyncedMessageId", .text)
                t.column("lastSyncedAt", .datetime)
                t.column("hasMoreHistory", .boolean).notNull().defaults(to: true)
            }
        }

        migrator.registerMigration("v2_add_content_raw") { db in
            try db.alter(table: "messages") { t in
                t.add(column: "contentRawJson", .text)
            }
        }

        migrator.registerMigration("v3_add_summary") { db in
            try db.alter(table: "conversations") { t in
                t.add(column: "summary", .text)
            }
        }

        return migrator
    }

    // MARK: - Database Access Helpers

    private func reader() throws -> DatabasePool {
        guard let pool = dbPool else { throw LocalStoreError.notInitialized }
        return pool
    }

    private func writer() throws -> DatabasePool {
        guard let pool = dbPool else { throw LocalStoreError.notInitialized }
        return pool
    }

    // MARK: - Conversations

    func saveConversations(_ records: [ConversationRecord]) throws {
        let pool = try writer()
        try pool.write { db in
            for record in records {
                try record.save(db)
            }
        }
    }

    func loadAllConversations() throws -> [ConversationRecord] {
        let pool = try reader()
        return try pool.read { db in
            try ConversationRecord
                .order(Column("updatedAt").desc)
                .fetchAll(db)
        }
    }

    func deleteConversation(id: String) throws {
        let pool = try writer()
        try pool.write { db in
            try ConversationRecord.deleteOne(db, key: id)
        }
    }

    // MARK: - Messages

    func saveMessages(_ records: [MessageRecord]) throws {
        let pool = try writer()
        try pool.write { db in
            for record in records {
                try record.save(db)
            }
        }
    }

    func loadMessages(conversationId: String, limit: Int = 50) throws -> [MessageRecord] {
        let pool = try reader()
        return try pool.read { db in
            try MessageRecord
                .filter(Column("conversationId") == conversationId)
                .order(Column("timestamp").asc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func loadMessages(conversationId: String, beforeTimestamp: Date, limit: Int = 50) throws -> [MessageRecord] {
        let pool = try reader()
        return try pool.read { db in
            let records = try MessageRecord
                .filter(Column("conversationId") == conversationId)
                .filter(Column("timestamp") < beforeTimestamp)
                .order(Column("timestamp").desc)
                .limit(limit)
                .fetchAll(db)
            return Array(records.reversed())
        }
    }

    func newestMessage(conversationId: String) throws -> MessageRecord? {
        let pool = try reader()
        return try pool.read { db in
            try MessageRecord
                .filter(Column("conversationId") == conversationId)
                .order(Column("timestamp").desc)
                .fetchOne(db)
        }
    }

    func updateMessageStatus(id: String, newId: String?, status: String) throws {
        let pool = try writer()
        try pool.write { db in
            if let existing = try MessageRecord.fetchOne(db, key: id) {
                var updated = existing
                updated.status = status
                if let newId, newId != id {
                    try existing.delete(db)
                    updated.id = newId
                }
                try updated.save(db)
            }
        }
    }

    func deleteMessages(conversationId: String) throws {
        let pool = try writer()
        try pool.write { db in
            try MessageRecord
                .filter(Column("conversationId") == conversationId)
                .deleteAll(db)
        }
    }

    func deleteMessage(id: String) throws {
        let pool = try writer()
        try pool.write { db in
            try MessageRecord.deleteOne(db, key: id)
        }
    }

    // MARK: - Sync State

    func getSyncState(conversationId: String) throws -> SyncStateRecord? {
        let pool = try reader()
        return try pool.read { db in
            try SyncStateRecord.fetchOne(db, key: conversationId)
        }
    }

    func saveSyncState(_ record: SyncStateRecord) throws {
        let pool = try writer()
        try pool.write { db in
            try record.save(db)
        }
    }

    // MARK: - Cleanup

    func clearAll() throws {
        let pool = try writer()
        try pool.write { db in
            try MessageRecord.deleteAll(db)
            try SyncStateRecord.deleteAll(db)
            try ConversationRecord.deleteAll(db)
        }
    }
}

enum LocalStoreError: Error, LocalizedError {
    case notInitialized

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "LocalStore database not initialized. Call setup() first."
        }
    }
}
