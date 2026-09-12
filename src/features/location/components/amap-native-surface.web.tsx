import type { AmapNativeSurfaceProps, AmapNativeSurfaceRef } from './amap-native-surface';

/**
 * 网页端没有原生地图。
 *
 * 这个桩存在的意义是让 Metro 在 web 打包时挑走它，从而完全不去 require 那个只有
 * 原生实现的包 —— 否则 web bundle 会在加载时就炸。选点页看到
 * `isAmapNativeSupported` 为 false，会自动走 Leaflet 那条路。
 */
export const isAmapNativeSupported = false;

export type { AmapNativeSurfaceProps, AmapNativeSurfaceRef };

export function AmapNativeSurface(_props: AmapNativeSurfaceProps) {
  return null;
}
