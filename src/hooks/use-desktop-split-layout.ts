import { Platform, useWindowDimensions } from 'react-native';

/**
 * 桌面网页版分栏布局的启用判据：Web 平台 + 视口宽度达到阈值。
 *
 * 阈值取 900：左栏固定 336 后右栏仍有 ≥564 的聊天区（接近手机宽度），
 * 窄于此宽度的浏览器窗口回落到与手机一致的单栏页栈导航。
 * 原生端恒为 false —— 手机/平板布局完全不受影响。
 */
export const DESKTOP_SPLIT_MIN_WIDTH = 900;

/** 分栏左栏（会话列表）的固定宽度；浮动 tab 条在分栏时也钉进这个宽度。 */
export const SPLIT_LIST_PANE_WIDTH = 336;

export function useDesktopSplitLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_SPLIT_MIN_WIDTH;
}
