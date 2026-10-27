import AVFAudio
import Foundation

/// 推送载荷 v1（circle_be src/call/call-push.service.ts）：全是字符串。
struct CallPushInvite {
  let callId: String
  let callType: String
  let sessionType: String
  let callerId: String
  let callerName: String
  let groupName: String?
  let expiresAt: Date
  let declineToken: String?

  init(
    callId: String,
    callType: String,
    sessionType: String,
    callerId: String,
    callerName: String,
    groupName: String?,
    expiresAt: Date,
    declineToken: String?
  ) {
    self.callId = callId
    self.callType = callType
    self.sessionType = sessionType
    self.callerId = callerId
    self.callerName = callerName
    self.groupName = groupName
    self.expiresAt = expiresAt
    self.declineToken = declineToken
  }

  init?(payload: Any?) {
    guard
      let call = payload as? [String: Any],
      call["v"] as? String == "1",
      call["type"] as? String == "call.invite",
      let callId = call["callId"] as? String,
      let callerName = call["callerName"] as? String,
      let expiresRaw = call["expiresAt"] as? String,
      let expiresAt = Self.parseDate(expiresRaw)
    else {
      return nil
    }
    self.init(
      callId: callId,
      callType: call["callType"] as? String ?? "AUDIO",
      sessionType: call["sessionType"] as? String ?? "single",
      callerId: call["callerId"] as? String ?? callId,
      callerName: callerName,
      groupName: (call["groupName"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      expiresAt: expiresAt,
      declineToken: call["declineToken"] as? String
    )
  }

  static func parseDate(_ raw: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
  }
}

/// token 属于哪个 APNs 环境，登记时告诉后端，后端按 token 选 sandbox / production。
enum ApnsEnvironment {
  static let current: String = {
    // TestFlight / App Store 包里没有 embedded.mobileprovision，一律是 production；
    // Xcode 装的调试包与 ad-hoc 包有，按描述文件里的 aps-environment 判断。
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let raw = String(data: data, encoding: .isoLatin1),
      let start = raw.range(of: "<?xml"),
      let end = raw.range(of: "</plist>")
    else {
      return "production"
    }
    guard
      let plistData = String(raw[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
      let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil)
        as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let environment = entitlements["aps-environment"] as? String
    else {
      return "production"
    }
    return environment == "development" ? "development" : "production"
  }()
}

/// CallKit 接管音频会话：系统激活 / 停用时告诉 WebRTC（LiveKit 用的 RTCAudioSession）。
/// 走 Objective-C 运行时，不在编译期依赖 WebRTC 的 pod —— 版本跟着 LiveKit 走，
/// 这里写死依赖只会在升级 LiveKit 时撞版本冲突。没有这个类（Web、没装 LiveKit）就什么都不做。
enum WebRTCAudioBridge {
  private static func session() -> NSObject? {
    guard let cls = NSClassFromString("RTCAudioSession") as? NSObject.Type else { return nil }
    let shared = NSSelectorFromString("sharedInstance")
    guard cls.responds(to: shared) else { return nil }
    return cls.perform(shared)?.takeUnretainedValue() as? NSObject
  }

  static func didActivate(_ audioSession: AVAudioSession) {
    guard let session = session() else { return }
    let selector = NSSelectorFromString("audioSessionDidActivate:")
    if session.responds(to: selector) {
      session.perform(selector, with: audioSession)
    }
    if session.responds(to: NSSelectorFromString("setIsAudioEnabled:")) {
      session.setValue(true, forKey: "isAudioEnabled")
    }
  }

  static func didDeactivate(_ audioSession: AVAudioSession) {
    guard let session = session() else { return }
    if session.responds(to: NSSelectorFromString("setIsAudioEnabled:")) {
      session.setValue(false, forKey: "isAudioEnabled")
    }
    let selector = NSSelectorFromString("audioSessionDidDeactivate:")
    if session.responds(to: selector) {
      session.perform(selector, with: audioSession)
    }
  }
}
