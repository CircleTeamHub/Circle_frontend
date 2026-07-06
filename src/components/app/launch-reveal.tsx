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
  const planeSize = Math.min(156, Math.max(120, Math.min(safeWidth, safeHeight) * 0.34));
  const orbitRadius = planeSize * 0.38;

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
    const orbitProgress = Math.min(progress.value / 0.72, 1);
    const orbitEase = Math.sin(Math.PI * orbitProgress);
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
        { translateX: Math.cos(angle) * orbitRadius * orbitEase },
        { translateY: Math.sin(angle) * orbitRadius * orbitEase },
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
    backgroundColor: '#FFFFFF',
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
  },
});
