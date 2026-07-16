import { logClientDiagnostic } from '@/utils/client-diagnostics';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 通知链路里「会静默吞掉」的失败事件统一走这里，dev 下给出两条线索：
 * - logClientDiagnostic：可聚合的事件名 + 非 PII 的 id/上下文
 * - 额外把原始 error 打到控制台，方便本地定位
 *
 * 注意：生产环境这里是 no-op。logClientDiagnostic 底层是 console.warn，
 * production 构建会被 transform-remove-console 剥掉，从来就没真正落过盘——
 * 曾经的注释声称「生产会落一条诊断事件」，那是未兑现的意图，不是事实。
 * 生产要可观测就得接 reportError → Sentry（见 observability/sentry），另议。
 */
export type NotificationFailureEvent =
  | 'push_token_register_failed'
  | 'push_token_unregister_failed'
  | 'push_token_revoke_failed'
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
