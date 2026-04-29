// React Native logs every unhandled Promise rejection via its own tracker,
// which bypasses `LogBox.ignoreLogs`. Expo DOM components occasionally reject
// `injectJavaScript` calls on a WebView that has just been torn down — a
// benign race during navigation. Re-enable the tracker with a filter that
// drops only this specific rejection and re-emits everything else.
import rejectionTracking from 'promise/setimmediate/rejection-tracking';

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
      console.warn(
        `Possible unhandled promise rejection (id: ${id}): ${message}`,
      );
    },
    onHandled: () => {
      // No-op: matches RN's default behaviour when a previously-unhandled
      // rejection later attaches a handler.
    },
  });
}
