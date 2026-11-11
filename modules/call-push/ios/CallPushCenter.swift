// CallKit 模式（默认）的实现。中国区通知模式的包（EXPO_PUBLIC_IOS_CALL_MODE=notification）
// 定义 CALL_PUSH_NO_CALLKIT，整份文件不参与编译 —— 二进制里不能出现 CallKit / PushKit；
// 同名的空实现在 CallPushNotificationCenter.swift。
#if !CALL_PUSH_NO_CALLKIT
import AVFAudio
import CallKit
import Foundation
import PushKit
import UIKit

/// 推送来电在 iOS 上的原生中枢（设计见 docs/superpowers/specs/2026-10-26-push-incoming-calls-design.md）。
///
/// VoIP 推送可能把被杀掉的 App 冷启动到后台，这时 JS 还没加载。Apple 要求在推送回调里
/// **同步**向 CallKit 上报一通来电，否则系统直接杀进程，屡次违规后不再投递 VoIP 推送。
/// 所以响铃、到期、锁屏拒接都在这里完成；需要 JS 做的（接听入会、挂断）排进事件队列，
/// JS 启动后用 consumeEvents 取走。
///
/// 所有状态只在主线程读写：PKPushRegistry 与 CXProvider 都挂在主队列上，模块函数也都
/// runOnQueue(.main)。
final class CallPushCenter: NSObject {
  static let shared = CallPushCenter()

  private struct RingingCall {
    let callId: String
    let backendId: UUID
    let createdAt: Date?
    let declineToken: String?
    var answered: Bool
    var expiryTimer: Timer?
  }

  private static let tokenKey = "circle.callpush.voipToken"
  private static let apiBaseUrlKey = "circle.callpush.apiBaseUrl"
  private static let maxQueuedEvents = 50
  /// 设备时钟可能偏几十秒：比截止时间晚这么多以内的推送照样响（APNs 的
  /// apns-expiration 已经挡掉了真正过期的投递），到期计时也夹在这个范围里。
  private static let clockSkewTolerance: TimeInterval = 60
  private static let minRingSeconds: TimeInterval = 10
  private static let maxRingSeconds: TimeInterval = 90
  /// 刚结束的通话记多久：迟到的 VoIP 推送（WS 先到、已拒接 / 已取消）不能再响一次。
  private static let recentlyEndedTtl: TimeInterval = 10 * 60

  private let defaults = UserDefaults.standard
  private var registry: PKPushRegistry?
  private lazy var provider: CXProvider = makeProvider()
  private var calls: [UUID: RingingCall] = [:]
  private struct EndedInvitation {
    let createdAt: Date?
    let rememberedAt: Date
  }
  private var recentlyEnded: [UUID: EndedInvitation] = [:]
  private var pendingEvents: [[String: Any]] = []
  var onEventsAvailable: (() -> Void)?

  /// didFinishLaunching 里调用：冷启动到后台处理 VoIP 推送时，registry 与 provider
  /// 必须在推送回调之前就位。
  func start() {
    guard registry == nil else { return }
    _ = provider
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
  }

  func configure(apiBaseUrl: String) {
    defaults.set(apiBaseUrl, forKey: Self.apiBaseUrlKey)
  }

  func voipToken() -> [String: String]? {
    guard let token = defaults.string(forKey: Self.tokenKey), !token.isEmpty else {
      return nil
    }
    return ["token": token, "environment": ApnsEnvironment.current]
  }

  func drainEvents() -> [[String: Any]] {
    let events = pendingEvents
    pendingEvents = []
    return events
  }

  /// JS 从 WS 拿到的来电：没有拒接令牌（JS 活着，拒接由 JS 调接口）。
  func reportFromJs(callId: String, callerName: String, hasVideo: Bool, isGroup: Bool, expiresAt: String, createdAt: String?) {
    let invite = CallPushInvite(
      callId: callId,
      callType: hasVideo ? "VIDEO" : "AUDIO",
      sessionType: isGroup ? "group" : "single",
      callerId: callId,
      callerName: callerName,
      groupName: nil,
      expiresAt: CallPushInvite.parseDate(expiresAt) ?? Date().addingTimeInterval(45),
      createdAt: createdAt.flatMap(CallPushInvite.parseDate),
      declineToken: nil
    )
    reportIncoming(invite, completion: nil)
  }

  /// 不是用户在系统界面上操作的结束（对方取消、超时、在别的设备接听、App 内挂断）：
  /// 直接 reportCall，不经 CXEndCallAction，就不会被当成「用户拒接」再调一次接口。
  func endCall(callId: String, reason: String, createdAt: String?) {
    // 接通了：CallKit 那通电话继续（它就是通话本身），不结束。
    guard reason != "answered" else { return }
    guard let backendId = UUID(uuidString: callId) else { return }
    let uuid = calls.first { $0.value.callId == callId }?.key
    let current = uuid.flatMap { calls[$0] }
    let cutoff = createdAt.flatMap(CallPushInvite.parseDate) ?? current?.createdAt
    if let cutoff, let activeGeneration = current?.createdAt, cutoff < activeGeneration { return }
    rememberEnded(backendId, createdAt: cutoff)
    guard let uuid, let call = calls.removeValue(forKey: uuid) else { return }
    call.expiryTimer?.invalidate()
    provider.reportCall(with: uuid, endedAt: nil, reason: Self.endedReason(reason))
  }

