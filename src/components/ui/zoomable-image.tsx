import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';

/**
 * 可缩放的单张图片（大图查看器的每一页）。
 *
 * 手势全部自绘在 RN 内置的 PanResponder 上，不引入 gesture-handler ——
 * 只为看图缩放加一个原生模块（意味着每次都要 prebuild + 重装）不划算，
 * 而 PanResponder 能拿到多点触控数组，捏合所需的信息一样不缺。
 *
 * - 双指捏合缩放（1x–4x），双击在 1x / 2.5x 之间切换
 * - 放大后单指拖拽平移，平移量按缩放比夹在图内
 * - 未放大时**不拦截**横向手势，交还给外层列表翻页（关键：
 *   onPanResponderTerminationRequest 在 1x 时放行，列表才抢得走）
 * - 长按触发菜单（保存图片）；web 上鼠标按住同样触发
 * - Web 额外支持滚轮 / 触控板捏合缩放
 */
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_WINDOW_MS = 280;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 8;

interface ZoomableImageProps {
  uri: string;
  width: number;
  height: number;
  /** 离开当前页时复位缩放（查看器翻页用）。 */
  active: boolean;
  /** 缩放态变化：外层据此开关列表滚动。 */
  onZoomedChange?: (zoomed: boolean) => void;
  onTap?: () => void;
  onLongPress?: () => void;
}

function distance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function ZoomableImage({
  uri,
  width,
  height,
  active,
  onZoomedChange,
  onTap,
  onLongPress,
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
    moved: false,
    longPressFired: false,
    lastTapAt: 0,
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<View>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const apply = useCallback(() => {
    scale.setValue(view.current.scale);
    translateX.setValue(view.current.tx);
    translateY.setValue(view.current.ty);
  }, [scale, translateX, translateY]);

  const clampTranslate = useCallback((value: number, extent: number) => {
    const limit = Math.max(0, ((view.current.scale - 1) * extent) / 2);
    return Math.max(-limit, Math.min(limit, value));
  }, []);

  const setScale = useCallback(
    (next: number, animated = false) => {
      const wasZoomed = view.current.scale > 1.01;
      const clamped = Math.max(1, Math.min(MAX_SCALE, next));
      view.current.scale = clamped;
      if (clamped <= 1.01) {
        view.current.tx = 0;
        view.current.ty = 0;
      } else {
        view.current.tx = clampTranslate(view.current.tx, width);
        view.current.ty = clampTranslate(view.current.ty, height);
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

      const zoomed = clamped > 1.01;
      if (zoomed !== wasZoomed) onZoomedChange?.(zoomed);
    },
    [
      apply,
      clampTranslate,
      height,
      onZoomedChange,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  // 翻到别的图时复位，回来是干净的 1x。
  useEffect(() => {
    if (!active && view.current.scale !== 1) setScale(1);
  }, [active, setScale]);

  useEffect(() => clearLongPress, [clearLongPress]);

  const handleTap = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      if (now - gesture.current.lastTapAt < DOUBLE_TAP_WINDOW_MS) {
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
      setTimeout(() => {
        if (gesture.current.lastTapAt === now) onTap?.();
      }, DOUBLE_TAP_WINDOW_MS);
    },
    [height, onTap, setScale, width],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (event, gestureState) => {
          if (event.nativeEvent.touches.length === 2) return true;
          if (view.current.scale > 1.01) return true;
          // 未放大：横向手势留给外层列表翻页。
          return Math.abs(gestureState.dy) > MOVE_TOLERANCE * 2;
        },
        // 1x 时允许外层列表把手势抢走（翻页）；放大后拒绝，保住平移。
        onPanResponderTerminationRequest: () => view.current.scale <= 1.01,
        onPanResponderGrant: () => {
          gesture.current.moved = false;
          gesture.current.longPressFired = false;
          gesture.current.panStartTx = view.current.tx;
          gesture.current.panStartTy = view.current.ty;
          gesture.current.pinchStartDistance = 0;
          clearLongPress();
          longPressTimer.current = setTimeout(() => {
            if (!gesture.current.moved) {
              gesture.current.longPressFired = true;
              onLongPress?.();
            }
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (event, gestureState) => {
          const touches = event.nativeEvent.touches;
          if (
            Math.abs(gestureState.dx) > MOVE_TOLERANCE ||
            Math.abs(gestureState.dy) > MOVE_TOLERANCE
          ) {
            gesture.current.moved = true;
            clearLongPress();
          }

          if (touches.length === 2) {
            const current = distance(touches);
            if (gesture.current.pinchStartDistance === 0) {
              gesture.current.pinchStartDistance = current;
              gesture.current.pinchStartScale = view.current.scale;
              return;
            }
            const ratio = current / gesture.current.pinchStartDistance;
            setScale(gesture.current.pinchStartScale * ratio);
            return;
          }

          if (view.current.scale > 1.01) {
            view.current.tx = clampTranslate(
              gesture.current.panStartTx + gestureState.dx,
              width,
            );
            view.current.ty = clampTranslate(
              gesture.current.panStartTy + gestureState.dy,
              height,
            );
            apply();
          }
        },
        onPanResponderRelease: (event) => {
          clearLongPress();
          gesture.current.pinchStartDistance = 0;
          if (!gesture.current.moved && !gesture.current.longPressFired) {
            handleTap(event);
          }
        },
        onPanResponderTerminate: () => {
          clearLongPress();
          gesture.current.pinchStartDistance = 0;
        },
      }),
    [
      apply,
      clampTranslate,
      clearLongPress,
      handleTap,
      height,
      onLongPress,
      setScale,
      width,
    ],
  );

  // Web：滚轮 / 触控板捏合缩放（原生走上面的 PanResponder 双指）。
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale(view.current.scale * Math.exp(-event.deltaY / 300));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [active, setScale]);

  return (
    <View
      ref={containerRef}
      style={[{ width, height }, s.container]}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={[
          s.fill,
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
      >
        <Image
          source={{ uri }}
          style={s.fill}
          contentFit="contain"
          transition={150}
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
