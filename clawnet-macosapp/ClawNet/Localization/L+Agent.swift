import Foundation

@MainActor
extension L {
    // MARK: - Agent List
    static var noAgents: String { switch current { case .zhHans: "没有 Agent"; case .zhHant: "沒有 Agent"; case .en: "No Agents" } }
    static var createFirstAgent: String { switch current { case .zhHans: "点击右上角创建你的第一个 Agent"; case .zhHant: "點擊右上角建立你的第一個 Agent"; case .en: "Click top-right to create your first Agent" } }
    static var createAgent: String { switch current { case .zhHans: "创建 Agent"; case .zhHant: "建立 Agent"; case .en: "Create Agent" } }

    // MARK: - Agent Creation Wizard
    static func stepOf(_ current: Int, _ total: Int) -> String { switch self.current { case .zhHans: "步骤 \(current)/\(total)"; case .zhHant: "步驟 \(current)/\(total)"; case .en: "Step \(current)/\(total)" } }
    static var previousStep: String { switch current { case .zhHans: "上一步"; case .zhHant: "上一步"; case .en: "Back" } }
    static var nextStep: String { switch current { case .zhHans: "下一步"; case .zhHant: "下一步"; case .en: "Next" } }
    static var agentName: String { switch current { case .zhHans: "给你的 Agent 起个名字"; case .zhHant: "給你的 Agent 起個名字"; case .en: "Name your Agent" } }
    static var agentDescription: String { switch current { case .zhHans: "描述这个 Agent 的用途（可选）"; case .zhHant: "描述這個 Agent 的用途（可選）"; case .en: "Describe this Agent's purpose (optional)" } }
    static var description: String { switch current { case .zhHans: "描述"; case .zhHant: "描述"; case .en: "Description" } }

    // MARK: - Agent Capabilities
    static var capabilityConfig: String { switch current { case .zhHans: "能力配置"; case .zhHant: "能力配置"; case .en: "Capabilities" } }
    static var executionMode: String { switch current { case .zhHans: "执行模式"; case .zhHant: "執行模式"; case .en: "Execution Mode" } }
    static var local: String { switch current { case .zhHans: "本地"; case .zhHant: "本地"; case .en: "Local" } }
    static var cloud: String { switch current { case .zhHans: "云端"; case .zhHant: "雲端"; case .en: "Cloud" } }
    static var hybrid: String { switch current { case .zhHans: "混合"; case .zhHant: "混合"; case .en: "Hybrid" } }
    static var proactivity: String { switch current { case .zhHans: "主动性"; case .zhHant: "主動性"; case .en: "Proactivity" } }
    static var selectCapabilities: String { switch current { case .zhHans: "选择能力"; case .zhHant: "選擇能力"; case .en: "Select Capabilities" } }

    // MARK: - Agent Profile
    static var systemPrompt: String { switch current { case .zhHans: "系统提示词"; case .zhHant: "系統提示詞"; case .en: "System Prompt" } }
    static var selectAgentCapabilities: String { switch current { case .zhHans: "选择 Agent 能力"; case .zhHant: "選擇 Agent 能力"; case .en: "Select Agent Capabilities" } }
    static var modelProvider: String { switch current { case .zhHans: "模型提供方"; case .zhHant: "模型提供方"; case .en: "Model Provider" } }
    static var modelProviderPlaceholder: String { switch current { case .zhHans: "例如: anthropic"; case .zhHant: "例如: anthropic"; case .en: "e.g. anthropic" } }
    static var modelNameLabel: String { switch current { case .zhHans: "模型名称"; case .zhHant: "模型名稱"; case .en: "Model Name" } }
    static var modelNamePlaceholder: String { switch current { case .zhHans: "例如: claude-sonnet-4-6"; case .zhHant: "例如: claude-sonnet-4-6"; case .en: "e.g. claude-sonnet-4-6" } }

    // MARK: - Agent Permissions
    static var permissionSettings: String { switch current { case .zhHans: "权限设置"; case .zhHant: "權限設定"; case .en: "Permissions" } }
    static var readFiles: String { switch current { case .zhHans: "读取文件"; case .zhHant: "讀取檔案"; case .en: "Read Files" } }
    static var writeFiles: String { switch current { case .zhHans: "写入文件"; case .zhHant: "寫入檔案"; case .en: "Write Files" } }
    static var networkAccess: String { switch current { case .zhHans: "网络访问"; case .zhHant: "網路存取"; case .en: "Network Access" } }
    static var executeCode: String { switch current { case .zhHans: "执行代码"; case .zhHant: "執行程式碼"; case .en: "Execute Code" } }
    static var calendarAccess: String { switch current { case .zhHans: "日历访问"; case .zhHant: "行事曆存取"; case .en: "Calendar Access" } }
    static var emailAccess: String { switch current { case .zhHans: "邮件访问"; case .zhHant: "郵件存取"; case .en: "Email Access" } }
    static var maxConcurrentTasks: String { switch current { case .zhHans: "最大并发任务"; case .zhHant: "最大並發任務"; case .en: "Max Concurrent Tasks" } }

