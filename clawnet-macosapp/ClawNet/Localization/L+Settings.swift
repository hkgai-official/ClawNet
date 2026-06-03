import Foundation

@MainActor
extension L {
    // MARK: - Settings Tabs
    static var profile: String { switch current { case .zhHans: "个人信息"; case .zhHant: "個人資訊"; case .en: "Profile" } }
    static var general: String { switch current { case .zhHans: "通用"; case .zhHant: "一般"; case .en: "General" } }
    static var security: String { switch current { case .zhHans: "安全"; case .zhHant: "安全"; case .en: "Security" } }
    static var tags: String { switch current { case .zhHans: "标签"; case .zhHant: "標籤"; case .en: "Tags" } }

    // MARK: - Profile
    static var avatar: String { switch current { case .zhHans: "头像"; case .zhHant: "頭像"; case .en: "Avatar" } }
    static var basicInfo: String { switch current { case .zhHans: "基本信息"; case .zhHant: "基本資訊"; case .en: "Basic Info" } }
    static var email: String { switch current { case .zhHans: "邮箱"; case .zhHant: "郵箱"; case .en: "Email" } }
    static var name: String { switch current { case .zhHans: "名称"; case .zhHant: "名稱"; case .en: "Name" } }
    static var changePassword: String { switch current { case .zhHans: "修改密码"; case .zhHant: "修改密碼"; case .en: "Change Password" } }
    static var saveFailed: String { switch current { case .zhHans: "保存失败"; case .zhHant: "儲存失敗"; case .en: "Save failed" } }

    // MARK: - Change Password
    static var currentPassword: String { switch current { case .zhHans: "当前密码"; case .zhHant: "目前密碼"; case .en: "Current password" } }
    static var newPasswordPlaceholder: String { switch current { case .zhHans: "新密码（至少6位）"; case .zhHant: "新密碼（至少6位）"; case .en: "New password (min 6 chars)" } }
    static var confirmNewPassword: String { switch current { case .zhHans: "确认新密码"; case .zhHant: "確認新密碼"; case .en: "Confirm new password" } }
    static var confirmChanges: String { switch current { case .zhHans: "确认修改"; case .zhHant: "確認修改"; case .en: "Confirm Changes" } }
    static var passwordMismatch: String { switch current { case .zhHans: "两次输入的新密码不一致"; case .zhHant: "兩次輸入的新密碼不一致"; case .en: "Passwords do not match" } }
    static var passwordSameAsOld: String { switch current { case .zhHans: "新密码不能与旧密码相同"; case .zhHant: "新密碼不能與舊密碼相同"; case .en: "New password must differ from current" } }
    static var passwordChanged: String { switch current { case .zhHans: "密码修改成功"; case .zhHant: "密碼修改成功"; case .en: "Password changed successfully" } }

    // MARK: - General
    static var about: String { switch current { case .zhHans: "关于"; case .zhHant: "關於"; case .en: "About" } }
    static var version: String { switch current { case .zhHans: "版本"; case .zhHant: "版本"; case .en: "Version" } }
    static var application: String { switch current { case .zhHans: "应用"; case .zhHant: "應用"; case .en: "Application" } }
    static var language: String { switch current { case .zhHans: "语言"; case .zhHant: "語言"; case .en: "Language" } }
    static var languageLabel: String { switch current { case .zhHans: "界面语言"; case .zhHant: "介面語言"; case .en: "Interface Language" } }

