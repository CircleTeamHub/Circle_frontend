package expo.modules.callpush

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import cn.jiguang.plugins.push.receiver.JPushModuleReceiver
import cn.jpush.android.api.CustomMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * 替换 jpush-react-native 的接收端（配置插件 with-call-push 在清单里换掉它）：
 * 来电透传在这里截下由原生层处理 —— App 进程活着但 JS 没跑、或聊天连接已在后台挂起时
 * 也能响铃；其余消息全部 super 回原逻辑，现有的 JS 监听与通知点击行为不变。
 */
class CallJPushReceiver : JPushModuleReceiver() {
  override fun onMessage(context: Context, customMessage: CustomMessage) {
    val extras = CallPushInvite.callExtras(customMessage.extra)
    if (extras == null) {
      super.onMessage(context, customMessage)
      return
    }
    CallPushHandler.onPush(context, extras)
  }
}

object CallPushHandler {
  fun onPush(context: Context, extras: JSONObject, nowMs: Long = System.currentTimeMillis()) {
    when (extras.optString("type")) {
      "call.invite" -> {
        val invite = CallPushInvite.fromExtras(extras) ?: return
        if (invite.isExpired(nowMs) || CallPushStore.isDismissed(context, invite.callId, nowMs)) return
        CallPushEvents.enqueue(mapOf("type" to "incoming", "callId" to invite.callId))
        // App 在前台时 WS 会送到同一通邀请，应用内弹窗负责；后台 / 没在跑才由原生层响铃。
        if (!AppVisibility.foreground) IncomingCallNotifier.show(context, invite)
      }
      "call.dismiss" -> {
        val callId = extras.optString("callId").ifEmpty { return }
        CallPushStore.markDismissed(context, callId, nowMs)
        IncomingCallNotifier.cancel(context, callId)
        CallPushEvents.enqueue(
          mapOf("type" to "end", "callId" to callId, "reason" to extras.optString("reason", "ended")),
        )
      }
    }
  }
}

/** 来电通知上的「拒绝」：收掉通知，凭推送里的单通令牌直接告诉服务端（JS 多半没在跑）。 */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != IncomingCallNotifier.ACTION_DECLINE) return
    val callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID) ?: return
    val token = intent.getStringExtra(IncomingCallNotifier.EXTRA_DECLINE_TOKEN)
    val baseUrl = CallPushStore.apiBaseUrl(context)
    IncomingCallNotifier.cancel(context, callId)
    CallPushStore.markDismissed(context, callId)
    val declinedByNative = token != null && baseUrl != null
    CallPushEvents.enqueue(
      mapOf("type" to "decline", "callId" to callId, "declinedByNative" to declinedByNative),
    )
    if (!declinedByNative) return
    val pending = goAsync()
    thread(name = "call-push-decline") {
      try {
        postDecline(baseUrl!!, callId, token!!)
      } finally {
        pending.finish()
      }
    }
  }

  private fun postDecline(baseUrl: String, callId: String, token: String) {
    val connection = runCatching {
      URL("$baseUrl/calls/$callId/push-decline").openConnection() as HttpURLConnection
    }.getOrNull() ?: return
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 8_000
      connection.readTimeout = 8_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
      // 204 成功 / 401 令牌无效都不重试：振铃窗口很短，主叫那边超时也会收尾。
      connection.responseCode
    } catch (_: Exception) {
      // 网络不通：服务端到点按未接收尾。
    } finally {
      connection.disconnect()
    }
  }
}
