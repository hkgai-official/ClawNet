import Foundation

@MainActor
extension L {
    // MARK: - Approval Card
    static var approvalRequest: String { switch current { case .zhHans: "审批请求"; case .zhHant: "審批請求"; case .en: "Approval Request" } }
    static var pending: String { switch current { case .zhHans: "待审批"; case .zhHant: "待審批"; case .en: "Pending" } }
    static var approved: String { switch current { case .zhHans: "已批准"; case .zhHant: "已批准"; case .en: "Approved" } }
    static var rejected: String { switch current { case .zhHans: "已拒绝"; case .zhHant: "已拒絕"; case .en: "Rejected" } }
    static var modified: String { switch current { case .zhHans: "已修改"; case .zhHant: "已修改"; case .en: "Modified" } }

    // MARK: - Task Cards
    static var taskInProgress: String { switch current { case .zhHans: "任务执行中"; case .zhHant: "任務執行中"; case .en: "Task In Progress" } }
    static var taskCompleted: String { switch current { case .zhHans: "任务完成"; case .zhHant: "任務完成"; case .en: "Task Completed" } }
    static var taskFailed: String { switch current { case .zhHans: "任务失败"; case .zhHant: "任務失敗"; case .en: "Task Failed" } }
    static var details: String { switch current { case .zhHans: "详情"; case .zhHant: "詳情"; case .en: "Details" } }
    static var filesProcessed: String { switch current { case .zhHans: "处理文件数:"; case .zhHant: "處理檔案數:"; case .en: "Files processed:" } }
    static var logs: String { switch current { case .zhHans: "日志:"; case .zhHant: "日誌:"; case .en: "Logs:" } }
    static var processing: String { switch current { case .zhHans: "处理中"; case .zhHant: "處理中"; case .en: "Processing" } }

    // MARK: - Dialog Cards
    static var dialogRequestSent: String { switch current { case .zhHans: "Agent 对话请求已发送"; case .zhHant: "Agent 對話請求已發送"; case .en: "Agent Dialog Request Sent" } }
    static var authRequestSent: String { switch current { case .zhHans: "已向对方发送授权请求"; case .zhHant: "已向對方傳送授權請求"; case .en: "Authorization request sent" } }
    static var topic: String { switch current { case .zhHans: "议题"; case .zhHant: "議題"; case .en: "Topic" } }
    static var dialogConfirmed: String { switch current { case .zhHans: "对方已授权，对话进行中"; case .zhHant: "對方已授權，對話進行中"; case .en: "Authorized, dialog in progress" } }
    static var dialogCompleted: String { switch current { case .zhHans: "对话已完成"; case .zhHant: "對話已完成"; case .en: "Dialog completed" } }
    static var dialogRejected: String { switch current { case .zhHans: "对方已拒绝"; case .zhHant: "對方已拒絕"; case .en: "Rejected by other party" } }
    static var waitingAuth: String { switch current { case .zhHans: "等待对方授权..."; case .zhHant: "等待對方授權..."; case .en: "Waiting for authorization..." } }
    static var dialogAuthRequest: String { switch current { case .zhHans: "Agent 对话授权请求"; case .zhHant: "Agent 對話授權請求"; case .en: "Agent Dialog Authorization Request" } }
    static var initiator: String { switch current { case .zhHans: "发起方"; case .zhHant: "發起方"; case .en: "Initiator" } }
    static var myAgent: String { switch current { case .zhHans: "我的 Agent"; case .zhHant: "我的 Agent"; case .en: "My Agent" } }
    static var authorizeDialog: String { switch current { case .zhHans: "授权对话"; case .zhHant: "授權對話"; case .en: "Authorize Dialog" } }
    static var authorizedInProgress: String { switch current { case .zhHans: "已授权，对话进行中"; case .zhHant: "已授權，對話進行中"; case .en: "Authorized, in progress" } }