    // MARK: - Security (File Access)
    static var fileAccessControl: String { switch current { case .zhHans: "文件访问控制"; case .zhHant: "檔案存取控制"; case .en: "File Access Control" } }
    static var accessMode: String { switch current { case .zhHans: "访问模式"; case .zhHant: "存取模式"; case .en: "Access Mode" } }
    static var fileAccessDeny: String { switch current { case .zhHans: "全部禁止"; case .zhHant: "全部禁止"; case .en: "Deny All" } }
    static var fileAccessScoped: String { switch current { case .zhHans: "限定范围（白名单）"; case .zhHant: "限定範圍（白名單）"; case .en: "Scoped (Allowlist)" } }
    static var fileAccessFull: String { switch current { case .zhHans: "全部允许"; case .zhHant: "全部允許"; case .en: "Allow All" } }
    static var authorizedFolders: String { switch current { case .zhHans: "已授权的文件夹"; case .zhHant: "已授權的資料夾"; case .en: "Authorized Folders" } }
    static var noFoldersAuthorized: String { switch current { case .zhHans: "尚未授权任何文件夹，点击下方按钮选择"; case .zhHant: "尚未授權任何資料夾，點擊下方按鈕選擇"; case .en: "No folders authorized yet. Click below to add." } }
    static var selectFolder: String { switch current { case .zhHans: "选择文件夹…"; case .zhHant: "選擇資料夾…"; case .en: "Select Folder…" } }
    static var selectFolderMessage: String { switch current { case .zhHans: "选择允许 Agent 访问的文件夹"; case .zhHant: "選擇允許 Agent 存取的資料夾"; case .en: "Select folders Agent can access" } }
    static var authorizeAccess: String { switch current { case .zhHans: "授权访问"; case .zhHant: "授權存取"; case .en: "Authorize Access" } }
    static var deniedPaths: String { switch current { case .zhHans: "禁止的路径（始终生效）"; case .zhHant: "禁止的路徑（始終生效）"; case .en: "Denied Paths (Always Active)" } }
    static var defaultLabel: String { switch current { case .zhHans: "默认"; case .zhHant: "預設"; case .en: "Default" } }

    // MARK: - Connection
    static var gatewayConnection: String { switch current { case .zhHans: "网关连接"; case .zhHant: "閘道連線"; case .en: "Gateway Connection" } }
    static var statusLabel: String { switch current { case .zhHans: "状态"; case .zhHant: "狀態"; case .en: "Status" } }
    static var serverAddress: String { switch current { case .zhHans: "服务器地址"; case .zhHant: "伺服器地址"; case .en: "Server Address" } }
    static var applyAndReconnect: String { switch current { case .zhHans: "应用并重连"; case .zhHant: "套用並重連"; case .en: "Apply & Reconnect" } }
    static var invalidURLFormat: String { switch current { case .zhHans: "无效的 URL 格式"; case .zhHant: "無效的 URL 格式"; case .en: "Invalid URL format" } }

    // MARK: - Tags
    static var tagList: String { switch current { case .zhHans: "标签列表"; case .zhHant: "標籤列表"; case .en: "Tag List" } }
    static var newTag: String { switch current { case .zhHans: "新建标签"; case .zhHant: "新建標籤"; case .en: "New Tag" } }
    static var editTag: String { switch current { case .zhHans: "编辑标签"; case .zhHant: "編輯標籤"; case .en: "Edit Tag" } }
    static var tagName: String { switch current { case .zhHans: "标签名称"; case .zhHant: "標籤名稱"; case .en: "Tag Name" } }
    static var tagFollowsGlobal: String { switch current { case .zhHans: "权限跟随全局白名单"; case .zhHant: "權限跟隨全域白名單"; case .en: "Permissions follow global allowlist" } }
    static var noPathsConfigured: String { switch current { case .zhHans: "未配置路径"; case .zhHant: "未配置路徑"; case .en: "No paths configured" } }
    static var allowedPaths: String { switch current { case .zhHans: "允许访问的路径"; case .zhHant: "允許存取的路徑"; case .en: "Allowed Paths" } }
    static var addWhitelistFirst: String { switch current { case .zhHans: "请先在「安全」设置中添加白名单文件夹"; case .zhHant: "請先在「安全」設定中添加白名單資料夾"; case .en: "Please add allowlist folders in Security settings first" } }
    static var mainTagNodeAclNote: String { switch current { case .zhHans: "Main Assistant 的 Node 权限自动跟随全局白名单设置，无需单独配置。"; case .zhHant: "Main Assistant 的 Node 權限自動跟隨全域白名單設定，無需單獨配置。"; case .en: "Main Assistant Node permissions follow the global allowlist automatically." } }
    static var nodePermissions: String { switch current { case .zhHans: "Node 权限"; case .zhHant: "Node 權限"; case .en: "Node Permissions" } }
    static var socialTag: String { switch current { case .zhHans: "社会身份标签"; case .zhHant: "社會身份標籤"; case .en: "Social Identity Tag" } }
    static var tagWorkspaceDescription: String { switch current { case .zhHans: "决定该助手的工作空间和能力范围"; case .zhHant: "決定該助手的工作空間和能力範圍"; case .en: "Determines the agent's workspace and capabilities" } }
    static var contactTagDescription: String { switch current { case .zhHans: "决定该联系人对话时使用的工作空间"; case .zhHant: "決定該聯絡人對話時使用的工作空間"; case .en: "Determines the workspace used when chatting with this contact" } }
}
