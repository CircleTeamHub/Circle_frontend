// The `promise` package's rejection tracker. It only takes effect on JSC: RN on
// Hermes uses Hermes' built-in Promise, whose tracker Sentry hooks directly via
// HermesInternal.enablePromiseRejectionTracker, so this one never fires there.
// On JSC it replaces Sentry's handler, so it filters the benign Expo DOM
// `injectJavaScript` teardown race and forwards everything else itself.
// The filter and the per-signature budget live in
// observability/unhandled-rejection-filter, shared with Sentry's beforeSend
// (the path that is actually live on Hermes and web).
import rejectionTracking from 'promise/setimmediate/rejection-tracking';
import { reportError } from '@/observability/sentry';
import {
  isBenignDomBridgeRejection,
  rejectionMessage,
  resetUnhandledRejectionTelemetry,
  shouldReportUnhandledRejection,
} from '@/observability/unhandled-rejection-filter';
import { devWarn } from '@/utils/dev-log';

export { resetUnhandledRejectionTelemetry, shouldReportUnhandledRejection };

export function silenceDomBridgeRejection(): void {
  rejectionTracking.enable({
    allRejections: true,
    onUnhandled: (id: number, error: unknown) => {
      const message = rejectionMessage(error);
      if (isBenignDomBridgeRejection(message)) {
        return;
      }
      // JSC 上 Sentry 的 RN SDK 也是通过这同一个 tracker 捕获未处理 rejection 的；
      // 我们 enable 之后它的 onUnhandled 就被顶掉了 —— 不在这里转发的话，未处理
      // rejection 对 Sentry 都不可见。reportError 未初始化时是 no-op。
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
