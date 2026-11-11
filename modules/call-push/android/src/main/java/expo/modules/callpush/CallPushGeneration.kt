package expo.modules.callpush

/** Server invitation timestamps distinguish repeated invitations to the same call. */
data class CallPushGeneration(
  val latestInviteAtMs: Long? = null,
  val dismissedThroughMs: Long? = null,
  val legacyDismissed: Boolean = false,
) {
  fun accepts(createdAtMs: Long?): Boolean {
    if (createdAtMs == null) return !legacyDismissed && dismissedThroughMs == null
    return (latestInviteAtMs == null || createdAtMs >= latestInviteAtMs) &&
      (dismissedThroughMs == null || createdAtMs > dismissedThroughMs)
  }

  fun receive(createdAtMs: Long?): CallPushGeneration? {
    if (!accepts(createdAtMs)) return null
    return copy(latestInviteAtMs = createdAtMs ?: latestInviteAtMs)
  }

  fun dismiss(createdAtMs: Long?): CallPushGeneration? {
    val cutoff = createdAtMs ?: latestInviteAtMs
    if (cutoff != null && latestInviteAtMs != null && cutoff < latestInviteAtMs) return null
    return copy(
      dismissedThroughMs = listOfNotNull(dismissedThroughMs, cutoff).maxOrNull(),
      legacyDismissed = legacyDismissed || cutoff == null,
    )
  }
}
