package expo.modules.callpush

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class IncomingCallOptions : Record {
  @Field val callId: String = ""
  @Field val callerName: String = ""
  @Field val hasVideo: Boolean = false
  @Field val isGroup: Boolean = false
  @Field val expiresAt: String = ""
}

class CallPushModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CallPush")

    Events("onCallEventsAvailable")

    OnStartObserving {
      CallPushEvents.listener = { sendEvent("onCallEventsAvailable", Bundle()) }
    }

    OnStopObserving {
      CallPushEvents.listener = null
    }

    AsyncFunction("configure") { apiBaseUrl: String ->
      CallPushStore.setApiBaseUrl(context, apiBaseUrl)
    }

    AsyncFunction("consumeEvents") {
      CallPushEvents.drain()
    }

    // PushKit 只有 iOS 有。
    AsyncFunction("getVoipToken") {
      null as Map<String, String>?
    }

    /** JS 已知的来电（WS 送到、App 随后切到后台）：交给原生层响铃。没有拒接令牌，拒接由 JS 调接口。 */
    AsyncFunction("showIncomingCall") { options: IncomingCallOptions ->
      val expiresAtMs = CallPushInvite.parseIsoMillis(options.expiresAt) ?: return@AsyncFunction
      val invite = CallPushInvite(
        callId = options.callId,
        isVideo = options.hasVideo,
        isGroup = options.isGroup,
        callerName = options.callerName,
        groupName = null,
        expiresAtMs = expiresAtMs,
        declineToken = null,
      )
      val now = System.currentTimeMillis()
      if (invite.isExpired(now) || CallPushStore.isDismissed(context, invite.callId, now)) {
        return@AsyncFunction
      }
      IncomingCallNotifier.show(context, invite)
    }

    /** 这通电话不再响了（接通 / 结束 / 被收掉）：收通知，记成已撤销，放开锁屏显示。 */
    AsyncFunction("endCall") { callId: String, reason: String ->
      CallPushStore.markDismissed(context, callId)
      IncomingCallNotifier.cancel(context, callId)
      // 接通了还要留在锁屏之上（通话页盖在锁屏上）；其余情况放开。
      if (reason != "answered") CallPushActivityListener.releaseLockScreen()
    }

    Function("canUseFullScreenIntent") {
      IncomingCallNotifier.canUseFullScreenIntent(context)
    }

    AsyncFunction("openFullScreenIntentSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