  // MARK: - Private

  private func makeProvider() -> CXProvider {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    // 不写进系统「电话 → 最近通话」，也就不会经 iCloud 同步到用户的其他设备。
    configuration.includesCallsInRecents = false
    let provider = CXProvider(configuration: configuration)
    provider.setDelegate(self, queue: nil)
    return provider
  }

  private func reportIncoming(_ invite: CallPushInvite?, completion: (() -> Void)?) {
    let now = Date()
    guard
      let invite,
      let backendId = UUID(uuidString: invite.callId),
      invite.expiresAt.timeIntervalSince(now) > -Self.clockSkewTolerance
    else {
      // 载荷坏了或早已过期：规则仍要求上报一通来电，报完立刻结束。
      let uuid = calls.first { $0.value.callId == invite?.callId }?.key ?? UUID()
      if calls[uuid] != nil {
        // 这通已经在响 / 已接通（迟到的重复推送）：照样上报一次（CallKit 回
        // callUUIDAlreadyExists），但绝不能把正在进行的这通结束掉。
        provider.reportNewIncomingCall(with: uuid, update: Self.update(for: invite)) { _ in
          completion?()
        }
        return
      }
      provider.reportNewIncomingCall(with: uuid, update: Self.update(for: invite)) { [weak self] _ in
        if self?.calls[uuid] == nil {
          self?.provider.reportCall(with: uuid, endedAt: nil, reason: .failed)
        }
        completion?()
      }
      return
    }

    // CallKit IDs identify system calls. A later invitation to the same
    // backend call receives a fresh system ID once the previous call has ended.
    let uuid = calls.first { $0.value.callId == invite.callId }?.key ?? invite.systemUUID
    if var existing = calls[uuid] {
      if let incoming = invite.createdAt, let current = existing.createdAt, incoming > current, !existing.answered {
        existing.expiryTimer?.invalidate()
        existing = RingingCall(
          callId: invite.callId,
          backendId: backendId,
          createdAt: invite.createdAt,
          declineToken: invite.declineToken,
          answered: false,
          expiryTimer: nil
        )
        calls[uuid] = existing
        scheduleExpiry(uuid, createdAt: invite.createdAt, at: invite.expiresAt)
        provider.reportCall(with: uuid, updated: Self.update(for: invite))
        enqueue(event("incoming", call: existing, fields: ["shown": true]))
      } else if existing.createdAt == invite.createdAt,
                existing.declineToken == nil, let token = invite.declineToken {
        existing = RingingCall(
          callId: existing.callId,
          backendId: existing.backendId,
          createdAt: existing.createdAt,
          declineToken: token,
          answered: existing.answered,
          expiryTimer: existing.expiryTimer
        )
        calls[uuid] = existing
      }
      // Every VoIP delivery must be reported, including a duplicate of a live call.
      provider.reportNewIncomingCall(with: uuid, update: Self.update(for: invite)) { _ in
        completion?()
      }
      return
    }

    if isRecentlyEnded(backendId, createdAt: invite.createdAt) {
      // 本机已经收掉过这通（拒接 / 对方取消 / 别处接听）：规则要求上报，报完立刻结束。
      provider.reportNewIncomingCall(with: uuid, update: Self.update(for: invite)) { [weak self] _ in
        if self?.calls[uuid] == nil {
          self?.provider.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
        }
        completion?()
      }
      return
    }

    calls[uuid] = RingingCall(
      callId: invite.callId,
      backendId: backendId,
      createdAt: invite.createdAt,
      declineToken: invite.declineToken,
      answered: false,
      expiryTimer: nil
    )
    provider.reportNewIncomingCall(with: uuid, update: Self.update(for: invite)) { [weak self] error in
      defer { completion?() }
      guard let self, let call = self.calls[uuid], call.createdAt == invite.createdAt else { return }
      if let error = error as NSError?,
         !(error.domain == CXErrorDomainIncomingCall
           && error.code == CXErrorCodeIncomingCallError.callUUIDAlreadyExists.rawValue) {
        // 勿扰 / 屏蔽名单等：系统没让它响。别把来电从 JS 那边抹掉 —— App 在前台时
        // 应用内弹窗兜底，否则主叫白响到超时。
        self.calls.removeValue(forKey: uuid)
        self.enqueue(self.event("unavailable", call: call))
        return
      }
      self.scheduleExpiry(uuid, createdAt: invite.createdAt, at: invite.expiresAt)
      self.enqueue(self.event("incoming", call: call, fields: ["shown": true]))
    }
  }

