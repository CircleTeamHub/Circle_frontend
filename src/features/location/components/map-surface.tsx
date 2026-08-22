import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export type MapSurfaceProps = {
  /** 完整的地图页 HTML（由 buildMapHtml 生成）。 */
  html: string;
  /** 变化即重挂载载体，用于"重试"。 */
  reloadKey: number;
  /** 无障碍标题，web 上的 <iframe> 必须有；原生忽略。 */
  title: string;
  onLoadEnd: () => void;
  /** 地图页 postMessage 过来的原始字符串，解析交给调用方。 */
  onMessage: (data: string) => void;
};

/**
 * 地图载体的原生实现：WebView。
 *
 * web 侧走 map-surface.web.tsx —— react-native-webview 在 web 上只导出一个
 * "does not support this platform" 的桩组件，连 onLoadEnd 都不会回调。
 */
export function MapSurface({
  html,
  reloadKey,
  onLoadEnd,
  onMessage,
}: MapSurfaceProps) {
  return (
    <WebView
      key={reloadKey}
      originWhitelist={['https://appassets.invalid/*']}
      source={{ html, baseUrl: 'https://appassets.invalid/' }}
      javaScriptEnabled
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) =>
        request.url === 'about:blank' ||
        request.url.startsWith('https://appassets.invalid/')
      }
      onLoadEnd={onLoadEnd}
      onMessage={(event) => onMessage(event.nativeEvent.data)}
      style={s.webView}
    />
  );
}

const s = StyleSheet.create({
  webView: { flex: 1 },
});
