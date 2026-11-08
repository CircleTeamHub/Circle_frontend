import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { MediaImage } from '@/components/ui/media-image';

/**
 * 可缩放的单张图片（大图查看器的每一页）。
 *
 * 手势全部自绘在 RN 内置的 PanResponder 上，不引入 gesture-handler ——
 * 只为看图缩放加一个原生模块（意味着每次都要 prebuild + 重装）不划算，
 * 而 PanResponder 能拿到多点触控数组，捏合所需的信息一样不缺。
 *
 * - 双指捏合缩放（1x–4x），双击在 1x / 2.5x 之间切换
 * - 放大后单指拖拽平移，平移量按缩放比夹在图内
 * - 1x 时下拉跟手，达到距离或速度阈值后关闭查看器
 * - 未放大时**不拦截**横向手势，交还给外层列表翻页（关键：
 *   onPanResponderTerminationRequest 在未下拉的 1x 状态放行）
 * - 长按触发菜单（保存图片）；web 上鼠标按住同样触发
 * - Web 额外支持滚轮 / 触控板捏合缩放
 */
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_WINDOW_MS = 280;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 8;
/** 下滑关闭的手感阈值；视频页共用，保证和图片页一致。 */
export const SWIPE_CLAIM_DISTANCE = MOVE_TOLERANCE * 2;
export const SWIPE_DISMISS_DISTANCE = 96;
export const SWIPE_DISMISS_VELOCITY = 1.1;

interface ZoomableImageProps {
  uri: string;
  /** 图片缓存键;签名地址会轮换的远端图片传稳定的存储 key。 */
  cacheKey?: string;
  /** Ephemeral media can opt out of the shared disk/memory cache. */
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  width: number;
  height: number;
  /** 离开当前页时复位缩放（查看器翻页用）。 */
  active: boolean;
  /** 放大、双指操作或下滑关闭时，外层须暂停翻页。 */
  onZoomedChange?: (zoomed: boolean) => void;
  onTap?: () => void;
  onLongPress?: () => void;
  /** 1x 时向下拖拽达到阈值后的关闭回调。 */
  onSwipeDown?: () => void;
}