  private func scheduleExpiry(_ uuid: UUID, createdAt: Date?, at expiresAt: Date) {
    let delay = min(
      max(expiresAt.timeIntervalSinceNow, Self.minRingSeconds),
      Self.maxRingSeconds
    )
    let timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
      guard let self, let call = self.calls[uuid], call.createdAt == createdAt, !call.answered else { return }
      self.calls.removeValue(forKey: uuid)
      self.rememberEnded(call.backendId, createdAt: call.createdAt)
      self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
      self.enqueue(self.event("end", call: call, fields: ["reason": "missed"]))
    }
    calls[uuid]?.expiryTimer = timer
  }

  private func rememberEnded(_ uuid: UUID, createdAt: Date?) {
    let now = Date()
    recentlyEnded = recentlyEnded.filter { now.timeIntervalSince($0.value.rememberedAt) < Self.recentlyEndedTtl }
    let cutoff = [recentlyEnded[uuid]?.createdAt, createdAt].compactMap { $0 }.max()
    recentlyEnded[uuid] = EndedInvitation(createdAt: cutoff, rememberedAt: now)
  }

  private func isRecentlyEnded(_ uuid: UUID, createdAt: Date?) -> Bool {
    guard let ended = recentlyEnded[uuid],
          Date().timeIntervalSince(ended.rememberedAt) < Self.recentlyEndedTtl else { return false }
    guard let createdAt else { return true }
    // Unversioned old builds cannot identify this new invitation generation.
    guard let cutoff = ended.createdAt else { return false }
    return createdAt <= cutoff
  }

  private func event(_ type: String, call: RingingCall, fields: [String: Any] = [:]) -> [String: Any] {
    var result = fields
    result["type"] = type
    result["callId"] = call.callId
    if let createdAt = call.createdAt { result["createdAt"] = CallPushInvite.formatDate(createdAt) }
    return result
  }

  private func enqueue(_ event: [String: Any]) {
    pendingEvents.append(event)
    if pendingEvents.count > Self.maxQueuedEvents {
      pendingEvents.removeFirst(pendingEvents.count - Self.maxQueuedEvents)
    }
    onEventsAvailable?()
  }

  /// 锁屏拒接：JS 多半没在跑、登录态也过期了，凭推送里的单通令牌直接告诉服务端。
  /// 返回是否发出了请求（没有令牌或没有 API 地址时由 JS 兜底调 reject）。
  private func declineNatively(_ call: RingingCall) -> Bool {
    guard
      let token = call.declineToken,
      let base = defaults.string(forKey: Self.apiBaseUrlKey),
      let url = URL(string: "\(base)/calls/\(call.callId)/push-decline")
    else {
      return false
    }
    var request = URLRequest(url: url, timeoutInterval: 10)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
    var backgroundTask = UIBackgroundTaskIdentifier.invalid
    backgroundTask = UIApplication.shared.beginBackgroundTask {
      UIApplication.shared.endBackgroundTask(backgroundTask)
    }
    URLSession.shared.dataTask(with: request) { _, _, _ in
      DispatchQueue.main.async {
        UIApplication.shared.endBackgroundTask(backgroundTask)
      }
    }.resume()
    return true
  }

  private static func update(for invite: CallPushInvite?) -> CXCallUpdate {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: invite?.callerId ?? "windnote")
    if let invite {
      update.localizedCallerName = invite.groupName.map { "\(invite.callerName) · \($0)" }
        ?? invite.callerName
    }
    update.hasVideo = invite?.callType == "VIDEO"
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    return update
  }

  private static func endedReason(_ reason: String) -> CXCallEndedReason {
    switch reason {
    case "answered_elsewhere": return .answeredElsewhere
    case "declined_elsewhere": return .declinedElsewhere
    case "missed": return .unanswered
    case "failed": return .failed
    default: return .remoteEnded
    }
  }
}

extension CallPushCenter: PKPushRegistryDelegate {
  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    defaults.set(token, forKey: Self.tokenKey)
    enqueue(["type": "voipToken"])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    defaults.removeObject(forKey: Self.tokenKey)
    enqueue(["type": "voipToken"])
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    reportIncoming(CallPushInvite(payload: payload.dictionaryPayload["call"]), completion: completion)
  }
}

extension CallPushCenter: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    for (uuid, call) in calls {
      call.expiryTimer?.invalidate()
      rememberEnded(call.backendId, createdAt: call.createdAt)
      enqueue(event("end", call: call, fields: ["reason": "failed"]))
    }
    calls.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard var call = calls[action.callUUID] else {
      action.fail()
      return
    }
    call.answered = true
    call.expiryTimer?.invalidate()
    call.expiryTimer = nil
    calls[action.callUUID] = call
    enqueue(event("answer", call: call))
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let call = calls.removeValue(forKey: action.callUUID) else {
      action.fulfill()
      return
    }
    call.expiryTimer?.invalidate()
    rememberEnded(call.backendId, createdAt: call.createdAt)
    if call.answered {
      enqueue(event("hangup", call: call))
    } else {
      let declinedByNative = declineNatively(call)
      enqueue(event("decline", call: call, fields: ["declinedByNative": declinedByNative]))
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    WebRTCAudioBridge.didActivate(audioSession)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    WebRTCAudioBridge.didDeactivate(audioSession)
  }
}

#endif
