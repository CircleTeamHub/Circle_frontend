// 中国区通知模式（EXPO_PUBLIC_IOS_CALL_MODE=notification）的 CallPushCenter。
//
// 工信部要求中国区 App Store 的 App 停用 CallKit，而 iOS 13 起 PushKit 的 VoIP 推送必须上报
// CallKit，所以这个包两样都不链接：来电是服务端经极光发的 time-sensitive 通知（自带 ≤30 秒的
// 铃声），用户点开后在应用内接听 / 拒接。原生层这里只剩一件事 —— 这通电话不再响时，把还挂在
// 通知中心里的来电通知收掉（服务端以 apns-collapse-id = call:<callId> 发送，系统用它作
// 通知请求的 identifier）。
#if CALL_PUSH_NO_CALLKIT
import Foundation
import UserNotifications

final class CallPushCenter: NSObject {
  static let shared = CallPushCenter()

  private static let apiBaseUrlKey = "circle.callpush.apiBaseUrl"
  var onEventsAvailable: (() -> Void)?

  func start() {}

  func configure(apiBaseUrl: String) {
    UserDefaults.standard.set(apiBaseUrl, forKey: Self.apiBaseUrlKey)
  }

  func voipToken() -> [String: String]? {
    nil
  }

  func drainEvents() -> [[String: Any]] {
    []
  }

  /// 没有系统来电界面：前台由应用内弹窗负责。
  func reportFromJs(callId: String, callerName: String, hasVideo: Bool, isGroup: Bool, expiresAt: String) {}

  func endCall(callId: String, reason: String) {
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["call:\(callId)"])
  }
}
#endif
