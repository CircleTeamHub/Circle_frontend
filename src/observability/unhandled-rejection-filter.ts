/**
 * unhandled-rejection-filter.ts — 未处理 Promise rejection 的过滤与限流（零依赖）。
 *
 * 两条上报路径共用这一份状态：
 * - Hermes / web：真正生效的 tracker 是 Sentry SDK 自己的（Hermes 上挂在
 *   HermesInternal.enablePromiseRejectionTracker，web 上是全局 unhandledrejection
 *   事件）。事件带 mechanism.type === 'onunhandledrejection'，在 sentry.ts 的
 *   beforeSend 里过这道闸。
 * - JSC：silence-dom-bridge-rejection 启用的 promise 包 tracker 会顶掉 Sentry 的，
 *   由它自己调用这里再 reportError。
 *
 * 之前过滤和限流只写在 promise 包的 tracker 里，而 App 跑在 Hermes 上，那个 tracker
 * 从不触发 —— 每条未处理 rejection 都原样进了 Sentry，DOM 桥接的良性竞态也没被滤掉。
 */

/** Expo DOM 组件在导航卸载竞态时 reject 的 injectJavaScript：良性，不上报。 */
const SILENCED_FRAGMENTS = ['injectJavaScript', 'DomWebView'];

// 和 reportHandledFailure / RouteErrorBoundary 一样封顶：同一签名只上报一次，
// 不同签名总量也有上限。一个反复 reject 的第三方库或一段被刷的 socket 载荷，
// 否则会在一个进程生命周期里制造成百上千条 Sentry 事件，把真正的信号淹掉。
const MAX_REPORTED_REJECTION_SIGNATURES = 20;
const reportedRejectionSignatures = new Set<string>();

export function rejectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isBenignDomBridgeRejection(message: string): boolean {
  return SILENCED_FRAGMENTS.every((fragment) => message.includes(fragment));
}

function rejectionSignature(error: unknown, message: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  return `${name}:${message.slice(0, 120)}`;
}

/** 首次见到的签名放行（且总量未达上限）；其余静默。 */
export function shouldReportUnhandledRejection(
  error: unknown,
  message: string,
): boolean {
  const signature = rejectionSignature(error, message);
  if (reportedRejectionSignatures.has(signature)) return false;
  if (reportedRejectionSignatures.size >= MAX_REPORTED_REJECTION_SIGNATURES) {
    return false;
  }
  reportedRejectionSignatures.add(signature);
  return true;
}

/** 仅供测试重置去重状态。 */
export function resetUnhandledRejectionTelemetry(): void {
  reportedRejectionSignatures.clear();
}
