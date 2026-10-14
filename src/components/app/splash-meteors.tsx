import { useEffect, useId, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type MeteorSpec = {
  /** 起点（百分比坐标），流星从这里往左下划过。 */
  x: number;
  y: number;
  length: number;
  distance: number;
  delay: number;
};

// 三颗流星错开出场，都从上半屏右侧起飞，划过时不经过中间图标。
const METEORS: readonly MeteorSpec[] = [
  { x: 92, y: 6, length: 110, distance: 260, delay: 150 },
  { x: 70, y: 2, length: 80, distance: 200, delay: 900 },
  { x: 98, y: 30, length: 95, distance: 220, delay: 1600 },
];

// 145° = 朝左下方（屏幕坐标 y 向下，顺时针为正）。
const METEOR_ANGLE = '145deg';
const FLIGHT_MS = 850;
const REST_MS = 1800;
const HEAD_RADIUS = 1.6;
const THICKNESS = 2;

function Meteor({ x, y, length, distance, delay }: MeteorSpec) {
  const progress = useRef(new Animated.Value(0)).current;
  const gradientId = `meteor-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: FLIGHT_MS,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(REST_MS),
        Animated.timing(progress, { duration: 0, toValue: 0, useNativeDriver: true }),
      ]),
    );
    const start = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [delay, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, distance],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.7, 1],
    outputRange: [0, 1, 0.9, 0],
  });

  return (
    // 零尺寸锚点：旋转以起点为圆心，流星沿旋转后的 x 轴飞出。
    <View style={[styles.anchor, { left: `${x}%`, top: `${y}%` }]}>
      <Animated.View
        style={[
          styles.meteor,
          { width: length, opacity, transform: [{ translateX }] },
        ]}
      >
        <Svg width={length} height={THICKNESS * 2} viewBox={`0 0 ${length} ${THICKNESS * 2}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <Stop offset="0.7" stopColor="#E9DDFF" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={THICKNESS / 2}
            width={length - HEAD_RADIUS}
            height={THICKNESS}
            rx={THICKNESS / 2}
            fill={`url(#${gradientId})`}
          />
          <Circle cx={length - HEAD_RADIUS} cy={THICKNESS} r={HEAD_RADIUS} fill="#FFFFFF" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** 开屏夜空里的流星：循环从右上往左下划过。 */
export function SplashMeteors() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {METEORS.map((meteor, index) => (
        <Meteor key={`meteor-${index}`} {...meteor} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    transform: [{ rotate: METEOR_ANGLE }],
  },
  meteor: {
    position: 'absolute',
    // 尾巴在左、头在右：让头部对准锚点，整条从起点后方开始飞。
    right: 0,
    top: -THICKNESS,
  },
});
