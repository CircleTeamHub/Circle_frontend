import { Platform, useWindowDimensions } from 'react-native';

/**
 * 桌面网页版分栏布局的启用判据：Web 平台 + 视口宽度达到阈值。
 *
 * 阈值取 900：左栏固定 336 后右栏仍有 ≥564 的聊天区（接近手机宽度），
 * 窄于此宽度的浏览器窗口回落到与手机一致的单栏页栈导航。
 * 原生端恒为 false —— 手机/平板布局完全不受影响。
 */
export const DESKTOP_SPLIT_MIN_WIDTH = 900;

/** 分栏左栏（会话列表）的默认宽度；浮动 tab 条在分栏时也钉进这个宽度。 */
export const SPLIT_LIST_PANE_WIDTH = 336;

// 可拖拽范围：太窄会话行放不下头像+双行文字，太宽右栏聊天区会被挤扁。
export const SPLIT_LIST_PANE_MIN_WIDTH = 280;
export const SPLIT_LIST_PANE_MAX_WIDTH = 520;

/** 分割线拖拽热区宽度（视觉是 1px 描边，热区放宽才好抓）。 */
export const SPLIT_RESIZER_HIT_WIDTH = 10;

export function useDesktopSplitLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_SPLIT_MIN_WIDTH;
}
