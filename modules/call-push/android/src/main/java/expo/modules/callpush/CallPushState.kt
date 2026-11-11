package expo.modules.callpush

import android.app.Activity
import android.content.Context
import org.json.JSONObject
import java.lang.ref.WeakReference

/** 原生层排给 JS 的事件：先排队，再发一个 onCallEventsAvailable 信号让 JS 来取。 */
object CallPushEvents {
  private const val MAX_QUEUED = 50
  private val queue = ArrayList<Map<String, Any?>>()

  @Volatile
  var listener: (() -> Unit)? = null

  fun enqueue(event: Map<String, Any?>) {
    synchronized(queue) {
      queue.add(event)
      if (queue.size > MAX_QUEUED) queue.subList(0, queue.size - MAX_QUEUED).clear()
    }
    listener?.invoke()
  }

  fun drain(): List<Map<String, Any?>> = synchronized(queue) {
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
 * 持久化的少量状态：原生拒接要用的 API 根地址，以及每通来电最新的邀请时间和撤销边界 ——
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
  fun acceptInvite(context: Context, invite: CallPushInvite, nowMs: Long = System.currentTimeMillis()): Boolean {
    val records = readRecords(context, nowMs)
    val next = generation(records.optJSONObject(invite.callId)).receive(invite.createdAtMs) ?: return false
    writeRecord(context, records, invite.callId, next, nowMs)
    return true
  }

  @Synchronized
  fun acceptsAction(context: Context, callId: String, createdAtMs: Long?): Boolean =
    generation(readRecords(context, System.currentTimeMillis()).optJSONObject(callId)).accepts(createdAtMs)

  /** False means this dismissal belongs to an older invitation that is already replaced. */
  @Synchronized
  fun markDismissed(
    context: Context,
    callId: String,
    createdAtMs: Long? = null,
    nowMs: Long = System.currentTimeMillis(),
  ): Boolean {
    val records = readRecords(context, nowMs)
    val next = generation(records.optJSONObject(callId)).dismiss(createdAtMs) ?: return false
    writeRecord(context, records, callId, next, nowMs)
    return true
  }

  private fun generation(record: JSONObject?): CallPushGeneration = CallPushGeneration(
    latestInviteAtMs = record?.optLong("latestInviteAtMs")?.takeIf { it > 0 },
    dismissedThroughMs = record?.optLong("dismissedThroughMs")?.takeIf { it > 0 },
    legacyDismissed = record?.optBoolean("legacyDismissed") ?: false,
  )

  private fun writeRecord(
    context: Context,
    records: JSONObject,
    callId: String,
    state: CallPushGeneration,
    nowMs: Long,
  ) {
    val record = JSONObject().put("expiresAtMs", nowMs + DISMISSED_TTL_MS)
      .put("legacyDismissed", state.legacyDismissed)
    state.latestInviteAtMs?.let { record.put("latestInviteAtMs", it) }
    state.dismissedThroughMs?.let { record.put("dismissedThroughMs", it) }
    records.put(callId, record)
    while (records.length() > MAX_DISMISSED) {
      val oldest = records.keys().asSequence().minByOrNull {
        records.optJSONObject(it)?.optLong("expiresAtMs") ?: 0
      } ?: break
      records.remove(oldest)
    }
    prefs(context).edit().putString(KEY_DISMISSED, records.toString()).apply()
  }

  private fun readRecords(context: Context, nowMs: Long): JSONObject {
    val raw = prefs(context).getString(KEY_DISMISSED, null) ?: return JSONObject()
    val parsed = runCatching { JSONObject(raw) }.getOrNull() ?: return JSONObject()
    val live = JSONObject()
    for (key in parsed.keys()) {
      // Older builds stored only a retention deadline. Keep suppressing their
      // unversioned duplicates while allowing a new timestamped invitation.
      val record = parsed.optJSONObject(key) ?: JSONObject()
        .put("expiresAtMs", parsed.optLong(key))
        .put("legacyDismissed", true)
      if (record.optLong("expiresAtMs") > nowMs) live.put(key, record)
    }
    return live
  }
}
