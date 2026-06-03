import Foundation

@MainActor
extension L {
    // MARK: - Conversation List
    static var allMessages: String { switch current { case .zhHans: "全部消息"; case .zhHant: "全部訊息"; case .en: "All Messages" } }
    static var people: String { switch current { case .zhHans: "人员"; case .zhHant: "人員"; case .en: "People" } }
    static var myAgents: String { switch current { case .zhHans: "我的Agent"; case .zhHant: "我的Agent"; case .en: "My Agents" } }
    static var agentDialogs: String { switch current { case .zhHans: "Agent对话"; case .zhHant: "Agent對話"; case .en: "Agent Dialogs" } }
    static var groups: String { switch current { case .zhHans: "群组"; case .zhHant: "群組"; case .en: "Groups" } }
    static var noConversations: String { switch current { case .zhHans: "暂无会话"; case .zhHant: "暫無對話"; case .en: "No conversations" } }
    static var noMatchingConversations: String { switch current { case .zhHans: "未找到匹配的会话"; case .zhHant: "未找到匹配的對話"; case .en: "No matching conversations" } }
    static var tapPlusToStart: String { switch current { case .zhHans: "点击 + 开始新对话"; case .zhHant: "點擊 + 開始新對話"; case .en: "Tap + to start a new conversation" } }
    static var deleteConversation: String { switch current { case .zhHans: "删除会话"; case .zhHant: "刪除對話"; case .en: "Delete Conversation" } }
    static var confirmDeleteConversation: String { switch current { case .zhHans: "确定要删除此会话吗？"; case .zhHant: "確定要刪除此對話嗎？"; case .en: "Delete this conversation?" } }
    static var chatHistoryLost: String { switch current { case .zhHans: "聊天记录将无法恢复"; case .zhHant: "聊天記錄將無法恢復"; case .en: "Chat history cannot be recovered" } }
    static func groupChat(_ count: Int) -> String { switch current { case .zhHans: "群聊 (\(count))"; case .zhHant: "群聊 (\(count))"; case .en: "Group (\(count))" } }

    // MARK: - Chat Detail
    static var selectConversation: String { switch current { case .zhHans: "选择一个会话开始聊天"; case .zhHant: "選擇一個對話開始聊天"; case .en: "Select a conversation to start chatting" } }
    static var selectFromSidebar: String { switch current { case .zhHans: "从侧边栏选择一个会话或创建新会话"; case .zhHant: "從側邊欄選擇一個對話或建立新對話"; case .en: "Select or create a conversation from the sidebar" } }
    static var pleaseSelectFromSidebar: String { switch current { case .zhHans: "请从侧边栏选择"; case .zhHant: "請從側邊欄選擇"; case .en: "Select from sidebar" } }
    static var searchMessages: String { switch current { case .zhHans: "搜索消息"; case .zhHant: "搜尋訊息"; case .en: "Search Messages" } }
    static var viewGroupDetail: String { switch current { case .zhHans: "查看群详情"; case .zhHant: "查看群詳情"; case .en: "View Group Details" } }
    static var waitingForReply: String { switch current { case .zhHans: "等待对方回复..."; case .zhHant: "等待對方回覆..."; case .en: "Waiting for reply..." } }
    static var spectatorMode: String { switch current { case .zhHans: "旁观模式"; case .zhHant: "旁觀模式"; case .en: "Spectator Mode" } }
    static var sendMessage: String { switch current { case .zhHans: "发送消息"; case .zhHant: "傳送訊息"; case .en: "Send Message" } }
    static var enterSendShiftEnterNewline: String { switch current { case .zhHans: "按 Enter 发送，Shift + Enter 换行"; case .zhHant: "按 Enter 傳送，Shift + Enter 換行"; case .en: "Enter to send, Shift+Enter for new line" } }
    static var sendFile: String { switch current { case .zhHans: "发送文件"; case .zhHant: "傳送檔案"; case .en: "Send File" } }
    static var sendImage: String { switch current { case .zhHans: "发送图片"; case .zhHant: "傳送圖片"; case .en: "Send Image" } }
    static var emoji: String { switch current { case .zhHans: "表情"; case .zhHant: "表情"; case .en: "Emoji" } }
    static var send: String { switch current { case .zhHans: "发送"; case .zhHant: "傳送"; case .en: "Send" } }
    static var stopGenerating: String { switch current { case .zhHans: "停止生成"; case .zhHant: "停止生成"; case .en: "Stop generating" } }
    static var selectFile: String { switch current { case .zhHans: "选择要发送的文件"; case .zhHant: "選擇要傳送的檔案"; case .en: "Select files to send" } }
    static var selectImageOrVideo: String { switch current { case .zhHans: "选择图片或视频"; case .zhHant: "選擇圖片或影片"; case .en: "Select images or videos" } }