    // MARK: - Agent Analytics
    static var analytics: String { switch current { case .zhHans: "运行统计"; case .zhHant: "運行統計"; case .en: "Analytics" } }
    static var totalTasks: String { switch current { case .zhHans: "总任务"; case .zhHant: "總任務"; case .en: "Total Tasks" } }
    static var completedTasks: String { switch current { case .zhHans: "已完成"; case .zhHant: "已完成"; case .en: "Completed" } }
    static var failedTasks: String { switch current { case .zhHans: "失败"; case .zhHant: "失敗"; case .en: "Failed" } }
    static var avgResponse: String { switch current { case .zhHans: "平均响应"; case .zhHant: "平均回應"; case .en: "Avg Response" } }
    static var lastActive: String { switch current { case .zhHans: "最后活跃:"; case .zhHant: "最後活躍:"; case .en: "Last active:" } }
    static var noData: String { switch current { case .zhHans: "暂无数据"; case .zhHant: "暫無數據"; case .en: "No Data" } }
    static var noDataDescription: String { switch current { case .zhHans: "Agent 运行后将显示统计数据"; case .zhHant: "Agent 運行後將顯示統計數據"; case .en: "Statistics will appear after Agent runs" } }
    static var confirmCreate: String { switch current { case .zhHans: "确认创建"; case .zhHant: "確認建立"; case .en: "Confirm Creation" } }

    // MARK: - Agent Dialog
    static var startAgentDialog: String { switch current { case .zhHans: "发起 Agent 对话"; case .zhHant: "發起 Agent 對話"; case .en: "Start Agent Dialog" } }
    static var selectYourAgent: String { switch current { case .zhHans: "选择你的 Agent"; case .zhHant: "選擇你的 Agent"; case .en: "Select Your Agent" } }
    static var selectYourAgentDescription: String { switch current { case .zhHans: "选择将代表你参与对话的 Agent"; case .zhHant: "選擇將代表你參與對話的 Agent"; case .en: "Select the Agent that will represent you" } }
    static var selectTargetAgent: String { switch current { case .zhHans: "选择目标 Agent"; case .zhHant: "選擇目標 Agent"; case .en: "Select Target Agent" } }
    static var selectTargetAgentDescription: String { switch current { case .zhHans: "选择要与你的 Agent 对话的目标 Agent"; case .zhHant: "選擇要與你的 Agent 對話的目標 Agent"; case .en: "Select the Agent to dialog with" } }
    static var noContactableAgents: String { switch current { case .zhHans: "没有可联系的 Agent"; case .zhHant: "沒有可聯絡的 Agent"; case .en: "No contactable Agents" } }
    static var noOtherAgents: String { switch current { case .zhHans: "没有其他可用的 Agent"; case .zhHant: "沒有其他可用的 Agent"; case .en: "No other Agents available" } }
    static var createAgentFirst: String { switch current { case .zhHans: "请先创建一个 Agent"; case .zhHant: "請先建立一個 Agent"; case .en: "Create an Agent first" } }
    static var dialogSettings: String { switch current { case .zhHans: "设置对话参数"; case .zhHant: "設定對話參數"; case .en: "Dialog Settings" } }
    static var yourAgent: String { switch current { case .zhHans: "你的 Agent"; case .zhHant: "你的 Agent"; case .en: "Your Agent" } }
    static var targetAgent: String { switch current { case .zhHans: "目标 Agent"; case .zhHant: "目標 Agent"; case .en: "Target Agent" } }
    static var dialogTopic: String { switch current { case .zhHans: "对话话题"; case .zhHant: "對話話題"; case .en: "Dialog Topic" } }
    static var dialogTopicPlaceholder: String { switch current { case .zhHans: "描述对话的主题和目标"; case .zhHant: "描述對話的主題和目標"; case .en: "Describe the topic and goal" } }
    static var maxRounds: String { switch current { case .zhHans: "最大对话轮数"; case .zhHant: "最大對話輪數"; case .en: "Max Rounds" } }
    static var startDialog: String { switch current { case .zhHans: "发起对话"; case .zhHant: "發起對話"; case .en: "Start Dialog" } }

    // MARK: - Agent Dialog Control Bar
    static var rounds: String { switch current { case .zhHans: "轮次"; case .zhHant: "輪次"; case .en: "Rounds" } }
    static var extend: String { switch current { case .zhHans: "延长"; case .zhHant: "延長"; case .en: "Extend" } }
    static var terminate: String { switch current { case .zhHans: "终止"; case .zhHant: "終止"; case .en: "Terminate" } }
    static var terminateDialog: String { switch current { case .zhHans: "终止对话"; case .zhHant: "終止對話"; case .en: "Terminate Dialog" } }
    static var confirmTerminate: String { switch current { case .zhHans: "确认终止"; case .zhHant: "確認終止"; case .en: "Confirm Terminate" } }
    static var confirmTerminateMessage: String { switch current { case .zhHans: "确定要终止此 Agent 对话吗？"; case .zhHant: "確定要終止此 Agent 對話嗎？"; case .en: "Are you sure you want to terminate this Agent dialog?" } }
    static var addRoundsPrefix: String { switch current { case .zhHans: "追加"; case .zhHant: "追加"; case .en: "Add" } }
    static var addRoundsSuffix: String { switch current { case .zhHans: "轮"; case .zhHant: "輪"; case .en: "rounds" } }
}
