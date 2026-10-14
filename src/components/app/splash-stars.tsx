import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { CoverFrame } from '@/components/app/splash-night-frame';
import nightLayout from '../../../assets/splash/night-layout.json';

const SPARKLE_PATH =
  'M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z';
const TWINKLE_MS = 1400;
const STAR_COLOR = '#FFFFFF';
const SPARKLE_COLOR = '#E9DDFF';
// 底图里已经烤了一层暗的星星；这里叠一层同位置的亮星做「闪」。
// 两组错相，起始不透明度都是 0 —— 第一帧与原生启动图完全一样。
const GLOW_PEAK = 0.75;

type Props = { frame: CoverFrame };

/** 开屏夜空：在底图星星的同一位置叠亮层，两组交替闪烁。 */
export function SplashStars({ frame }: Props) {
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(twinkle, {
        duration: TWINKLE_MS * 2,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [twinkle]);

  const groupOpacity = [
    twinkle.interpolate({
      inputRange: [0, 0.25, 0.5, 1],
      outputRange: [0, GLOW_PEAK, 0, 0],
    }),
    twinkle.interpolate({
      inputRange: [0, 0.5, 0.75, 1],
      outputRange: [0, 0, GLOW_PEAK, 0],
    }),
  ] as const;

  const toScreen = (x: number, y: number) => ({
    left: frame.offsetX + x * frame.scale,
    top: frame.offsetY + y * frame.scale,
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {nightLayout.dots.map(([x, y, diameter], index) => {
        const size = diameter * frame.scale;
        const pos = toScreen(x, y);
        return (
          <Animated.View
            key={`dot-${index}`}
            style={[
              styles.dot,
              {
                left: pos.left - size / 2,
                top: pos.top - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                opacity: groupOpacity[index % 2],
              },
            ]}
          />
        );
      })}
      {nightLayout.sparkles.map(([x, y, side], index) => {
        const size = side * frame.scale;
        return (
          <Animated.View
            key={`sparkle-${index}`}
            style={[styles.sparkle, toScreen(x, y), { opacity: groupOpacity[(index + 1) % 2] }]}
          >
            <Svg width={size} height={size} viewBox="0 0 24 24">
              <Path d={SPARKLE_PATH} fill={SPARKLE_COLOR} />
            </Svg>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    backgroundColor: STAR_COLOR,
  },
  sparkle: {
    position: 'absolute',
  },
});
