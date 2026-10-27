package expo.modules.callpush

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class CallPushPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(CallPushActivityListener())
}

/**
 * 通知上的「接听」与全屏来电都是拉起主 Activity 的 PendingIntent：在这里认出它们，
 * 排一个 answer 事件给 JS，并让 Activity 能显示在锁屏之上。也顺带记录 App 是否在前台
 * （前台时来电由 WS + 应用内弹窗负责，原生层不再弹通知）。
 */
class CallPushActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    AppVisibility.activity = WeakReference(activity)
    handleIntent(activity, activity.intent)
  }

  override fun onResume(activity: Activity) {
    AppVisibility.foreground = true
    AppVisibility.activity = WeakReference(activity)
  }

  override fun onPause(activity: Activity) {
    AppVisibility.foreground = false
  }

  override fun onNewIntent(intent: Intent): Boolean {
    AppVisibility.activity?.get()?.let { handleIntent(it, intent) }
    return false
  }

  private fun handleIntent(activity: Activity, intent: Intent?) {
    val action = intent?.getStringExtra(IncomingCallNotifier.EXTRA_ACTION) ?: return
    val callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID) ?: return
    // 用过就清掉：Activity 重建（旋转、回收）时不能再接听一次。
    intent.removeExtra(IncomingCallNotifier.EXTRA_ACTION)
    intent.removeExtra(IncomingCallNotifier.EXTRA_CALL_ID)
    showOverLockScreen(activity)
    if (action == IncomingCallNotifier.ACTION_ANSWER) {
      IncomingCallNotifier.cancel(activity, callId)
      CallPushEvents.enqueue(mapOf("type" to "answer", "callId" to callId))
    }
  }

  companion object {
    private fun showOverLockScreen(activity: Activity) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(true)
        activity.setTurnScreenOn(true)
      } else {
        @Suppress("DEPRECATION")
        activity.window.addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
        )
      }
    }

    /** 通话结束：回到正常的锁屏行为，别让 App 一直盖在锁屏上。 */
    fun releaseLockScreen() {
      val activity = AppVisibility.activity?.get() ?: return
      activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(false)
          activity.setTurnScreenOn(false)
        } else {
          @Suppress("DEPRECATION")
          activity.window.clearFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
          )
        }
      }
    }
  }
}
