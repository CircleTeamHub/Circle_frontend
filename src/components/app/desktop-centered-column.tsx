import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDesktopSplitLayout } from '@/hooks/use-desktop-split-layout';
import { useTheme } from '@/theme';

/**
 * 桌面网页版：把手机布局的页面栈收进居中窄栏，两侧留页面底色 —— 手机版式
 * 直接撑满 1400px 宽既难看也难用（微信桌面版对非聊天页同款处理）。
 *
 * 仅在宽视口 web（useDesktopSplitLayout 命中）生效；窄窗与原生原样透传，
 * 不引入任何行为差异。栏内导航（Stack 的 push/modal）都被约束在同一栏里。
 */
const COLUMN_MAX_WIDTH = 640;

const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});

export function DesktopCenteredColumn({ children }: PropsWithChildren) {
  const isSplitLayout = useDesktopSplitLayout();
  const { colors } = useTheme();

  if (!isSplitLayout) {
    return <>{children}</>;
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.column, { borderColor: colors.divider }]}>{children}</View>
    </View>
  );
}
