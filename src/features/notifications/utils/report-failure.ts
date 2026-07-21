import { reportError } from '@/observability/sentry';
import { ApiError } from '@/services/api/client';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 通知链路里「会静默吞掉」的失败事件统一走这里。
 *
 * dev：logClientDiagnostic（可聚合事件名 + 非 PII 上下文）+ 原始 error 打控制台。
 * 这两条在生产一律无声——底层都是 console.warn，production 构建会被
 * transform-remove-console 剥掉。生产的可观测性只由下面的 reportError 提供。
 *
 * 生产：只把「API 层不会上报的那一类」送进 Sentry，且按根因去重。两条约束都不是
 * 保守，是必须：
 *
 * - 通知的每个 API 调用都走 apiClient，network(0)/5xx 已由 client.ts 上报过一次。
 *   ApiError 在这里再报只会是同一根因的第二个 issue（fingerprint 不同）+ 双倍配额，
 *   没有新信息；预期内的 4xx（401 会话过期 / 404 通知已删）API 层有意不报，这里也
 *   不越权补报。代价是 register 的 400 契约破损同样不可见，但那是 dev/QA 期就该拦
 *   下的系统性 bug，不值得用每会话的 401 噪音去换。
 *   于是真正留给这里的，正好是从不经过 apiClient 的那些：getExpoPushTokenAsync
 *   抛错（FCM/APNs 配置错、projectId 无效）、权限调用抛错、导航抛错（点了推送什么
 *   都不发生）、以及 generateRevocationSecret 生产独有的 hard throw。
 *   这个过滤器现在是 client.ts 规则的严格补集。曾经不是：readPayload 的 res.text()
 *   在 fetch 的 try/catch 之外，读 body 中途断网会抛裸 TypeError（status 为
 *   undefined），client.ts 报它、又原样抛出，于是这里的 instanceof ApiError 接不住、
 *   再报一次。该洞已修（body 读失败转成 status 0、failureKind 'body-read' 的
 *   ApiError），apiClient 只抛 ApiError，本过滤器因此不再漏。
 *   这条不变量是本函数去重的前提，测试见 test/api-client-body-read.test.js 与
 *   test/notification-report-failure.test.js 里那条跨模块的集成用例。
 *
 * - 注册器每次 app 切前台都重跑 sync；撤销队列失败后每 60s 重试且永不停止；导航失败
 *   还会自重试 3 次。按次上报的话，一个系统性故障就能按「用户数 × 前台次数」刷爆配额。
 *   去重的思路同 credit-policy 的 reportGateEventOnce，但 key 不能只用事件名：
 *   push_token_register_failed 是整个 sync() 的兜底 catch，上面那四类根因全挤在这一
 *   个名字下，只按名字去重的话，开机时一次弱网超时就把预算烧了，同会话里稍后那条
 *   「推送 100% 死」永远发不出去。所以 key 带上 error 的 name + message。
 */
export type NotificationFailureEvent =
  | 'push_token_register_failed'
  | 'push_token_unregister_failed'
  | 'push_token_revoke_failed'
  | 'notification_mark_read_failed'
  | 'notification_delete_failed'
  | 'notification_load_more_failed'
  | 'notification_mark_all_read_failed'
  | 'notification_navigate_failed'
  | 'notification_navigate_abandoned'
  | 'notification_ownership_verify_failed'
  | 'notification_payload_invalid';

// message 参与 signature 就有基数风险（原生错误偶尔把可变细节拼进 message），所以要
// 有上限。但上限必须是「每事件」的：预算一旦做成全局的，基数最高的那个事件
// （notification_navigate_failed —— route 由服务端 payload 推导，router 报错常把 href
// 拼进 message）就会把池子刷满，让一条全新的「推送 100% 死」整个会话都发不出去。
// 那正是上限本身制造的饿死，比不设上限更糟。每事件独立 → 吵的事件永远饿不死安静的。
const MAX_SIGNATURES_PER_EVENT = 3;
const MAX_SIGNATURE_MESSAGE_LENGTH = 200;

const reportedFailureSignatures = new Map<NotificationFailureEvent, Set<string>>();

/** 测试隔离用：清掉「本生命周期已上报」的记账。 */
export function resetNotificationFailureTelemetry() {
  reportedFailureSignatures.clear();
}

function failureSignature(
  event: NotificationFailureEvent,
  error: unknown,
): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message =
    error instanceof Error ? error.message : String(error);
  return `${event}\u0000${name}\u0000${message.slice(
    0,
    MAX_SIGNATURE_MESSAGE_LENGTH,
  )}`;
}

function errorForProductionReport(
  event: NotificationFailureEvent,
  error: unknown,
): unknown {
  if (event !== 'notification_navigate_failed') return error;

  const safeError = new Error('Notification navigation failed');
  safeError.name = 'NotificationNavigationError';
  return safeError;
}

export function reportNotificationFailure(
  event: NotificationFailureEvent,
  error: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {},
) {
  logClientDiagnostic(event, context);
  if (isDev) {
    console.warn(`[notifications] ${event}`, error, context);
  }

  // API 失败归 client.ts 管——它已按 shouldReportHttpFailure 决定过报或不报。
  if (error instanceof ApiError) return;

  const seen = reportedFailureSignatures.get(event) ?? new Set<string>();
  if (seen.size >= MAX_SIGNATURES_PER_EVENT) return;

  const signature = failureSignature(event, error);
  if (seen.has(signature)) return;
  reportedFailureSignatures.set(event, new Set([...seen, signature]));

  // operation + kind 必须排在 context 之后：sentry.ts 靠这两个 tag 组稳定
  // fingerprint，被调用方 context 覆盖掉就会退回按 message 分组。
  reportError(errorForProductionReport(event, error), {
    ...context,
    operation: 'notifications',
    kind: event,
  });
}