    // MARK: - Intent Authorization
    static var securityReminder: String { switch current { case .zhHans: "信息安全提醒"; case .zhHant: "資訊安全提醒"; case .en: "Security Reminder" } }
    static var mainAgentSecurityNote: String { switch current { case .zhHans: "为了您的信息安全，Main Assistant 不能直接联系其他人。请使用其他助手发起对话。"; case .zhHant: "為了您的資訊安全，Main Assistant 不能直接聯繫其他人。請使用其他助手發起對話。"; case .en: "For security, Main Assistant cannot contact others directly. Use another agent." } }
    static var understood: String { switch current { case .zhHans: "知道了"; case .zhHant: "知道了"; case .en: "Got it" } }
    static var dialogAuthorizationRequest: String { switch current { case .zhHans: "对话授权请求"; case .zhHant: "對話授權請求"; case .en: "Dialog Authorization" } }
    static func agentWantsToDialog(_ name: String) -> String { switch current { case .zhHans: "\(name) 希望与以下 Agent 发起对话："; case .zhHant: "\(name) 希望與以下 Agent 發起對話："; case .en: "\(name) wants to start a dialog with:" } }
    static var unknownUser: String { switch current { case .zhHans: "未知用户"; case .zhHant: "未知使用者"; case .en: "Unknown User" } }
    static var pendingAuth: String { switch current { case .zhHans: "待授权"; case .zhHant: "待授權"; case .en: "Pending" } }
    static var authorized: String { switch current { case .zhHans: "已授权"; case .zhHant: "已授權"; case .en: "Authorized" } }
    static var denied: String { switch current { case .zhHans: "已拒绝"; case .zhHant: "已拒絕"; case .en: "Denied" } }

    // MARK: - Discovery Task
    static var multiUserDiscovery: String { switch current { case .zhHans: "多用户发现任务"; case .zhHant: "多用戶發現任務"; case .en: "Multi-User Discovery Task" } }
    static var pendingConfirm: String { switch current { case .zhHans: "待确认"; case .zhHant: "待確認"; case .en: "Pending" } }
    static var running: String { switch current { case .zhHans: "进行中"; case .zhHant: "進行中"; case .en: "Running" } }
    static var summarizing: String { switch current { case .zhHans: "汇总中"; case .zhHant: "彙總中"; case .en: "Summarizing" } }
    static var completed: String { switch current { case .zhHans: "已完成"; case .zhHant: "已完成"; case .en: "Completed" } }
    static var cancelled: String { switch current { case .zhHans: "已取消"; case .zhHant: "已取消"; case .en: "Cancelled" } }
    static var failed: String { switch current { case .zhHans: "失败"; case .zhHant: "失敗"; case .en: "Failed" } }
    static func completedOf(_ done: Int, _ total: Int) -> String { switch current { case .zhHans: "\(done)/\(total) 已完成"; case .zhHant: "\(done)/\(total) 已完成"; case .en: "\(done)/\(total) completed" } }
    static func contacting(_ name: String) -> String { switch current { case .zhHans: "正在联系 \(name)"; case .zhHant: "正在聯繫 \(name)"; case .en: "Contacting \(name)" } }
    static func pendingContact(_ name: String) -> String { switch current { case .zhHans: "待联系 \(name)"; case .zhHant: "待聯繫 \(name)"; case .en: "Pending: \(name)" } }
    static var confirmExecute: String { switch current { case .zhHans: "确认执行"; case .zhHant: "確認執行"; case .en: "Confirm" } }

    // MARK: - A2A Fallbacks
    static var myAssistant: String { switch current { case .zhHans: "我的助手"; case .zhHant: "我的助手"; case .en: "My Agent" } }
    static var otherAgent: String { switch current { case .zhHans: "对方助手"; case .zhHant: "對方助手"; case .en: "Other Agent" } }
    static var otherParty: String { switch current { case .zhHans: "对方"; case .zhHant: "對方"; case .en: "Other Party" } }
    static func agentOf(_ owner: String, _ agent: String) -> String { switch current { case .zhHans: "\(owner) 的 \(agent)"; case .zhHant: "\(owner) 的 \(agent)"; case .en: "\(owner)'s \(agent)" } }

