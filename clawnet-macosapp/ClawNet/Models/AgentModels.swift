import Foundation

// MARK: - Agent

struct Agent: Identifiable, Codable, Sendable {
    let id: String
    var conversationId: String?
    var config: AgentConfig
    var status: AgentStatus
    var analytics: AgentAnalytics?
    var ownerId: String?
    var agentType: String?
    var interactionMode: String?
    var ownerName: String?
    var tagId: String?
    var tagName: String?
    var tagDisplayName: String?
    var tagRole: String?
    var createdAt: Date
    var updatedAt: Date

    // Server returns flat fields — map them into nested AgentConfig for UI compatibility
    private enum CodingKeys: String, CodingKey {
        case id, conversationId, status, analytics, createdAt, updatedAt
        case ownerId, agentType, interactionMode, ownerName
        case tagId, tagName, tagDisplayName, tagRole
        // Flat fields that map into AgentConfig
        case displayName, description, avatarUrl, systemPrompt
        case capabilities, executionMode, proactiveIntensity, proactiveRules
        case permissionScope, modelConfigData
        // Nested config (for local encoding only)
        case config
    }

    init(
        id: String,
        conversationId: String? = nil,
        config: AgentConfig,
        status: AgentStatus,
        analytics: AgentAnalytics? = nil,
        ownerId: String? = nil,
        agentType: String? = nil,
        interactionMode: String? = nil,
        ownerName: String? = nil,
        tagId: String? = nil,
        tagName: String? = nil,
        tagDisplayName: String? = nil,
        tagRole: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.conversationId = conversationId
        self.config = config
        self.status = status
        self.analytics = analytics
        self.ownerId = ownerId
        self.agentType = agentType
        self.interactionMode = interactionMode
        self.ownerName = ownerName
        self.tagId = tagId
        self.tagName = tagName
        self.tagDisplayName = tagDisplayName
        self.tagRole = tagRole
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        conversationId = try container.decodeIfPresent(String.self, forKey: .conversationId)
        status = (try? container.decode(AgentStatus.self, forKey: .status)) ?? .offline
        analytics = try container.decodeIfPresent(AgentAnalytics.self, forKey: .analytics)
        ownerId = try container.decodeIfPresent(String.self, forKey: .ownerId)
        agentType = try container.decodeIfPresent(String.self, forKey: .agentType)
        interactionMode = try container.decodeIfPresent(String.self, forKey: .interactionMode)
        ownerName = try container.decodeIfPresent(String.self, forKey: .ownerName)
        tagId = try container.decodeIfPresent(String.self, forKey: .tagId)
        tagName = try container.decodeIfPresent(String.self, forKey: .tagName)
        tagDisplayName = try container.decodeIfPresent(String.self, forKey: .tagDisplayName)
        tagRole = try container.decodeIfPresent(String.self, forKey: .tagRole)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)

        // Try decoding flat server response fields into AgentConfig
        if let displayName = try? container.decode(String.self, forKey: .displayName) {
            var cfg = AgentConfig(
                displayName: displayName,
                description: try container.decodeIfPresent(String.self, forKey: .description)
            )
            cfg.avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
            cfg.systemPrompt = try container.decodeIfPresent(String.self, forKey: .systemPrompt)
            cfg.capabilities = Self.decodeCapabilities(container: container)
            cfg.executionMode = (try? container.decode(ExecutionMode.self, forKey: .executionMode)) ?? .hybrid
            cfg.proactiveIntensity = (try? container.decode(ProactiveIntensity.self, forKey: .proactiveIntensity)) ?? .medium
            cfg.proactiveRules = try container.decodeIfPresent([ProactiveRule].self, forKey: .proactiveRules)

            // Map permission_scope dict → AgentPermissions
            if let scope = try? container.decode([String: AnyCodable].self, forKey: .permissionScope) {
                cfg.permissions = AgentPermissions(fromScope: scope)
            }

            // Map model_config_data dict → modelProvider/modelName
            if let modelConfig = try? container.decode([String: AnyCodable].self, forKey: .modelConfigData) {
                cfg.modelProvider = modelConfig["provider"]?.stringValue
                cfg.modelName = modelConfig["model"]?.stringValue
            }

            config = cfg
        } else {
            // Fallback: try nested config object (local encoding)
            config = try container.decode(AgentConfig.self, forKey: .config)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(conversationId, forKey: .conversationId)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(analytics, forKey: .analytics)
        try container.encodeIfPresent(ownerId, forKey: .ownerId)
        try container.encodeIfPresent(agentType, forKey: .agentType)
        try container.encodeIfPresent(interactionMode, forKey: .interactionMode)
        try container.encodeIfPresent(ownerName, forKey: .ownerName)
        try container.encodeIfPresent(tagId, forKey: .tagId)
        try container.encodeIfPresent(tagName, forKey: .tagName)
        try container.encodeIfPresent(tagDisplayName, forKey: .tagDisplayName)
        try container.encodeIfPresent(tagRole, forKey: .tagRole)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(config, forKey: .config)
    }

