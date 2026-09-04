// React Native logs every unhandled Promise rejection via its own tracker,
// which bypasses `LogBox.ignoreLogs`. Expo DOM components occasionally reject
// `injectJavaScript` calls on a WebView that has just been torn down — a
// benign race during navigation. Re-enable the tracker with a filter that
// drops only this specific rejection and re-emits everything else.
import rejectionTracking from 'promise/setimmediate/rejection-tracking';
import { reportError } from '@/observability/sentry';
import { devWarn } from '@/utils/dev-log';

const SILENCED_FRAGMENTS = ['injectJavaScript', 'DomWebView'];

// 和 reportHandledFailure / RouteErrorBoundary 一样封顶:同一签名只上报一次,
// 不同签名总量也有上限。一个反复 reject 的第三方库或一段被刷的 socket 载荷,
// 否则会在一个进程生命周期里制造成百上千条 Sentry 事件,把真正的信号淹掉。
const MAX_REPORTED_REJECTION_SIGNATURES = 20;
const reportedRejectionSignatures = new Set<string>();

function rejectionSignature(error: unknown, message: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  return `${name}:${message.slice(0, 120)}`;
}

/** 首次见到的签名放行(且总量未达上限);其余静默。导出供测试与 dev 工具使用。 */
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

export function silenceDomBridgeRejection(): void {
  rejectionTracking.enable({
    allRejections: true,
    onUnhandled: (id: number, error: unknown) => {
      const message =
        error instanceof Error ? error.message : String(error ?? '');
      if (SILENCED_FRAGMENTS.every((fragment) => message.includes(fragment))) {
        return;
      }
      // Sentry 的 RN SDK 也是通过这同一个 tracker 捕获未处理 rejection 的；我们
      // enable 之后它的 onUnhandled 就被顶掉了 —— 不在这里转发的话，整个 app 的
      // 未处理 rejection 对 Sentry 都不可见。reportError 未初始化时是 no-op。
      if (shouldReportUnhandledRejection(error, message)) {
        reportError(error, {
          component: 'promiseRejectionTracker',
          operation: 'unhandledRejection',
          kind: 'promise',
        });
      }
      devWarn(`Possible unhandled promise rejection (id: ${id}): ${message}`);
    },
    onHandled: () => {
      // No-op: matches RN's default behaviour when a previously-unhandled
      // rejection later attaches a handler.
    },
  });
}
