import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const planeImage = require('../../../assets/images/login-logo-plane.png');

type LaunchRevealProps = {
  play: boolean;
  onFinish: () => void;
};

export function LaunchReveal({ play, onFinish }: LaunchRevealProps) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const planeSize = Math.min(128, Math.max(100, Math.min(safeWidth, safeHeight) * 0.28));
  // 先向左飞的距离，以及掉头后向右飞出屏幕外的距离（需 > 半屏 + 半个机身，确保完全飞出）。
  const flyLeftDist = safeWidth * 0.3;
  const flyOutDist = safeWidth / 2 + planeSize;

  useEffect(() => {
    if (!play) {
      return;
    }

    progress.value = 0;
    progress.value = withTiming(
      1,
      {
        duration: 1600,
        easing: Easing.inOut(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          scheduleOnRN(onFinish);
        }
      },
    );
  }, [onFinish, play, progress]);

  const planeStyle = useAnimatedStyle(() => {
    // 飞行阶段（progress 0→0.72）：先向左飞 → 掉头 → 向右加速飞出右侧屏幕外；
    // 之后（0.72→1）幕布左右拉开「开屏」。
    const p = progress.value;
    // 水平：中心 → 左(-flyLeftDist) → 掉头向右飞出屏幕(flyOutDist)。
    const translateX = interpolate(
      p,
      [0, 0.28, 0.72],
      [0, -flyLeftDist, flyOutDist],
      Extrapolation.CLAMP,
    );
    // 垂直：轻微起伏，让飞行更自然（先略降、掉头后爬升飞出）。
    const translateY = interpolate(
      p,
      [0, 0.28, 0.5, 0.72],
      [0, 14, -6, -40],
      Extrapolation.CLAMP,
    );
    // 面向：向左飞时镜像(scaleX -1 → 机头朝左)，在最左端经侧身(0)翻到 scaleX 1 向右飞 = 掉头。
    const facing = interpolate(p, [0.24, 0.34], [-1, 1], Extrapolation.CLAMP);
    // 机身随飞行姿态轻微俯仰。
    const tilt = interpolate(p, [0, 0.28, 0.72], [0, 8, -12], Extrapolation.CLAMP);

    return {
      // 飞出屏幕前保持不透明；接近开屏时（此刻已飞出右侧）淡出兜底。
      opacity: interpolate(p, [0, 0.66, 0.72], [1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX },
        { translateY },
        { rotate: `${tilt}deg` },
        { scaleX: facing },
      ],
    };
  });

  const leftPanelStyle = useAnimatedStyle(() => {
    const revealProgress = interpolate(
      progress.value,
      [0.72, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateX: -safeWidth * revealProgress }],
    };
  });

  const rightPanelStyle = useAnimatedStyle(() => {
    const revealProgress = interpolate(
      progress.value,
      [0.72, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateX: safeWidth * revealProgress }],
    };
  });

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View
        style={[
          styles.panel,
          styles.leftPanel,
          { width: safeWidth / 2, height: safeHeight },
          leftPanelStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.panel,
          styles.rightPanel,
          { width: safeWidth / 2, height: safeHeight },
          rightPanelStyle,
        ]}
      />
      <Animated.Image
        source={planeImage}
        resizeMode="contain"
        style={[
          styles.plane,
          {
            width: planeSize,
            height: planeSize,
            marginLeft: -planeSize / 2,
            marginTop: -planeSize / 2,
          },
          planeStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  panel: {
    // 品牌靛蓝幕布：登录页背景近白（#F8F9FA），白色幕布拉开时与背景同色 → 完全不可见。
    // 用品牌主色让「拉幕」在白底上高对比、清晰可见（飞机以 tintColor 显白，浮于幕布之上）。
    backgroundColor: '#6366F1',
    position: 'absolute',
    top: 0,
  },
  leftPanel: {
    left: 0,
  },
  rightPanel: {
    right: 0,
  },
  plane: {
    left: '50%',
    position: 'absolute',
    top: '50%',
    // 幕布为深色品牌色，飞机染白后清晰浮于其上。
    tintColor: '#FFFFFF',
  },
});
