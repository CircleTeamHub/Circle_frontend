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
  // 轨道半径取屏幕短边的比例，并夹住确保飞机整体不出屏（水平方向最紧）。
  // 半径需明显大于飞机尺寸，盘旋才看得出「绕圈」而非原地自转。
  const orbitRadius = Math.min(
    Math.min(safeWidth, safeHeight) * 0.3,
    safeWidth / 2 - planeSize / 2 - 12,
  );

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
    // 盘旋阶段：progress 0→0.72 走完整整一圈。
    const orbitProgress = Math.min(progress.value / 0.72, 1);
    // 半径在前 16% 从 0 平滑展开到定值后保持恒定，飞机沿完整圆周飞行；
    // 之前用 sin(π·orbitProgress) 会让半径在首尾都归零 → 飞机停在中心只自转 = 原地打转。
    const radiusGrow = interpolate(
      orbitProgress,
      [0, 0.16],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const angle = orbitProgress * Math.PI * 2 - Math.PI / 2;
    const revealProgress = interpolate(
      progress.value,
      [0.72, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: interpolate(
        progress.value,
        [0, 0.72, 0.9, 1],
        [1, 1, 0.5, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        { translateX: Math.cos(angle) * orbitRadius * radiusGrow },
        { translateY: Math.sin(angle) * orbitRadius * radiusGrow },
        { rotate: `${orbitProgress * 360}deg` },
        { scale: interpolate(revealProgress, [0, 1], [1, 0.88], Extrapolation.CLAMP) },
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
