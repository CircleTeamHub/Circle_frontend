package expo.modules.callpush

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * 全屏来电通知：CallStyle + full-screen intent + 循环铃声（FLAG_INSISTENT），
 * 到振铃截止自动消失（setTimeoutAfter）。锁屏 / 亮屏时 full-screen intent 直接拉起 App，
 * 其余时候是一条带「接听 / 拒绝」的置顶来电通知。
 */
object IncomingCallNotifier {
  const val CHANNEL_ID = "incoming_call_v1"
  const val EXTRA_ACTION = "expo.modules.callpush.ACTION"
  const val EXTRA_CALL_ID = "expo.modules.callpush.CALL_ID"
  const val EXTRA_DECLINE_TOKEN = "expo.modules.callpush.DECLINE_TOKEN"
  const val ACTION_ANSWER = "answer"
  const val ACTION_OPEN = "open"
  const val ACTION_DECLINE = "expo.modules.callpush.DECLINE"
  private const val TAG = "CallPush"
  private const val MIN_RING_MS = 10_000L
  private const val MAX_RING_MS = 90_000L

  fun show(context: Context, invite: CallPushInvite) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    ensureChannel(context)

    val open = activityIntent(context, invite.callId, ACTION_OPEN)
    val answer = activityIntent(context, invite.callId, ACTION_ANSWER)
    val decline = declineIntent(context, invite)
    val caller = Person.Builder().setName(invite.displayName).setImportant(true).build()
    val ringMs = (invite.expiresAtMs - System.currentTimeMillis()).coerceIn(MIN_RING_MS, MAX_RING_MS)
    val text = context.getString(
      if (invite.isVideo) R.string.call_push_incoming_video else R.string.call_push_incoming_audio,
    )
    // 锁屏上只显示「来电」，解锁后才露出名字（与聊天推送的锁屏策略一致）。
    val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(context.getString(R.string.call_push_public_title))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()

    fun baseBuilder() = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(invite.displayName)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(ringMs)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioManager.STREAM_RING)
      .setVibrate(longArrayOf(0, 1000, 1000))

    val callStyle = runCatching {
      baseBuilder()
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(invite.isVideo))
        .build()
    }.getOrNull()
    // CallStyle 在个别 ROM 上 build 会抛（要求前台服务 / 全屏意图的校验实现不一）：退回普通通知 + 两个按钮。
    val notification = callStyle ?: baseBuilder()
      .addAction(0, context.getString(R.string.call_push_decline), decline)
      .addAction(0, context.getString(R.string.call_push_answer), answer)
      .build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT

    try {
      manager.notify(invite.callId, notificationId(invite.callId), notification)
    } catch (error: SecurityException) {
      // 安卓 13+ 没给通知权限：没法响铃，交给 WS / 未接记录。
      Log.w(TAG, "incoming call notification not permitted")
    }
  }

  fun cancel(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(callId, notificationId(callId))
  }

  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    return context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
  }

  private fun notificationId(callId: String) = callId.hashCode()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // 渠道一经创建铃声就改不了：要换铃声只能换 CHANNEL_ID。
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.call_push_channel_name),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = context.getString(R.string.call_push_channel_description)
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 1000, 1000)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannel(channel)
  }

  private fun activityIntent(context: Context, callId: String, action: String): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    launch.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_ACTION, action)
      putExtra(EXTRA_CALL_ID, callId)
    }
    // 安卓 12 起不许从广播接收端跳转界面：接听必须直接是一个 Activity 的 PendingIntent。
    return PendingIntent.getActivity(
      context,
      requestCode(callId, action),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun declineIntent(context: Context, invite: CallPushInvite): PendingIntent {
    val intent = Intent(context, CallActionReceiver::class.java).apply {
      action = ACTION_DECLINE
      putExtra(EXTRA_CALL_ID, invite.callId)
      invite.declineToken?.let { putExtra(EXTRA_DECLINE_TOKEN, it) }
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode(invite.callId, ACTION_DECLINE),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun requestCode(callId: String, action: String) = (callId + action).hashCode()

  private fun smallIcon(context: Context): Int {
    val notificationIcon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (notificationIcon != 0) notificationIcon else context.applicationInfo.icon
  }
}
