import { useRef } from 'react';
import { Animated, PanResponder, type PanResponderInstance } from 'react-native';

const CLAIM_DY = -6;
const DISMISS_DY = -40;
const FLING_MS = 150;

interface SwipeUpDismiss {
  /** 铺到可拖动的那层 Animated.View 上。 */
  panHandlers: PanResponderInstance['panHandlers'];
  /** 手指跟随的位移；与入场动画的 translateY 相加即可。 */
  dragY: Animated.Value;
}

/**
 * 顶部横幅的「上滑关掉」手势：只认明显向上的竖向拖动（点按仍交给里面的 Pressable），
 * 松手过阈值就甩出去再回调 onDismiss，没过就弹回原位。
 *
 * onDismiss 用 ref 读最新值 —— PanResponder 只建一次，调用方不必为它 memo。
 */
export function useSwipeUpDismiss(onDismiss: () => void): SwipeUpDismiss {
  const dragY = useRef(new Animated.Value(0)).current;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        g.dy < CLAIM_DY && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_evt, g) => {
        if (g.dy < 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy < DISMISS_DY) {
          Animated.timing(dragY, {
            toValue: -160,
            duration: FLING_MS,
            useNativeDriver: true,
          }).start(() => {
            dragY.setValue(0);
            onDismissRef.current();
          });
          return;
        }
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  return { panHandlers: pan.panHandlers, dragY };
}