    // MARK: - Media Messages
    static var loadFailed: String { switch current { case .zhHans: "加载失败"; case .zhHant: "載入失敗"; case .en: "Load failed" } }
    static var image: String { switch current { case .zhHans: "图片"; case .zhHant: "圖片"; case .en: "Image" } }
    static var video: String { switch current { case .zhHans: "视频"; case .zhHant: "影片"; case .en: "Video" } }
    static var cannotPlay: String { switch current { case .zhHans: "无法播放"; case .zhHant: "無法播放"; case .en: "Cannot play" } }
    static var invalidVideoURL: String { switch current { case .zhHans: "视频地址无效"; case .zhHant: "影片地址無效"; case .en: "Invalid video URL" } }
    static var unnamedFile: String { switch current { case .zhHans: "未命名文件"; case .zhHant: "未命名檔案"; case .en: "Unnamed file" } }
    static var downloadFile: String { switch current { case .zhHans: "下载文件"; case .zhHant: "下載檔案"; case .en: "Download File" } }
    static var saveToDownloads: String { switch current { case .zhHans: "保存到下载文件夹"; case .zhHant: "儲存到下載資料夾"; case .en: "Save to Downloads" } }
    static var file: String { switch current { case .zhHans: "文件"; case .zhHant: "檔案"; case .en: "File" } }

    // MARK: - New Chat
    static var newConversation: String { switch current { case .zhHans: "新建会话"; case .zhHant: "新建對話"; case .en: "New Conversation" } }
    static var noContactsAddFirst: String { switch current { case .zhHans: "没有联系人，请先添加好友"; case .zhHant: "沒有聯絡人，請先添加好友"; case .en: "No contacts. Add friends first." } }
    static var conversationTitleOptional: String { switch current { case .zhHans: "会话标题（可选）"; case .zhHant: "對話標題（可選）"; case .en: "Conversation title (optional)" } }
    static var conversationTitlePlaceholder: String { switch current { case .zhHans: "例如：项目调研、周报整理..."; case .zhHant: "例如：專案調研、週報整理..."; case .en: "e.g. Project research, Weekly report..." } }
    static var createGroup: String { switch current { case .zhHans: "创建群聊"; case .zhHant: "建立群聊"; case .en: "Create Group" } }

    // MARK: - Group Detail
    static var groupDetail: String { switch current { case .zhHans: "群聊详情"; case .zhHant: "群聊詳情"; case .en: "Group Details" } }
    static var groupName: String { switch current { case .zhHans: "群名称"; case .zhHant: "群名稱"; case .en: "Group Name" } }
    static var owner: String { switch current { case .zhHans: "群主"; case .zhHant: "群主"; case .en: "Owner" } }
    static var admin: String { switch current { case .zhHans: "管理员"; case .zhHant: "管理員"; case .en: "Admin" } }
    static var leaveGroup: String { switch current { case .zhHans: "退出群聊"; case .zhHant: "退出群聊"; case .en: "Leave Group" } }
    static var inviteMembers: String { switch current { case .zhHans: "邀请成员"; case .zhHant: "邀請成員"; case .en: "Invite Members" } }
    static var invite: String { switch current { case .zhHans: "邀请"; case .zhHant: "邀請"; case .en: "Invite" } }
    static var groupNamePlaceholder: String { switch current { case .zhHans: "输入群名称"; case .zhHant: "輸入群名稱"; case .en: "Enter group name" } }
    static var searchContacts: String { switch current { case .zhHans: "搜索联系人..."; case .zhHant: "搜尋聯絡人..."; case .en: "Search contacts..." } }
    static func selectedCount(_ n: Int) -> String { switch current { case .zhHans: "已选择 \(n) 人"; case .zhHant: "已選擇 \(n) 人"; case .en: "\(n) selected" } }
    static var clearAll: String { switch current { case .zhHans: "清除全部"; case .zhHant: "清除全部"; case .en: "Clear All" } }

    // MARK: - Status Bar
    static var gatewayUnreachable: String { switch current { case .zhHans: "网关不可达"; case .zhHant: "閘道不可達"; case .en: "Gateway unreachable" } }
    static var reconnect: String { switch current { case .zhHans: "重新连接"; case .zhHant: "重新連線"; case .en: "Reconnect" } }
    static var disconnectedLost: String { switch current { case .zhHans: "已断开 — 连接丢失"; case .zhHant: "已斷開 — 連線遺失"; case .en: "Disconnected — Connection lost" } }

    // MARK: - Global Search
    static var searchKeywordPlaceholder: String { switch current { case .zhHans: "输入关键词搜索..."; case .zhHant: "輸入關鍵詞搜尋..."; case .en: "Enter keywords to search..." } }
    static var searching: String { switch current { case .zhHans: "搜索中..."; case .zhHant: "搜尋中..."; case .en: "Searching..." } }
    static var noMatchingMessages: String { switch current { case .zhHans: "没有找到匹配的消息"; case .zhHant: "沒有找到匹配的訊息"; case .en: "No matching messages found" } }
    static var tryDifferentKeywords: String { switch current { case .zhHans: "尝试更换关键词"; case .zhHant: "嘗試更換關鍵詞"; case .en: "Try different keywords" } }
    static var enterKeywordToSearch: String { switch current { case .zhHans: "输入关键词搜索消息"; case .zhHant: "輸入關鍵詞搜尋訊息"; case .en: "Enter keywords to search messages" } }
}
