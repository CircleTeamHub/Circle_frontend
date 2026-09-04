import { memo, useEffect, useId, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { Gradients, useTheme, type ThemeColors } from '@/theme';
import {
  DAY_DOTS,
  DAY_HAZE,
  DAY_SPARKLES,
  NEBULA,
  NIGHT_STARS,
  PLANE_BOX,
  SKY_HEIGHT,
  SKY_WIDTH,
  TRAIL_BLOOM,
  TRAIL_END,
  TRAIL_PATH,
  TRAIL_START,
  getSkyLayout,
  sparklePath,
  type SkyLayout,
} from './login-sky-geometry';

const APP_LOGO_SOURCE = require('../../../../assets/images/login-logo-plane.png');

/** 航迹亮芯 / 暗色飞机光晕：默认封面渐变的中间淡紫，不新造颜色。 */
const TRAIL_CORE = Gradients.defaultCover[1];
/** 日间小星星交替用会员卡渐变的最后一站亮紫。 */
const SPARKLE_ALT = Gradients.memberCard[2];
const REVEAL_MS = 900;
const PLANE_SLIDE_PX = 12;
const VIEW_BOX = `0 0 ${SKY_WIDTH} ${SKY_HEIGHT}`;

interface LoginSkyProps {
  /** 屏幕宽度；hero 按它等比缩放并居中。 */
  width: number;
  /** 系统减弱动效：null = 还没读到（先不露出），true = 直接终态，false = 播一次入场。 */
  reduceMotion: boolean | null;
}

/** 一次性入场：偏好未知时按兵不动，避免"先满显、读到偏好后再重置重播"的闪烁。 */
function useRevealAnimation(reduceMotion: boolean | null) {
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      reveal.setValue(1);
      return;
    }
    const animation = Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, reveal]);

  return reveal;
}

interface SkyPartProps {
  colors: ThemeColors;
  dark: boolean;
  layout: SkyLayout;
  /** 同屏可能挂两份 hero（导航切换中），渐变 id 带实例后缀避免 url(#id) 串台。 */
  idSuffix: string;
}

/** 静态层：星云 / 薄雾 + 星点（暗色白星，亮色紫点和四角小星）。 */
function SkyStars({ colors, dark, layout, idSuffix }: SkyPartProps) {
  const glow = dark ? NEBULA : DAY_HAZE;
  const glowId = `wn-sky-glow-${idSuffix}`;
  return (
    <Svg width={layout.width} height={layout.height} viewBox={VIEW_BOX}>
      <Defs>
        <RadialGradient
          id={glowId}
          cx={glow.cx}
          cy={glow.cy}
          r={glow.r}
          gradientUnits="userSpaceOnUse"
        >
          <Stop
            offset="0"
            stopColor={dark ? colors.brandPurple : TRAIL_CORE}
            stopOpacity={dark ? 0.12 : 0.45}
          />
          <Stop
            offset="1"
            stopColor={dark ? colors.brandPurple : TRAIL_CORE}
            stopOpacity={0}
          />
        </RadialGradient>
      </Defs>
      <Circle cx={glow.cx} cy={glow.cy} r={glow.r} fill={`url(#${glowId})`} />
      {(dark ? NIGHT_STARS : DAY_DOTS).map((s, index) => (
        <Circle
          key={index}
          testID={dark ? 'login-sky-star' : 'login-sky-dot'}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={dark ? colors.white : colors.brandPurple}
          opacity={s.opacity}
        />
      ))}
      {dark
        ? null
        : DAY_SPARKLES.map((s, index) => (
            <Path
              key={index}
              testID="login-sky-sparkle"
              d={sparklePath(s.size)}
              transform={`translate(${s.x} ${s.y})`}
              fill={index % 2 === 0 ? colors.brandPurple : SPARKLE_ALT}
              opacity={s.opacity}
            />
          ))}
    </Svg>
  );
}

