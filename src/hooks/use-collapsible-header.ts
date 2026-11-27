import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

/**
 * 收起 / 展开的时长与曲线：照参考录屏逐帧量出来的——两种页面都是约 13 帧（60fps）走完、
 * 每帧位移恒定，即线性约 220ms，不带缓入缓出。
 */
export const COLLAPSIBLE_HEADER_DURATION_MS = 220;

/** 同一方向累计滚过这么多点才切换，滤掉手指按住时的细小抖动。 */
export const COLLAPSIBLE_HEADER_THRESHOLD = 8;

export type ScrollTracker = {
  /** 上一次的滚动位置（已夹在 [0, 可滚动最大值] 内）。 */
  lastY: number;
  /** 当前方向上累计滚过的距离：正数往下读（内容上移），负数往回翻。 */
  travel: number;
};

export type ScrollMetrics = {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
};

export const INITIAL_SCROLL_TRACKER: ScrollTracker = { lastY: 0, travel: 0 };

/**
 * 根据一次滚动事件算出下一步：collapse 为 true 收起、false 展开、null 不变。
 *
 * 位置先夹到 [0, 可滚动最大值]：iOS 顶部下拉刷新和底部回弹会产生反向位移，
 * 不夹的话滚到底一回弹头部就会被误弹出来。内容不满一屏时最大值是 0，永远不收起。
 */
export function trackScroll(
  tracker: ScrollTracker,
  { offsetY, contentHeight, viewportHeight }: ScrollMetrics,
): ScrollTracker & { collapse: boolean | null } {
  const maxY = Math.max(0, contentHeight - viewportHeight);
  const y = Math.min(Math.max(offsetY, 0), maxY);
  const delta = y - tracker.lastY;
  if (delta === 0) return { ...tracker, lastY: y, collapse: null };
  const sameDirection = Math.sign(delta) === Math.sign(tracker.travel);
  const travel = sameDirection ? tracker.travel + delta : delta;
  const collapse = Math.abs(travel) >= COLLAPSIBLE_HEADER_THRESHOLD ? travel > 0 : null;
  return { lastY: y, travel, collapse };
}

type ScrollableList = {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
};

export type CollapsibleHeaderController = {
  /** 列表滚动位置，由原生驱动的 onScroll 写入。 */
  scrollY: Animated.Value;
  /** 0 = 展开，1 = 收起。 */
  progress: Animated.Value;
  /** 头部整体高度：列表要用它做顶部留白、下拉刷新圈的偏移。 */
  headerHeight: number;
  /** CollapsibleListHeader 上报：头部总高、收起时移走的那段高度。 */
  setHeaderMetrics: (height: number, collapseHeight: number) => void;
  /** 交给 Animated.FlatList 的 onScroll。 */
  onScroll: ReturnType<typeof Animated.event>;
  /**
   * 程序里把列表滚回开头（例如换排序）：头部展开着就回到最顶；收着就停在第一行贴住吸顶栏的位置，
   * 头部保持收起——这一下不算用户往回翻。
   */
  scrollToStart: (list: ScrollableList | null) => void;
  /** 收起状态（给读屏隐藏收起的部分用），配 useSyncExternalStore。 */
  subscribeCollapsed: (listener: () => void) => () => void;
  getCollapsed: () => boolean;
};

/**
 * 列表往下读时收起顶部、往回翻立刻放出来（配合 CollapsibleListHeader 使用）。
 *
 * enabled=false（例如多选模式）时立即展开并忽略滚动。
 */
export function useCollapsibleHeader(enabled = true): CollapsibleHeaderController {
  const scrollY = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(0);
  const collapseHeightRef = useRef(0);
  const collapsedRef = useRef(false);
  const collapsedListenersRef = useRef(new Set<() => void>());
  const trackerRef = useRef(INITIAL_SCROLL_TRACKER);

  const setHeaderMetrics = useCallback((height: number, collapseHeight: number) => {
    collapseHeightRef.current = collapseHeight;
    setHeaderHeight(height);
  }, []);

  const scrollToStart = useCallback((list: ScrollableList | null) => {
    const offset = collapsedRef.current ? collapseHeightRef.current : 0;
    // 先把起点记成目标位置：随后那次滚动事件位移为 0，不会被当成往回翻而展开头部。
    trackerRef.current = { lastY: offset, travel: 0 };
    list?.scrollToOffset({ offset, animated: false });
  }, []);

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      if (collapsedRef.current === collapsed) return;
      collapsedRef.current = collapsed;
      collapsedListenersRef.current.forEach((listener) => listener());
      Animated.timing(progress, {
        toValue: collapsed ? 1 : 0,
        duration: COLLAPSIBLE_HEADER_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    },
    [progress],
  );

  useEffect(() => {
    if (!enabled) setCollapsed(false);
  }, [enabled, setCollapsed]);

  const subscribeCollapsed = useCallback((listener: () => void) => {
    const listeners = collapsedListenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const getCollapsed = useCallback(() => collapsedRef.current, []);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const next = trackScroll(trackerRef.current, {
            offsetY: contentOffset.y,
            contentHeight: contentSize.height,
            viewportHeight: layoutMeasurement.height,
          });
          trackerRef.current = { lastY: next.lastY, travel: next.travel };
          if (enabled && next.collapse !== null) setCollapsed(next.collapse);
        },
      }),
    [enabled, scrollY, setCollapsed],
  );

  return {
    scrollY,
    progress,
    headerHeight,
    setHeaderMetrics,
    onScroll,
    scrollToStart,
    subscribeCollapsed,
    getCollapsed,
  };
}
