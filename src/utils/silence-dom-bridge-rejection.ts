// React Native logs every unhandled Promise rejection via its own tracker,
// which bypasses `LogBox.ignoreLogs`. Expo DOM components occasionally reject
// `injectJavaScript` calls on a WebView that has just been torn down — a
// benign race during navigation. Re-enable the tracker with a filter that
// drops only this specific rejection and re-emits everything else.
import rejectionTracking from 'promise/setimmediate/rejection-tracking';
import { reportError } from '@/observability/sentry';
import { devWarn } from '@/utils/dev-log';

const SILENCED_FRAGMENTS = ['injectJavaScript', 'DomWebView'];

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
      reportError(error, {
        component: 'promiseRejectionTracker',
        operation: 'unhandledRejection',
        kind: 'promise',
      });
      devWarn(`Possible unhandled promise rejection (id: ${id}): ${message}`);
    },
    onHandled: () => {
      // No-op: matches RN's default behaviour when a previously-unhandled
      // rejection later attaches a handler.
    },
  });
}