function distance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function ZoomableImage({
  uri,
  cacheKey,
  cachePolicy = 'memory-disk',
  width,
  height,
  active,
  onZoomedChange,
  onTap,
  onLongPress,
  onSwipeDown,
}: ZoomableImageProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // 渲染值的影子副本：手势回调里要同步读写，Animated.Value 读不到当前数。
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const gesture = useRef({
    pinchStartDistance: 0,
    pinchStartScale: 1,
    panStartTx: 0,
    panStartTy: 0,
    panStartX: 0,
    panStartY: 0,
    pinchStartX: 0,
    pinchStartY: 0,
    pinchStartTx: 0,
    pinchStartTy: 0,
    moved: false,
    swipingDown: false,
    /** 本次手势出现过双指：松手时即使回到 1x 也不能当成下滑关闭。 */
    multiTouch: false,
    longPressFired: false,
    lastTapAt: 0,
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<View>(null);
  const pagerLocked = useRef(false);
  // 查看器锁定翻页时会重渲染；保持 responder 不变，避免清掉正在累计的 dx/dy。
  const onZoomedChangeRef = useRef(onZoomedChange);
  onZoomedChangeRef.current = onZoomedChange;
  /** 图片固有尺寸（onLoad 后才知道），用来推算 contain 后的渲染框。 */
  const natural = useRef<{ w: number; h: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const clearTapTimer = useCallback(() => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  }, []);

  const updatePagerLock = useCallback((locked: boolean) => {
    if (pagerLocked.current === locked) return;
    pagerLocked.current = locked;
    onZoomedChangeRef.current?.(locked);
  }, []);

  const apply = useCallback(() => {
    scale.setValue(view.current.scale);
    translateX.setValue(view.current.tx);
    translateY.setValue(view.current.ty);
  }, [scale, translateX, translateY]);

  const clampTranslate = useCallback((value: number, extent: number, container: number) => {
    const limit = Math.max(0, (view.current.scale * extent - container) / 2);
    return Math.max(-limit, Math.min(limit, value));
  }, []);

  /**
   * contain 之后照片真正占据的区域。平移边界必须按它算，不能按容器算：
   * 竖图放进横屏容器时两侧本来就是空白，拿容器宽当基准得出的 limit
   * 允许把照片一路拖到几乎完全离屏，屏幕上只剩黑边。
   *
   * onLoad 之前不知道固有尺寸，退回容器尺寸（等于旧行为）。
   */
  const renderedExtent = useCallback(() => {
    const n = natural.current;
    if (!n || n.w <= 0 || n.h <= 0) return { w: width, h: height };
    const ratio = Math.min(width / n.w, height / n.h);
    return { w: n.w * ratio, h: n.h * ratio };
  }, [width, height]);

  const setScale = useCallback(
    (next: number, animated = false) => {
      const clamped = Math.max(1, Math.min(MAX_SCALE, next));
      view.current.scale = clamped;
      if (clamped <= 1.01) {
        view.current.tx = 0;
        view.current.ty = 0;
      } else {
        const extent = renderedExtent();
        view.current.tx = clampTranslate(view.current.tx, extent.w, width);
        view.current.ty = clampTranslate(view.current.ty, extent.h, height);
      }

      if (animated) {
        Animated.parallel([
          Animated.timing(scale, {
            toValue: view.current.scale,
            duration: 180,
            useNativeDriver: false,
          }),
          Animated.timing(translateX, {
            toValue: view.current.tx,
            duration: 180,
            useNativeDriver: false,
          }),
          Animated.timing(translateY, {
            toValue: view.current.ty,
            duration: 180,
            useNativeDriver: false,
          }),
        ]).start();
      } else {
        apply();
      }

      updatePagerLock(clamped > 1.01 || gesture.current.pinchStartDistance > 0 || gesture.current.swipingDown);
    },
    [
      apply,
      clampTranslate,
      updatePagerLock,
      width,
      height,
      renderedExtent,
      scale,
      translateX,
      translateY,
    ],
  );

  // 翻到别的图时复位，回来是干净的 1x。
  useEffect(() => {
    if (!active) {
      clearLongPress();
      clearTapTimer();
      gesture.current.pinchStartDistance = 0;
      gesture.current.swipingDown = false;
      gesture.current.lastTapAt = 0;
      setScale(1);
    }
  }, [active, clearLongPress, clearTapTimer, setScale]);

  useEffect(
    () => () => {
      clearLongPress();
      clearTapTimer();
    },
    [clearLongPress, clearTapTimer],
  );

  const handleTap = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      if (now - gesture.current.lastTapAt < DOUBLE_TAP_WINDOW_MS) {
        clearTapTimer();
        gesture.current.lastTapAt = 0;
        if (view.current.scale > 1.01) {
          setScale(1, true);
          return;
        }
        // 以双击点为焦点放大：把该点推向画面中心。
        const { locationX, locationY } = event.nativeEvent;
        const factor = DOUBLE_TAP_SCALE - 1;
        view.current.tx = (width / 2 - locationX) * factor;
        view.current.ty = (height / 2 - locationY) * factor;
        setScale(DOUBLE_TAP_SCALE, true);
        return;
      }
      gesture.current.lastTapAt = now;
      // 等一个双击窗口再判定为单击，否则双击的第一下会把查看器关掉。
      clearTapTimer();
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        if (gesture.current.lastTapAt === now) onTap?.();
      }, DOUBLE_TAP_WINDOW_MS);
    },
    [clearTapTimer, height, onTap, setScale, width],
  );

  const beginPinch = useCallback((event: GestureResponderEvent) => {
    const touches = event.nativeEvent.touches;
    if (touches.length < 2 || gesture.current.pinchStartDistance > 0) return;
    clearLongPress();
    clearTapTimer();
    gesture.current.moved = true;
    gesture.current.multiTouch = true;
    gesture.current.swipingDown = false;
    gesture.current.lastTapAt = 0;
    gesture.current.pinchStartDistance = Math.max(1, distance(touches));
    gesture.current.pinchStartScale = view.current.scale;
    gesture.current.pinchStartTx = view.current.tx;
    gesture.current.pinchStartTy = view.current.ty;
    // Children do not receive touches, so these coordinates stay local to the
    // untransformed root, including after a prefetched page scrolls into view.
    gesture.current.pinchStartX = (touches[0].locationX + touches[1].locationX) / 2;
    gesture.current.pinchStartY = (touches[0].locationY + touches[1].locationY) / 2;
    updatePagerLock(true);
  }, [clearLongPress, clearTapTimer, updatePagerLock]);

  const finishPinch = useCallback(() => {
    clearLongPress();
    gesture.current.pinchStartDistance = 0;
    updatePagerLock(view.current.scale > 1.01 || gesture.current.swipingDown);
  }, [clearLongPress, updatePagerLock]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2 || view.current.scale > 1.01,
        onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2 || view.current.scale > 1.01,
        onMoveShouldSetPanResponder: (event, gestureState) => {
          if (event.nativeEvent.touches.length >= 2) return true;
          if (view.current.scale > 1.01) return true;
          // 未放大：横向手势留给外层列表翻页。
          return Math.abs(gestureState.dy) > SWIPE_CLAIM_DISTANCE;
        },
        // 横滑交给列表；下滑、捏合和平移期间保住手势，直到松手或取消。
        onPanResponderTerminationRequest: () => !pagerLocked.current,
        onShouldBlockNativeResponder: () => pagerLocked.current,
        onPanResponderGrant: (event) => {
          gesture.current.moved = false;
          gesture.current.multiTouch = false;
          gesture.current.swipingDown = false;
          gesture.current.longPressFired = false;
          gesture.current.panStartTx = view.current.tx;
          gesture.current.panStartTy = view.current.ty;
          gesture.current.panStartX = event.nativeEvent.touches[0].pageX;
          gesture.current.panStartY = event.nativeEvent.touches[0].pageY;
          gesture.current.pinchStartDistance = 0;
          scale.stopAnimation();
          translateX.stopAnimation();
          translateY.stopAnimation();
          if (view.current.scale <= 1.01) translateY.setValue(0);
          clearLongPress();
          clearTapTimer();
          beginPinch(event);
          if (gesture.current.pinchStartDistance > 0) return;
          longPressTimer.current = setTimeout(() => {
            if (!gesture.current.moved) {
              gesture.current.longPressFired = true;
              onLongPress?.();
            }
          }, LONG_PRESS_MS);
        },
        onPanResponderStart: beginPinch,
        onPanResponderEnd: (event) => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) return;
          finishPinch();
          if (touches.length === 1) {
            gesture.current.panStartTx = view.current.tx;
            gesture.current.panStartTy = view.current.ty;
            gesture.current.panStartX = touches[0].pageX;
            gesture.current.panStartY = touches[0].pageY;
          }
        },
        onPanResponderMove: (event, gestureState) => {
          const touches = event.nativeEvent.touches;
          if (
            Math.abs(gestureState.dx) > MOVE_TOLERANCE ||
            Math.abs(gestureState.dy) > MOVE_TOLERANCE
          ) {
            gesture.current.moved = true;
            clearLongPress();
            clearTapTimer();
            gesture.current.lastTapAt = 0;
          }

          if (touches.length >= 2) {
            beginPinch(event);
            const nextScale = Math.max(1, Math.min(MAX_SCALE,
              gesture.current.pinchStartScale * distance(touches) / gesture.current.pinchStartDistance));
            const ratio = nextScale / gesture.current.pinchStartScale;
            const centerX = (touches[0].locationX + touches[1].locationX) / 2;
            const centerY = (touches[0].locationY + touches[1].locationY) / 2;
            view.current.tx = centerX - width / 2 - ratio *
              (gesture.current.pinchStartX - width / 2 - gesture.current.pinchStartTx);
            view.current.ty = centerY - height / 2 - ratio *
              (gesture.current.pinchStartY - height / 2 - gesture.current.pinchStartTy);
            setScale(nextScale);
            return;
          }

          // 1x 时竖直向下拖动用于关闭查看器；横向拖动仍交给外层分页列表。
          // 双指过的手势不跟手，避免捏合回到 1x 时画面被带着往下走。
          if (view.current.scale <= 1.01) {
            if (gesture.current.multiTouch) return;
            if (
              !gesture.current.swipingDown &&
              gestureState.dy > SWIPE_CLAIM_DISTANCE &&
              gestureState.dy > Math.abs(gestureState.dx) * 1.5
            ) {
              gesture.current.swipingDown = true;
              updatePagerLock(true);
            }
            if (gesture.current.swipingDown) {
              translateY.setValue(Math.max(0, gestureState.dy));
            }
            return;
          }

          const extent = renderedExtent();
          view.current.tx = clampTranslate(
            gesture.current.panStartTx + touches[0].pageX - gesture.current.panStartX,
            extent.w,
            width,
          );
          view.current.ty = clampTranslate(
            gesture.current.panStartTy + touches[0].pageY - gesture.current.panStartY,
            extent.h,
            height,
          );
          apply();
        },
        onPanResponderRelease: (event, gestureState) => {
          const wasSwipingDown = gesture.current.swipingDown;
          gesture.current.swipingDown = false;
          finishPinch();

          // 只有越过移动阈值的单指下拉才算关闭手势；几像素的手指抖动仍是点击，
          // 位移归零后落到下面的点击判定。
          const isSwipeDown =
            view.current.scale <= 1.01 &&
            gesture.current.moved &&
            !gesture.current.multiTouch &&
            wasSwipingDown &&
            gestureState.dy > 0;
          if (!isSwipeDown && view.current.scale <= 1.01) {
            translateY.setValue(0);
          }
          if (isSwipeDown) {
            const shouldDismiss =
              gestureState.dy >= SWIPE_DISMISS_DISTANCE ||
              gestureState.vy >= SWIPE_DISMISS_VELOCITY;
            if (shouldDismiss) {
              onSwipeDown?.();
            } else {
              Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: false,
              }).start();
            }
            return;
          }

          if (!gesture.current.moved && !gesture.current.longPressFired) {
            handleTap(event);
          }
        },
        onPanResponderTerminate: () => {
          gesture.current.swipingDown = false;
          finishPinch();
          clearTapTimer();
          gesture.current.lastTapAt = 0;
          if (view.current.scale <= 1.01) {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: false,
            }).start();
          }
        },
      }),
    [
      apply,
      beginPinch,
      clampTranslate,
      clearLongPress,
      clearTapTimer,
      finishPinch,
      handleTap,
      onLongPress,
      renderedExtent,
      setScale,
      scale,
      translateX,
      translateY,
      width,
      height,
      onSwipeDown,
      updatePagerLock,
    ],
  );

  // Web：滚轮 / 触控板捏合缩放（原生走上面的 PanResponder 双指）。
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      clearTapTimer();
      gesture.current.lastTapAt = 0;
      setScale(view.current.scale * Math.exp(-event.deltaY / 300));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [active, clearTapTimer, setScale]);

  return (
    <View
      ref={containerRef}
      style={[{ width, height }, s.container]}
      {...panResponder.panHandlers}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          s.fill,
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
      >
        <MediaImage
          source={cacheKey ? { uri, cacheKey } : { uri }}
          cachePolicy={cachePolicy}
          style={s.fill}
          contentFit="contain"
          enforceEarlyResizing
          onLoad={(event) => {
            // 固有尺寸决定 contain 后的渲染框，平移边界据此收紧。
            const { width: w, height: h } = event.source ?? {};
            if (w && h) {
              natural.current = { w, h };
              setScale(view.current.scale);
            }
          }}
        />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    overflow: 'hidden',
    // web：按住拖动时别触发浏览器自带的图片拖拽/选中。
    ...Platform.select({ web: { userSelect: 'none' } as object, default: {} }),
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
