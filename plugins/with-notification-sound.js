const { withMainApplication } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// Android locks a channel's sound after creation. Install new channels before
// a background push can arrive, carrying forward user mute/custom settings.
module.exports = function withNotificationSound(config, { pushProvider = 'expo' } = {}) {
  // JPush 6.2 default builder: importance 3 and defaults 7 -> JPush_3_7.
  const [legacyChatId, legacyActivityId] = pushProvider === 'jpush'
    ? ['JPush_3_7', 'JPush_3_7']
    : ['chat', 'expo_notifications_fallback_notification_channel'];
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = mergeContents({
      src: mod.modResults.contents,
      tag: 'windnote-notification-sound',
      anchor: /super\.onCreate\(\)/,
      offset: 1,
      comment: '    //',
      newSrc: `    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      val notificationManager = getSystemService(android.app.NotificationManager::class.java)
      val soundName = resources.getResourceEntryName(R.raw.notification_swift_gesture)
      val notificationSound = android.net.Uri.parse("android.resource://$packageName/raw/$soundName")
      val audioAttributes = android.media.AudioAttributes.Builder()
        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      for ((channelId, legacyId) in listOf(
        "chat_swift_gesture" to "${legacyChatId}",
        "activity_swift_gesture" to "${legacyActivityId}"
      )) {
        if (notificationManager.getNotificationChannel(channelId) == null) {
          val legacy = notificationManager.getNotificationChannel(legacyId)
          val channel = android.app.NotificationChannel(
            channelId, legacy?.name ?: applicationInfo.loadLabel(packageManager),
            legacy?.importance ?: android.app.NotificationManager.IMPORTANCE_HIGH
          )
          val sound = if (legacy != null && legacy.sound != android.provider.Settings.System.DEFAULT_NOTIFICATION_URI) {
            legacy.sound
          } else {
            notificationSound
          }
          channel.setSound(sound, legacy?.audioAttributes ?: audioAttributes)
          channel.description = legacy?.description
          channel.lockscreenVisibility = legacy?.lockscreenVisibility ?: android.app.Notification.VISIBILITY_PRIVATE
          channel.setShowBadge(legacy?.canShowBadge() ?: true)
          channel.vibrationPattern = legacy?.vibrationPattern ?: longArrayOf(0, 250, 250, 250)
          channel.enableVibration(legacy?.shouldVibrate() ?: true)
          channel.setBypassDnd(legacy?.canBypassDnd() ?: false)
          channel.enableLights(legacy?.shouldShowLights() ?: false)
          channel.lightColor = legacy?.lightColor ?: 0
          channel.group = legacy?.group
          notificationManager.createNotificationChannel(channel)
        }
      }
    }`,
    }).contents;
    return mod;
  });
};
