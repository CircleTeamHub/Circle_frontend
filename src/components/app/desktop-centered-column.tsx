import { createContext, useContext, type PropsWithChildren } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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

/**
 * 栏内可用宽度。包在居中窄栏里时是栏宽，否则是视口宽。
 *
 * 按屏宽算尺寸的组件（九宫格、相册行）在桌面网页版会算错得离谱：
 * useWindowDimensions 报的是 1440 的浏览器视口，而它们实际待在 640 的栏里，
 * 单图能算到 ~890、相册网格 ~1300 —— 直接溢出栏外压到旁边的留白上。
 */
const ContentColumnWidthContext = createContext<number | null>(null);

export function useContentColumnWidth(): number {
  const column = useContext(ContentColumnWidthContext);
  const { width } = useWindowDimensions();
  return column ?? width;
}

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
    <ContentColumnWidthContext.Provider value={COLUMN_MAX_WIDTH}>
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View style={[s.column, { borderColor: colors.divider }]}>
          {children}
        </View>
      </View>
    </ContentColumnWidthContext.Provider>
  );
}
