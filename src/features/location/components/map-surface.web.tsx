import { useEffect, useRef } from 'react';
import type { MapSurfaceProps } from './map-surface';

const FRAME_STYLE = {
  flex: 1,
  width: '100%',
  height: '100%',
  border: 0,
  display: 'block',
} as const;

/**
 * 地图载体的 web 实现：srcDoc iframe。
 *
 * 不能复用 react-native-webview —— 它在 web 上只有一个占位桩（红字
 * "does not support this platform"），props 全丢，onLoadEnd 永远不回调，
 * 结果是选点页的转圈永远退不掉。
 *
 * sandbox 只给 allow-scripts、不给 allow-same-origin：srcDoc 默认继承宿主
 * 页面的 origin，那样从 CDN 拉进来的 leaflet 就能读到 App 自己的
 * localStorage（里面有登录态）。牺牲的只是同源能力，地图和已显式配置的
 * 地理编码服务都不需要。
 *
 * 自动化测试的坑：opaque origin 会让这个 iframe 进独立进程(OOPIF)，CDP 的
 * Input.dispatchMouseEvent 打到顶层 target 上送不进去 —— 用 Playwright/CDP
 * 点地图会「没反应」。sandbox 本身不拦输入（规范里没有输入相关的 flag，真人
 * 鼠标正常），要在自动化里跑通只能临时加 allow-same-origin。
 */
export function MapSurface({
  html,
  reloadKey,
  title,
  onLoadEnd,
  onMessage,
}: MapSurfaceProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // sandbox 后 iframe 是 opaque origin（event.origin 恒为 'null'），
      // 认不了域名，只能比对 contentWindow —— 否则页面上任何窗口都能伪造选点结果。
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) {
        return;
      }
      if (typeof event.data !== 'string') return;
      onMessage(event.data);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onMessage]);

  return (
    <iframe
      key={reloadKey}
      ref={frameRef}
      title={title}
      srcDoc={html}
      onLoad={onLoadEnd}
      sandbox="allow-scripts"
      style={FRAME_STYLE}
    />
  );
}