/** 航迹：暗色是三层光晕 + 渐显的亮芯，亮色是荧光笔底 + 实色虚线。 */
function SkyTrail({ colors, dark, layout, idSuffix }: SkyPartProps) {
  const coreId = `wn-trail-core-${idSuffix}`;
  const bloomId = `wn-trail-bloom-${idSuffix}`;
  const gradientProps = {
    x1: TRAIL_START.x,
    y1: TRAIL_START.y,
    x2: TRAIL_END.x,
    y2: TRAIL_END.y,
    gradientUnits: 'userSpaceOnUse' as const,
  };
  return (
    <Svg width={layout.width} height={layout.height} viewBox={VIEW_BOX}>
      <Defs>
        <LinearGradient id={coreId} {...gradientProps}>
          <Stop offset="0" stopColor={TRAIL_CORE} stopOpacity={0} />
          <Stop offset="1" stopColor={TRAIL_CORE} stopOpacity={0.95} />
        </LinearGradient>
        <LinearGradient id={bloomId} {...gradientProps}>
          <Stop offset="0" stopColor={colors.brandPurple} stopOpacity={0} />
          <Stop offset="1" stopColor={colors.brandPurple} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      {dark ? (
        TRAIL_BLOOM.map((bloom) => (
          <Path
            key={bloom.width}
            testID="login-sky-trail-bloom"
            d={TRAIL_PATH}
            stroke={`url(#${bloomId})`}
            strokeWidth={bloom.width}
            strokeLinecap="round"
            opacity={bloom.opacity}
            fill="none"
          />
        ))
      ) : (
        <Path
          testID="login-sky-trail-underlay"
          d={TRAIL_PATH}
          stroke={colors.primaryLight}
          strokeWidth={10}
          strokeLinecap="round"
          fill="none"
        />
      )}
      <Path
        testID="login-sky-trail"
        d={TRAIL_PATH}
        stroke={dark ? `url(#${coreId})` : colors.brandPurple}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="14 8"
        fill="none"
      />
    </Svg>
  );
}

/**
 * 「夜航」登录页的 hero：星空 / 日间薄雾 + 发光航迹 + 手绘纸飞机。
 *
 * 纯装饰（pointerEvents none、对无障碍隐藏），绝对定位在滚动内容顶部，
 * 天空从屏幕最上沿铺起、压在状态栏下面（设计稿坐标已包含状态栏区域）。
 * 动效只有一处：航迹与飞机挂载时淡入并从左滑入 12px，走 RN core Animated 的
 * 原生驱动（仅 opacity / transform），不碰 reanimated，也不动 SVG 属性。
 */
export const LoginSky = memo(function LoginSky({ width, reduceMotion }: LoginSkyProps) {
  const { colors, resolvedMode } = useTheme();
  const dark = resolvedMode === 'dark';
  const layout = useMemo(() => getSkyLayout(width), [width]);
  const idSuffix = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reveal = useRevealAnimation(reduceMotion);

  const planeBox = {
    left: PLANE_BOX.left * layout.scale,
    top: PLANE_BOX.top * layout.scale,
    width: PLANE_BOX.size * layout.scale,
    height: PLANE_BOX.size * layout.scale,
  };
  const planeSlide = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [-PLANE_SLIDE_PX * layout.scale, 0],
  });
  const rotate = `${PLANE_BOX.rotate}deg`;
  const partProps = { colors, dark, layout, idSuffix };

  return (
    <View
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.root,
        { left: layout.offsetX, width: layout.width, height: layout.height },
      ]}
    >
      <SkyStars {...partProps} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal }]}>
        <SkyTrail {...partProps} />
      </Animated.View>
      {dark ? (
        <Animated.Image
          testID="login-sky-plane-halo"
          source={APP_LOGO_SOURCE}
          resizeMode="contain"
          tintColor={TRAIL_CORE}
          accessible={false}
          style={[
            styles.plane,
            planeBox,
            {
              opacity: Animated.multiply(reveal, 0.35),
              transform: [{ translateX: planeSlide }, { rotate }, { scale: 1.06 }],
            },
          ]}
        />
      ) : null}
      <Animated.Image
        testID="login-sky-plane"
        source={APP_LOGO_SOURCE}
        resizeMode="contain"
        accessible={false}
        style={[
          styles.plane,
          planeBox,
          { opacity: reveal, transform: [{ translateX: planeSlide }, { rotate }] },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
  },
  plane: {
    position: 'absolute',
  },
});
