import Foundation

@MainActor
extension L {
    static var addFriend: String { switch current { case .zhHans: "添加好友"; case .zhHant: "添加好友"; case .en: "Add Friend" } }
    static var searchContact: String { switch current { case .zhHans: "搜索联系人"; case .zhHant: "搜尋聯絡人"; case .en: "Search Contacts" } }
    static var friendRequests: String { switch current { case .zhHans: "好友请求"; case .zhHant: "好友請求"; case .en: "Friend Requests" } }
    static var noContacts: String { switch current { case .zhHans: "没有联系人"; case .zhHant: "沒有聯絡人"; case .en: "No Contacts" } }
    static var addFriendsHint: String { switch current { case .zhHans: "点击右上角添加好友"; case .zhHant: "點擊右上角添加好友"; case .en: "Click top-right to add friends" } }
    static var contactNotFound: String { switch current { case .zhHans: "联系人不存在"; case .zhHant: "聯絡人不存在"; case .en: "Contact not found" } }
    static var nickname: String { switch current { case .zhHans: "昵称"; case .zhHant: "暱稱"; case .en: "Nickname" } }
    static var phone: String { switch current { case .zhHans: "电话"; case .zhHant: "電話"; case .en: "Phone" } }
    static var type: String { switch current { case .zhHans: "类型"; case .zhHant: "類型"; case .en: "Type" } }
    static var idUsernameOrEmail: String { switch current { case .zhHans: "ID、用户名或邮箱"; case .zhHant: "ID、使用者名稱或郵箱"; case .en: "ID, username or email" } }
    static var alreadyFriend: String { switch current { case .zhHans: "已是好友"; case .zhHant: "已是好友"; case .en: "Already a friend" } }
    static var requestSent: String { switch current { case .zhHans: "请求已发送"; case .zhHant: "請求已傳送"; case .en: "Request sent" } }
    static var sendFailed: String { switch current { case .zhHans: "发送失败"; case .zhHant: "傳送失敗"; case .en: "Send failed" } }
    static var userNotFound: String { switch current { case .zhHans: "未找到用户"; case .zhHant: "未找到使用者"; case .en: "User not found" } }
    static var accept: String { switch current { case .zhHans: "接受"; case .zhHant: "接受"; case .en: "Accept" } }
}
