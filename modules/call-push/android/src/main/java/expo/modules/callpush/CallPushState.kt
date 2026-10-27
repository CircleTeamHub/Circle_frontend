package expo.modules.callpush

import android.app.Activity
import android.content.Context
import org.json.JSONObject
import java.lang.ref.WeakReference

/** 原生层排给 JS 的事件：先排队，再发一个 onCallEventsAvailable 信号让 JS 来取。 */
object CallPushEvents {
  private const val MAX_QUEUED = 50
  private val queue = ArrayList<Map<String, Any>>()

  @Volatile
  var listener: (() -> Unit)? = null

  fun enqueue(event: Map<String, Any>) {
    synchronized(queue) {
      queue.add(event)
      if (queue.size > MAX_QUEUED) queue.subList(0, queue.size - MAX_QUEUED).clear()
    }
    listener?.invoke()
  }

  fun drain(): List<Map<String, Any>> = synchronized(queue) {
    val events = ArrayList(queue)
    queue.clear()
    events
  }
}

/** 主 Activity 是否在前台、以及当前的 Activity（锁屏上显示来电界面要用）。 */
object AppVisibility {
  @Volatile
  var foreground: Boolean = false

  @Volatile
  var activity: WeakReference<Activity>? = null
}

/**
 * 持久化的少量状态：原生拒接要用的 API 根地址，以及最近被撤销的 callId ——
 * 撤销可能先于邀请到达（极光不保证顺序），记住它才能不让迟到的邀请再响。
 */
object CallPushStore {
  private const val PREFS = "expo.modules.callpush"
  private const val KEY_API_BASE_URL = "apiBaseUrl"
  private const val KEY_DISMISSED = "dismissed"
  private const val MAX_DISMISSED = 20
  /** 撤销记录保留多久：盖过一整个振铃窗口（服务端最长 45 秒）再留余量。 */
  private const val DISMISSED_TTL_MS = 10 * 60_000L

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun apiBaseUrl(context: Context): String? =
    prefs(context).getString(KEY_API_BASE_URL, null)?.takeIf { it.isNotBlank() }

  fun setApiBaseUrl(context: Context, value: String) {
    prefs(context).edit().putString(KEY_API_BASE_URL, value).apply()
  }

  @Synchronized
  fun markDismissed(context: Context, callId: String, nowMs: Long = System.currentTimeMillis()) {
    val dismissed = readDismissed(context, nowMs)
    dismissed.put(callId, nowMs + DISMISSED_TTL_MS)
    while (dismissed.length() > MAX_DISMISSED) {
      val oldest = dismissed.keys().asSequence().minByOrNull { dismissed.optLong(it) } ?: break
      dismissed.remove(oldest)
    }
    prefs(context).edit().putString(KEY_DISMISSED, dismissed.toString()).apply()
  }

  @Synchronized
  fun isDismissed(context: Context, callId: String, nowMs: Long = System.currentTimeMillis()): Boolean =
    readDismissed(context, nowMs).has(callId)

  private fun readDismissed(context: Context, nowMs: Long): JSONObject {
    val raw = prefs(context).getString(KEY_DISMISSED, null) ?: return JSONObject()
    val parsed = runCatching { JSONObject(raw) }.getOrNull() ?: return JSONObject()
    val live = JSONObject()
    for (key in parsed.keys()) {
      val expiresAt = parsed.optLong(key)
      if (expiresAt > nowMs) live.put(key, expiresAt)
    }
    return live
  }
}
