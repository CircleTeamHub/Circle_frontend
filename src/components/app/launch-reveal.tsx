import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import LottieView from 'lottie-react-native';

// 主题紫的纸飞机 Lottie（描边/纸身已改为品牌色，见 assets/lottie/README.md）。
// 换素材只需替换该 json（无需再次原生重建）。
const foldSource = require('../../../assets/lottie/plane-fold.json');

// 极简开场：白底播放 Lottie 飞机 → 揭幕（遮罩淡出 + App 从中心弹性展开）。
const DURATION_MS = 2600;
const T = {
  planeIn: [0, 0.12],
  reveal: [0.72, 1],
} as const;

type LaunchRevealProps = {
  play: boolean;
  onFinish: () => void;
  /** 揭幕时机（progress 越过 reveal 起点）回调一次，供上层做「App 从中心弹性展开」。 */
  onReveal?: () => void;
};

export function LaunchReveal({ play, onFinish, onReveal }: LaunchRevealProps) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const revealFired = useSharedValue(false);
  const minDim = Math.min(Math.max(width, 1), Math.max(height, 1));
  // Lottie 画布 500×500 里飞机居中偏小，容器取屏幕短边的 0.62 让视觉尺寸合适。
  const size = Math.min(300, Math.max(200, minDim * 0.62));

  useEffect(() => {
    if (!play) {
      return;
    }
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: DURATION_MS, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) {
          scheduleOnRN(onFinish);
        }
      },
    );
  }, [onFinish, play, progress]);

  // 越过揭幕起点时回调一次 onReveal（供 _layout 启动 App 弹性展开），与遮罩淡出同步。
  useAnimatedReaction(
    () => progress.value,
    (p) => {
      if (!revealFired.value && p >= T.reveal[0]) {
        revealFired.value = true;
        if (onReveal) {
          scheduleOnRN(onReveal);
        }
      }
    },
  );

  // 飞机：轻微浮现成型 → 保持 Lottie 自身动画 → 揭幕时略放大并淡出。
  const planeStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const appear = interpolate(p, [T.planeIn[0], T.planeIn[1]], [0, 1], Extrapolation.CLAMP);
    const inScale = interpolate(p, [T.planeIn[0], T.planeIn[1]], [0.72, 1], Extrapolation.CLAMP);
    const out = interpolate(p, [T.reveal[0], T.reveal[0] + 0.14], [1, 0], Extrapolation.CLAMP);
    const upScale = interpolate(p, [T.reveal[0], T.reveal[1]], [1, 1.1], Extrapolation.CLAMP);
    return {
      opacity: appear * out,
      transform: [{ scale: inScale * upScale }],
    };
  });

  // 揭幕：白色遮罩淡出，露出下面已渲染好的 App（配合 _layout 的中心弹性放大）。
  const overlayStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: interpolate(p, [T.reveal[0], T.reveal[1]], [1, 0], Extrapolation.CLAMP),
    };
  });

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View style={[styles.overlay, overlayStyle]} />
      <Animated.View
        style={[
          styles.plane,
          {
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
          },
          planeStyle,
        ]}
      >
        <LottieView
          source={foldSource}
          autoPlay
          loop
          resizeMode="contain"
          style={styles.lottie}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // 极浅灰白背景（Duolingo/Arc 风）。
    backgroundColor: '#FAFAFC',
  },
  plane: {
    left: '50%',
    position: 'absolute',
    top: '50%',
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
});