    /// Decode capabilities tolerantly — unknown values are skipped
    private static func decodeCapabilities(container: KeyedDecodingContainer<CodingKeys>) -> [AgentCapability] {
        guard let strings = try? container.decode([String].self, forKey: .capabilities) else {
            return []
        }
        return strings.compactMap { AgentCapability(rawValue: $0) }
    }
}

struct AgentConfig: Codable, Sendable {
    var displayName: String
    var description: String?
    var avatarUrl: String?
    var systemPrompt: String?
    var capabilities: [AgentCapability]
    var executionMode: ExecutionMode
    var proactiveIntensity: ProactiveIntensity
    var proactiveRules: [ProactiveRule]?
    var permissions: AgentPermissions?
    var modelProvider: String?
    var modelName: String?

    init(displayName: String, description: String? = nil) {
        self.displayName = displayName
        self.description = description
        self.capabilities = []
        self.executionMode = .hybrid
        self.proactiveIntensity = .medium
    }
}

enum AgentStatus: String, Codable, Sendable {
    case online, busy, offline, error
}

enum ExecutionMode: String, Codable, Sendable {
    case local, cloud, hybrid
}

enum ProactiveIntensity: String, Codable, Sendable, CaseIterable {
    case off, low, medium, high
}

enum AgentCapability: String, Codable, Sendable, CaseIterable {
    case fileProcessing = "file_processing"
    case webSearch = "web_search"
    case codeExecution = "code_execution"
    case dataAnalysis = "data_analysis"
    case scheduling
    case emailAccess = "email_access"
    case calendarAccess = "calendar_access"
    case documentEditing = "document_editing"
    case imageGeneration = "image_generation"
    case translation

    var displayName: String {
        switch self {
        case .fileProcessing: "文件处理"
        case .webSearch: "网络搜索"
        case .codeExecution: "代码执行"
        case .dataAnalysis: "数据分析"
        case .scheduling: "日程安排"
        case .emailAccess: "邮件访问"
        case .calendarAccess: "日历访问"
        case .documentEditing: "文档编辑"
        case .imageGeneration: "图片生成"
        case .translation: "翻译"
        }
    }

    var iconName: String {
        switch self {
        case .fileProcessing: "doc.on.doc"
        case .webSearch: "globe"
        case .codeExecution: "terminal"
        case .dataAnalysis: "chart.bar"
        case .scheduling: "clock"
        case .emailAccess: "envelope"
        case .calendarAccess: "calendar"
        case .documentEditing: "pencil.and.outline"
        case .imageGeneration: "paintbrush"
        case .translation: "textformat.abc"
        }
    }
}

struct AgentPermissions: Codable, Sendable {
    var canReadFiles: Bool
    var canWriteFiles: Bool
    var canAccessNetwork: Bool
    var canExecuteCode: Bool
    var canAccessCalendar: Bool
    var canAccessEmail: Bool
    var maxConcurrentTasks: Int
    var requireApprovalFor: [String]?

    init() {
        canReadFiles = true
        canWriteFiles = false
        canAccessNetwork = true
        canExecuteCode = false
        canAccessCalendar = false
        canAccessEmail = false
        maxConcurrentTasks = 3
    }

    /// Initialize from server's permission_scope dict
    init(fromScope scope: [String: AnyCodable]) {
        canReadFiles = scope["can_read_files"]?.boolValue ?? true
        canWriteFiles = scope["can_write_files"]?.boolValue ?? false
        canAccessNetwork = scope["can_access_network"]?.boolValue ?? true
        canExecuteCode = scope["can_execute_code"]?.boolValue ?? false
        canAccessCalendar = scope["can_access_calendar"]?.boolValue ?? false
        canAccessEmail = scope["can_access_email"]?.boolValue ?? false
        maxConcurrentTasks = scope["max_concurrent_tasks"]?.intValue ?? 3
        requireApprovalFor = scope["require_approval_for"]?.stringArrayValue
    }

