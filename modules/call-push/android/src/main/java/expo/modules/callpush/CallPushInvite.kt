package expo.modules.callpush

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** 推送载荷 v1（circle_be src/call/call-push.service.ts），极光 extras 里全是字符串。 */
data class CallPushInvite(
  val callId: String,
  val isVideo: Boolean,
  val isGroup: Boolean,
  val callerName: String,
  val groupName: String?,
  val expiresAtMs: Long,
  val declineToken: String?,
) {
  /** 群通话显示「主叫 · 群名」。 */
  val displayName: String
    get() = groupName?.let { "$callerName · $it" } ?: callerName

  /** 设备时钟可能偏几十秒：比截止时间晚这么多以内仍算有效（极光 TTL 已挡掉真过期的）。 */
  fun isExpired(nowMs: Long): Boolean = expiresAtMs < nowMs - CLOCK_SKEW_TOLERANCE_MS

  companion object {
    const val CLOCK_SKEW_TOLERANCE_MS = 60_000L
    private val UUID_PATTERN = Regex("^[0-9a-fA-F-]{8,64}$")

    /** 是来电类透传（type 以 call. 开头、协议版本 1）就返回 extras，否则 null 交回极光原逻辑。 */
    fun callExtras(rawExtras: String?): JSONObject? {
      if (rawExtras.isNullOrBlank()) return null
      val extras = runCatching { JSONObject(rawExtras) }.getOrNull() ?: return null
      val type = extras.optString("type")
      return if (type.startsWith("call.") && extras.optString("v") == "1") extras else null
    }

    fun fromExtras(extras: JSONObject): CallPushInvite? {
      if (extras.optString("type") != "call.invite") return null
      val callId = extras.optString("callId")
      val callerName = extras.optString("callerName")
      val expiresAtMs = parseIsoMillis(extras.optString("expiresAt")) ?: return null
      if (!UUID_PATTERN.matches(callId) || callerName.isEmpty()) return null
      return CallPushInvite(
        callId = callId,
        isVideo = extras.optString("callType") == "VIDEO",
        isGroup = extras.optString("sessionType") == "group",
        callerName = callerName,
        groupName = extras.optString("groupName").ifEmpty { null },
        expiresAtMs = expiresAtMs,
        declineToken = extras.optString("declineToken").ifEmpty { null },
      )
    }

    /** 服务端用 Date#toISOString()：固定 yyyy-MM-ddTHH:mm:ss.SSSZ（UTC）。minSdk 24 用不了 java.time。 */
    fun parseIsoMillis(raw: String): Long? {
      if (raw.isEmpty()) return null
      for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
        val format = SimpleDateFormat(pattern, Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
          isLenient = false
        }
        val parsed = runCatching { format.parse(raw) }.getOrNull()
        if (parsed != null) return parsed.time
      }
      return null
    }
  }
}
