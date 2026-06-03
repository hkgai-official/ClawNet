import Foundation

@MainActor
extension L {
    // MARK: - Actions
    static var cancel: String { switch current { case .zhHans: "取消"; case .zhHant: "取消"; case .en: "Cancel" } }
    static var confirm: String { switch current { case .zhHans: "确认"; case .zhHant: "確認"; case .en: "Confirm" } }
    static var save: String { switch current { case .zhHans: "保存"; case .zhHant: "儲存"; case .en: "Save" } }
    static var saveChanges: String { switch current { case .zhHans: "保存更改"; case .zhHant: "儲存變更"; case .en: "Save Changes" } }
    static var delete: String { switch current { case .zhHans: "删除"; case .zhHant: "刪除"; case .en: "Delete" } }
    static var close: String { switch current { case .zhHans: "关闭"; case .zhHant: "關閉"; case .en: "Close" } }
    static var search: String { switch current { case .zhHans: "搜索"; case .zhHant: "搜尋"; case .en: "Search" } }
    static var create: String { switch current { case .zhHans: "创建"; case .zhHant: "建立"; case .en: "Create" } }
    static var done: String { switch current { case .zhHans: "完成"; case .zhHant: "完成"; case .en: "Done" } }
    static var apply: String { switch current { case .zhHans: "申请"; case .zhHant: "申請"; case .en: "Apply" } }
    static var reject: String { switch current { case .zhHans: "拒绝"; case .zhHant: "拒絕"; case .en: "Reject" } }
    static var approve: String { switch current { case .zhHans: "批准"; case .zhHant: "批准"; case .en: "Approve" } }
    static var authorize: String { switch current { case .zhHans: "授权"; case .zhHant: "授權"; case .en: "Authorize" } }
    static var retry: String { switch current { case .zhHans: "重试"; case .zhHant: "重試"; case .en: "Retry" } }
    static var loading: String { switch current { case .zhHans: "加载中..."; case .zhHant: "載入中..."; case .en: "Loading..." } }
    static var saved: String { switch current { case .zhHans: "已保存"; case .zhHant: "已儲存"; case .en: "Saved" } }
    static var copyText: String { switch current { case .zhHans: "复制文字"; case .zhHant: "複製文字"; case .en: "Copy Text" } }
    static var unknownConversation: String { switch current { case .zhHans: "未知会话"; case .zhHant: "未知對話"; case .en: "Unknown Conversation" } }
    static var unnamed: String { switch current { case .zhHans: "未命名会话"; case .zhHant: "未命名對話"; case .en: "Unnamed Conversation" } }

    // MARK: - Status
    static var connected: String { switch current { case .zhHans: "已连接"; case .zhHant: "已連線"; case .en: "Connected" } }
    static var connecting: String { switch current { case .zhHans: "连接中..."; case .zhHant: "連線中..."; case .en: "Connecting..." } }
    static var reconnecting: String { switch current { case .zhHans: "重新连接中..."; case .zhHant: "重新連線中..."; case .en: "Reconnecting..." } }
    static var disconnected: String { switch current { case .zhHans: "已断开"; case .zhHant: "已斷開"; case .en: "Disconnected" } }
    static var online: String { switch current { case .zhHans: "在线"; case .zhHant: "線上"; case .en: "Online" } }
    static var offline: String { switch current { case .zhHans: "离线"; case .zhHant: "離線"; case .en: "Offline" } }
    static var generating: String { switch current { case .zhHans: "生成中..."; case .zhHant: "生成中..."; case .en: "Generating..." } }

    // MARK: - Time
    static var justNow: String { switch current { case .zhHans: "刚刚"; case .zhHant: "剛剛"; case .en: "Just now" } }
    static var yesterday: String { switch current { case .zhHans: "昨天"; case .zhHant: "昨天"; case .en: "Yesterday" } }
    static var dayBeforeYesterday: String { switch current { case .zhHans: "前天"; case .zhHant: "前天"; case .en: "2 days ago" } }
    static var today: String { switch current { case .zhHans: "今天"; case .zhHant: "今天"; case .en: "Today" } }
    static func minutesAgo(_ n: Int) -> String { switch current { case .zhHans: "\(n)分钟前"; case .zhHant: "\(n)分鐘前"; case .en: "\(n)m ago" } }
    static func hoursAgo(_ n: Int) -> String { switch current { case .zhHans: "\(n)小时前"; case .zhHant: "\(n)小時前"; case .en: "\(n)h ago" } }
    static func dateFormat(_ isCurrentYear: Bool) -> String {
        switch current {
        case .zhHans: isCurrentYear ? "M月d日" : "yyyy年M月d日"
        case .zhHant: isCurrentYear ? "M月d日" : "yyyy年M月d日"
        case .en: isCurrentYear ? "MMM d" : "MMM d, yyyy"
        }
    }

    // MARK: - Navigation
    static var messages: String { switch current { case .zhHans: "消息"; case .zhHant: "訊息"; case .en: "Messages" } }
    static var chat: String { switch current { case .zhHans: "聊天"; case .zhHant: "聊天"; case .en: "Chat" } }
    static var contacts: String { switch current { case .zhHans: "联系人"; case .zhHant: "聯絡人"; case .en: "Contacts" } }
    static var securityEvents: String { switch current { case .zhHans: "安全事件"; case .zhHant: "安全事件"; case .en: "Security Events" } }
    static var settings: String { switch current { case .zhHans: "设置"; case .zhHant: "設定"; case .en: "Settings" } }

    // MARK: - User
    static var user: String { switch current { case .zhHans: "用户"; case .zhHant: "用戶"; case .en: "User" } }
    static func members(_ count: Int) -> String { switch current { case .zhHans: "\(count) 位成员"; case .zhHant: "\(count) 位成員"; case .en: "\(count) members" } }
    static var noMessages: String { switch current { case .zhHans: "暂无消息"; case .zhHant: "暫無訊息"; case .en: "No messages" } }
    static var systemMessage: String { switch current { case .zhHans: "[系统消息]"; case .zhHant: "[系統訊息]"; case .en: "[System Message]" } }
}
