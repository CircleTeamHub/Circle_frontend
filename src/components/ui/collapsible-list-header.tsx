import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { CollapsibleHeaderController } from '@/hooks/use-collapsible-header';

type Props = {
  controller: CollapsibleHeaderController;
  /** 最上面一行（返回 / 标题 / 操作按钮）：压在其余部分上面，收起时退得慢、最后缩进安全区顶边下。 */
  top: ReactNode;
  /** 跟着收起的部分：收起时以列表的速度从 top 底下滑上去。 */
  children?: ReactNode;
  /** 收起后仍留在屏幕上的部分（筛选栏等），最终贴住安全区顶边。 */
  pinned?: ReactNode;
  /** 套在每一段上的样式：三段各自平移，背景色和水平内边距要每段自己铺。 */
  sectionStyle?: StyleProp<ViewStyle>;
};

/**
 * 盖在列表上方的可收起头部。往下读时把 top + children 收走、pinned 顶上去；往回翻立刻放出来。
 *
 * 用法：父容器从安全区顶边开始、flex:1 且 overflow:'hidden'（收起的部分要被裁在安全区之下），
 * 里面先放本组件、再放 Animated.FlatList（onScroll 用 controller.onScroll，顶部留白和
 * progressViewOffset 用 controller.headerHeight）。本组件靠 zIndex 叠在列表上面，写在前面是为了
 * 读屏先读到头部、再读列表。
 *
 * 列表在顶部附近时头部跟着内容走，不会在头部和第一行之间露出空白；离开顶部后按方向整段收起 / 展开。
 */
export function CollapsibleListHeader({ controller, top, children, pinned, sectionStyle }: Props) {
  const { scrollY, progress, setHeaderMetrics, subscribeCollapsed, getCollapsed } = controller;
  // 收起后被裁掉的部分不能还让读屏聚焦、念出来、点到。
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsed);
  const topSection = useMeasuredHeight();
  const bodySection = useMeasuredHeight();
  const pinnedSection = useMeasuredHeight();

  const topHeight = topSection.height;
  const bodyHeight = bodySection.height;
  const headerHeight = topHeight + bodyHeight + pinnedSection.height;
  useLayoutEffect(() => {
    setHeaderMetrics(headerHeight, topHeight + bodyHeight);
  }, [bodyHeight, headerHeight, setHeaderMetrics, topHeight]);
  const { topTranslate, restTranslate } = useMemo(
    () => collapseTranslations(scrollY, progress, topHeight, bodyHeight),
    [bodyHeight, progress, scrollY, topHeight],
  );

  return (
    <View pointerEvents="box-none" style={s.overlay}>
      <Animated.View style={[s.top, { transform: [{ translateY: topTranslate }] }]}>
        <View ref={topSection.ref} onLayout={topSection.onLayout} style={sectionStyle} aria-hidden={collapsed}>
          {top}
        </View>
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={{ transform: [{ translateY: restTranslate }] }}>
        {children ? (
          <View ref={bodySection.ref} onLayout={bodySection.onLayout} style={sectionStyle} aria-hidden={collapsed}>
            {children}
          </View>
        ) : null}
        {pinned ? (
          <View ref={pinnedSection.ref} onLayout={pinnedSection.onLayout} style={sectionStyle}>
            {pinned}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * 收起量 hidden = min(已滚距离, 进度 × 收起高度)，收起高度 = top + children。
 * 其余部分（children + pinned）整段上移 hidden；标题行按自身高度占比同步走完——
 * 录屏里它比下面几行退得慢，下面几行从它底下穿过去。
 */
export function collapseTranslations(
  scrollY: Animated.Value,
  progress: Animated.Value,
  topHeight: number,
  bodyHeight: number,
) {
  // 量到之前给 1：插值区间不能是 [0, 0]。
  const collapseHeight = Math.max(1, topHeight + bodyHeight);
  const scrolled = scrollY.interpolate({
    inputRange: [0, collapseHeight],
    outputRange: [0, collapseHeight],
    extrapolate: 'clamp',
  });
  const target = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, collapseHeight],
  });
  // 原生驱动没有 min：min(a, b) = b − max(0, b − a)。
  const excess = Animated.subtract(target, scrolled).interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolateLeft: 'clamp',
  });
  const hidden = Animated.subtract(target, excess);
  return {
    topTranslate: hidden.interpolate({
      inputRange: [0, collapseHeight],
      outputRange: [0, -topHeight],
    }),
    restTranslate: Animated.multiply(hidden, -1),
  };
}

/**
 * 段高度：首帧在 layout effect 里同步量（新架构下 measure 同步回调），列表第一帧就按真实高度留白、
 * 不会先挤在头部底下再跳下来；之后的变化（横幅出现、文字换行）走 onLayout。
 */
function useMeasuredHeight() {
  const ref = useRef<View>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    ref.current?.measure((_x, _y, _width, measured) => setHeight(measured));
  }, []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  }, []);
  return { ref, height, onLayout };
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  top: { zIndex: 1 },
});
