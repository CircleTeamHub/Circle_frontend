package expo.modules.callpush

import org.junit.Assert.*
import org.junit.Test

class CallPushGenerationTest {
  private val first = 1_700_000_000_123L
  private val next = first + 20_000L

  @Test fun aNewInvitationRingsAfterTheSameCallsPreviousInvitationWasDismissed() {
    val dismissed = CallPushGeneration().receive(first)!!.dismiss(first)!!
    assertNull(dismissed.receive(first))
    assertNotNull(dismissed.receive(next))
  }

  @Test fun delayedOldInvitesCannotReplaceANewerRingingInvitation() {
    val ringing = CallPushGeneration().receive(next)!!
    assertNull(ringing.receive(first))
    assertNotNull(ringing.receive(next))
  }

  @Test fun anOldDismissalCannotCancelTheNewInvitation() {
    val ringing = CallPushGeneration().receive(first)!!.dismiss(first)!!.receive(next)!!
    assertNull(ringing.dismiss(first))
    val dismissed = ringing.dismiss(next)!!
    assertNull(dismissed.receive(next))
  }

  @Test fun legacyRecordsStillBlockLegacyDuplicatesButAllowTimestampedInvitations() {
    val legacy = CallPushGeneration(legacyDismissed = true)
    assertNull(legacy.receive(null))
    assertNotNull(legacy.receive(next))
  }

  @Test fun aCallEndCutoffSuppressesEveryEarlierInvitation() {
    val ended = CallPushGeneration().receive(first)!!.dismiss(next)!!
    assertNull(ended.receive(first))
    assertNull(ended.receive(next))
    assertNull(ended.receive(null))
    assertNotNull(ended.receive(next + 1))
  }

  @Test fun dismissingWithoutAGenerationUsesTheInvitationAlreadyShown() {
    val dismissed = CallPushGeneration().receive(first)!!.dismiss(null)!!
    assertNull(dismissed.receive(first))
    assertNotNull(dismissed.receive(next))
  }
}