    /// Convert to server's permission_scope dict format
    func toScope() -> [String: Any] {
        var scope: [String: Any] = [
            "can_read_files": canReadFiles,
            "can_write_files": canWriteFiles,
            "can_access_network": canAccessNetwork,
            "can_execute_code": canExecuteCode,
            "can_access_calendar": canAccessCalendar,
            "can_access_email": canAccessEmail,
            "max_concurrent_tasks": maxConcurrentTasks,
        ]
        if let requireApprovalFor {
            scope["require_approval_for"] = requireApprovalFor
        }
        return scope
    }
}

struct AgentAnalytics: Codable, Sendable {
    var totalTasks: Int
    var completedTasks: Int
    var failedTasks: Int
    var averageResponseTime: Double?
    var lastActiveAt: Date?
}

struct ProactiveRule: Identifiable, Codable, Sendable {
    var id: String
    var trigger: String
    var condition: String
    var action: String
    var enabled: Bool
}

// MARK: - Agent Dialog Session

struct DialogSession: Identifiable, Codable, Sendable {
    let id: String
    var initiatorAgent: DialogAgentInfo
    var responderAgent: DialogAgentInfo
    var initiatorOwner: DialogUserInfo
    var responderOwner: DialogUserInfo
    var topic: String
    var status: DialogStatus
    var currentRound: Int
    var maxRounds: Int
    var conversationId: String?
    var createdAt: Date
    var startedAt: Date?
    var lastMessageAt: Date?
    var completedAt: Date?
    var terminationReason: String?
}

struct DialogAgentInfo: Codable, Sendable {
    let id: String
    let displayName: String
    var avatarUrl: String?
    var status: String?
}

struct DialogUserInfo: Codable, Sendable {
    let id: String
    let displayName: String
    var avatarUrl: String?
}

enum DialogStatus: String, Codable, Sendable {
    case pendingApproval = "pending_approval"
    case active
    case paused
    case completed
    case terminated

    var displayName: String {
        switch self {
        case .pendingApproval: "等待审批"
        case .active: "进行中"
        case .paused: "已暂停"
        case .completed: "已完成"
        case .terminated: "已终止"
        }
    }

    var color: String {
        switch self {
        case .pendingApproval: "yellow"
        case .active: "blue"
        case .paused: "purple"
        case .completed: "green"
        case .terminated: "red"
        }
    }
}

// MARK: - Task Progress / Result

struct TaskProgress: Codable, Sendable {
    let taskId: String
    var stage: String
    var progress: Double
    var details: [String: String]?
}

struct TaskResult: Codable, Sendable {
    let taskId: String
    var success: Bool
    var summary: String
    var error: String?
    var details: TaskResultDetails?
}

struct TaskResultDetails: Codable, Sendable {
    var filesProcessed: Int?
    var logs: [String]?
}

// MARK: - Approval Request

struct ApprovalRequest: Identifiable, Codable, Sendable {
    let id: String
    var operationType: String
    var description: String
    var status: ApprovalStatus

    enum ApprovalStatus: String, Codable, Sendable {
        case pending, approved, rejected, modified
    }
}

// MARK: - Execution Log

struct ExecutionLog: Identifiable, Codable, Sendable {
    var id: String { "\(timestamp)-\(step)" }
    let timestamp: Double
    let step: String
    let message: String
    var level: LogLevel?
    var details: [String: String]?

    enum LogLevel: String, Codable, Sendable {
        case info, warning, error, debug
    }
}


// MARK: - Discovery Task

struct DiscoveryTask: Identifiable, Codable, Sendable {
    let id: String
    let sourceConversationId: String
    let initiatorAgentId: String
    let initiatorOwnerId: String
    var status: String
    var originalIntent: String
    var maxHops: Int
    var currentHopCount: Int
    var maxConcurrent: Int
    var pendingQueries: [[String: AnyCodable]]
    var completedResults: [[String: AnyCodable]]
    var activeSessions: [[String: AnyCodable]]
    var createdAt: Date
    var updatedAt: Date
    var completedAt: Date?
}

// MARK: - Server Task

struct ServerTask: Identifiable, Codable, Sendable {
    let id: String
    let agentId: String
    let conversationId: String
    var description: String?
    var status: String
    var executionPlan: [String: AnyCodable]?
    var result: [String: AnyCodable]?
    var error: String?
    var priority: String
    var createdAt: Date
    var startedAt: Date?
    var completedAt: Date?
}
