import Foundation

@MainActor
extension L {
    static var loginTitle: String { switch current { case .zhHans: "登录你的账户"; case .zhHant: "登入你的帳戶"; case .en: "Sign in to your account" } }
    static var login: String { switch current { case .zhHans: "登录"; case .zhHant: "登入"; case .en: "Sign In" } }
    static var logout: String { switch current { case .zhHans: "退出登录"; case .zhHant: "登出"; case .en: "Sign Out" } }
    static var idOrEmail: String { switch current { case .zhHans: "ID 或邮箱"; case .zhHant: "ID 或郵箱"; case .en: "ID or Email" } }
    static var password: String { switch current { case .zhHans: "密码"; case .zhHant: "密碼"; case .en: "Password" } }
    static var invalidServerURL: String { switch current { case .zhHans: "无效的服务器地址"; case .zhHant: "無效的伺服器地址"; case .en: "Invalid server URL" } }
    static var restoringSession: String { switch current { case .zhHans: "正在恢复会话..."; case .zhHant: "正在恢復會話..."; case .en: "Restoring session..." } }
}