    // MARK: - A2A Review Panel
    static var refine: String { switch current { case .zhHans: "修改"; case .zhHant: "修改"; case .en: "Refine" } }
    static var mainAssistant: String { switch current { case .zhHans: "Main Assistant"; case .zhHant: "Main Assistant"; case .en: "Main Assistant" } }
    static func sendTagReply(_ name: String) -> String { switch current { case .zhHans: "发送 \(name) 回复"; case .zhHant: "傳送 \(name) 回覆"; case .en: "Send \(name) Reply" } }
    static var sendMainReply: String { switch current { case .zhHans: "发送 Main Assistant 回复"; case .zhHant: "傳送 Main Assistant 回覆"; case .en: "Send Main Assistant Reply" } }
    static var sendManualReply: String { switch current { case .zhHans: "发送手写回复"; case .zhHant: "傳送手寫回覆"; case .en: "Send Manual Reply" } }
    static var manualReplyHint: String { switch current { case .zhHans: "手写回复（以 Tag Agent 身份发出）"; case .zhHant: "手寫回覆（以 Tag Agent 身份發出）"; case .en: "Manual reply (sent as Tag Agent)" } }
    static var refineInstruction: String { switch current { case .zhHans: "输入修改意见..."; case .zhHant: "輸入修改意見..."; case .en: "Enter refinement instructions..." } }
    static var statusGenerating: String { switch current { case .zhHans: "生成中"; case .zhHant: "生成中"; case .en: "Generating" } }
    static var statusRefining: String { switch current { case .zhHans: "修改中"; case .zhHant: "修改中"; case .en: "Refining" } }
    static var statusReady: String { switch current { case .zhHans: "就绪"; case .zhHant: "就緒"; case .en: "Ready" } }

    // MARK: - Execution Log Drawer
    static var executionLog: String { switch current { case .zhHans: "执行日志"; case .zhHant: "執行日誌"; case .en: "Execution Log" } }
    static var searchLogs: String { switch current { case .zhHans: "搜索日志..."; case .zhHant: "搜尋日誌..."; case .en: "Search logs..." } }
    static var noMatchingLogs: String { switch current { case .zhHans: "没有匹配的日志"; case .zhHant: "沒有匹配的日誌"; case .en: "No matching logs" } }

    // MARK: - Security Event Descriptions
    static var unknownPath: String { switch current { case .zhHans: "未知路径"; case .zhHant: "未知路徑"; case .en: "Unknown path" } }
    static var unknownTag: String { switch current { case .zhHans: "未知标签"; case .zhHant: "未知標籤"; case .en: "Unknown tag" } }
    static func boundaryViolation(_ tag: String, _ agent: String, _ type: String, _ path: String) -> String { switch current { case .zhHans: "[\(tag)] \(agent) 越界访问 (\(type)): \(path)"; case .zhHant: "[\(tag)] \(agent) 越界存取 (\(type)): \(path)"; case .en: "[\(tag)] \(agent) boundary violation (\(type)): \(path)" } }
    static func accessDenied(_ agent: String, _ command: String, _ path: String) -> String { switch current { case .zhHans: "\(agent) 试图执行 \(command): \(path)"; case .zhHant: "\(agent) 試圖執行 \(command): \(path)"; case .en: "\(agent) attempted \(command): \(path)" } }
    static func dialogApprovalEvent(_ owner: String, _ agent: String, _ topic: String) -> String { switch current { case .zhHans: "\(owner) 的 \(agent) 请求对话: \(topic)"; case .zhHant: "\(owner) 的 \(agent) 請求對話: \(topic)"; case .en: "\(owner)'s \(agent) requests dialog: \(topic)" } }
    static func approvalRequested(_ agent: String) -> String { switch current { case .zhHans: "\(agent) 请求操作授权"; case .zhHant: "\(agent) 請求操作授權"; case .en: "\(agent) requests operation authorization" } }

    // MARK: - Security Event Center
    static var allReadAction: String { switch current { case .zhHans: "全部已读"; case .zhHant: "全部已讀"; case .en: "Mark All Read" } }
    static var searchEvents: String { switch current { case .zhHans: "搜索事件..."; case .zhHant: "搜尋事件..."; case .en: "Search events..." } }
    static var all: String { switch current { case .zhHans: "全部"; case .zhHant: "全部"; case .en: "All" } }
    static var noSecurityEvents: String { switch current { case .zhHans: "暂无安全事件"; case .zhHant: "暫無安全事件"; case .en: "No security events" } }
    static var securityEventsDescription: String { switch current { case .zhHans: "文件访问拒绝、对话审批等事件将显示在这里"; case .zhHant: "檔案存取拒絕、對話審批等事件將顯示在這裡"; case .en: "File access denials, dialog approvals will appear here" } }
    static var noMatchingEvents: String { switch current { case .zhHans: "没有匹配的事件"; case .zhHant: "沒有匹配的事件"; case .en: "No matching events" } }
    static var adjustFilter: String { switch current { case .zhHans: "尝试调整筛选条件"; case .zhHant: "嘗試調整篩選條件"; case .en: "Try adjusting filter" } }
    static var detailLabel: String { switch current { case .zhHans: "详情:"; case .zhHant: "詳情:"; case .en: "Details:" } }
}
