import type { ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Radius, Spacing } from '@/theme';

/**
 * 顶部横幅（收到消息的 NotificationSnackbarHost、操作回执的 TopNoticeHost）共用的
 * 外壳：同一块玻璃、同一套圆角 / 内边距 / 字号，两种横幅在同一位置出现时是一家人。
 *
 * host（贴顶、居中）→ frame（限宽，动画层铺这一层）→ TopBannerCard（玻璃卡片）。
 * 动画层只做位移：卡片里是磨砂材质，祖先 opacity < 1 会让材质失效。
 */
export const topBannerSurface = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    width: '100%',
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // iOS 的玻璃靠描边定轮廓，不投影；无磨砂的平台补一层投影把卡片托起来。
    ...Platform.select({
      ios: null,
      default: {
        shadowColor: '#000000',
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      },
    }),
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  summary: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
});

/** 横幅从屏幕外滑进来的起点：盖过刘海区 + 卡片高度，保证完全在屏外。 */
export function topBannerHiddenOffset(topInset: number): number {
  return -(topInset + 96);
}

export function TopBannerCard({ children }: { children: ReactNode }) {
  return (
    <GlassSurface material="banner" radius={Radius.xl} style={topBannerSurface.card}>
      {children}
    </GlassSurface>
  );
}
