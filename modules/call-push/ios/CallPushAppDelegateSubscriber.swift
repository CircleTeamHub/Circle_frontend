import ExpoModulesCore

/// 被 VoIP 推送冷启动到后台时，PushKit 回调来得很早：registry 与 CallKit provider 必须在
/// didFinishLaunching 里就建好，不能等 JS 加载完再建。
public class CallPushAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallPushCenter.shared.start()
    return true
  }
}
