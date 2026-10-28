import ExpoModulesCore

struct IncomingCallOptions: Record {
  @Field var callId: String = ""
  @Field var callerName: String = ""
  @Field var hasVideo: Bool = false
  @Field var isGroup: Bool = false
  @Field var expiresAt: String = ""
}

public class CallPushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CallPush")

    Events("onCallEventsAvailable")

    OnStartObserving { [weak self] in
      CallPushCenter.shared.onEventsAvailable = {
        self?.sendEvent("onCallEventsAvailable", [:])
      }
    }

    OnStopObserving {
      CallPushCenter.shared.onEventsAvailable = nil
    }

    AsyncFunction("configure") { (apiBaseUrl: String) in
      CallPushCenter.shared.configure(apiBaseUrl: apiBaseUrl)
    }.runOnQueue(.main)

    AsyncFunction("consumeEvents") { () -> [[String: Any]] in
      CallPushCenter.shared.drainEvents()
    }.runOnQueue(.main)

    AsyncFunction("getVoipToken") { () -> [String: String]? in
      CallPushCenter.shared.voipToken()
    }.runOnQueue(.main)

    AsyncFunction("showIncomingCall") { (options: IncomingCallOptions) in
      CallPushCenter.shared.reportFromJs(
        callId: options.callId,
        callerName: options.callerName,
        hasVideo: options.hasVideo,
        isGroup: options.isGroup,
        expiresAt: options.expiresAt
      )
    }.runOnQueue(.main)

    AsyncFunction("endCall") { (callId: String, reason: String) in
      CallPushCenter.shared.endCall(callId: callId, reason: reason)
    }.runOnQueue(.main)

    // iOS 没有「全屏来电」权限一说：CallKit 永远是系统来电界面。
    Function("canUseFullScreenIntent") { () -> Bool in
      true
    }

    AsyncFunction("openFullScreenIntentSettings") {}
  }
}
