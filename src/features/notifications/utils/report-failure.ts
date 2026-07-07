import { logClientDiagnostic } from '@/utils/client-diagnostics';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 通知链路里「会静默吞掉」的失败事件。之前这些 catch 只在 __DEV__ 下 console.warn，
 * 生产环境完全无声——推送注册全挂、已读同步失败都无从察觉。统一走这里：
 * - 生产：logClientDiagnostic 落一条可聚合的诊断事件（只带非 PII 的 id/上下文）
 * - 开发：额外把原始 error 打到控制台，方便本地定位
 */
export type NotificationFailureEvent =
  | 'push_token_register_failed'
  | 'push_token_unregister_failed'
  | 'notification_mark_read_failed'
  | 'notification_delete_failed'
  | 'notification_load_more_failed'
  | 'notification_mark_all_read_failed';

export function reportNotificationFailure(
  event: NotificationFailureEvent,
  error: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {},
) {
  logClientDiagnostic(event, context);
  if (isDev) {
    console.warn(`[notifications] ${event}`, error, context);
  }
}
