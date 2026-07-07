import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import LottieView from 'lottie-react-native';

const planeImage = require('../../../assets/images/login-logo-plane.png');
const foldSource = require('../../../assets/lottie/plane-fold.json');

// 折叠段素材开关：assets/lottie/plane-fold.json 到位后为 true，折叠段用 Lottie 播放，
// 之后由主机身（PNG）接棒起飞。换素材只需替换该 json（无需再次原生重建）。
const HAS_FOLD_LOTTIE = true;

// 品牌紫（发光尾迹/占位折叠用）。
const BRAND = '#6366F1';

// 整段开场时长（< 6s）。各阶段用 progress 归一化时间轴切分。
const DURATION_MS = 4200;

// 时间轴（progress 0→1）：
//  logo 出现 → 折叠 → 起飞+绕屏swoosh(带发光尾迹) → 冲向镜头 → 揭幕
const T = {
  logoIn: [0, 0.12],
  fold: [0.12, 0.36],
  swoosh: [0.4, 0.72],
  dive: [0.72, 0.88],
  reveal: [0.84, 1],
} as const;

type LaunchRevealProps = {
  play: boolean;
  onFinish: () => void;
  /** 揭幕时机（progress 越过 reveal 起点）回调一次，供上层做「App 从中心弹性展开」。 */
  onReveal?: () => void;
};

const TRAIL_COUNT = 6;

/** 发光尾迹的一枚残影：跟随主机身、带滞后，透明度/缩放递减。 */
function TrailGhost({
  progress,
  planeSize,
  pathX,
  pathY,
  lag,
  strength,
}: {
  progress: SharedValue<number>;
  planeSize: number;
  pathX: (p: number) => number;
  pathY: (p: number) => number;
  lag: number;
  strength: number;
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // 仅在 swoosh 阶段显示；残影取滞后一点的路径位置。
    const lagged = Math.max(p - lag, T.swoosh[0]);
    const visible = p >= T.swoosh[0] && p <= T.swoosh[1] + 0.04;
    const fade = interpolate(
      p,
      [T.swoosh[0], T.swoosh[0] + 0.08, T.swoosh[1], T.swoosh[1] + 0.04],
      [0, strength, strength, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: visible ? fade : 0,
      transform: [
        { translateX: pathX(lagged) },
        { translateY: pathY(lagged) },
        { scale: 0.9 - lag * 1.4 },
      ],
    };
  });

  return (
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
          tintColor: BRAND,
        },
        style,
      ]}
    />
  );
}

export function LaunchReveal({ play, onFinish, onReveal }: LaunchRevealProps) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const revealFired = useSharedValue(false);
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const planeSize = Math.min(150, Math.max(112, Math.min(safeWidth, safeHeight) * 0.32));
  // Lottie 画布 500×500 里飞机居中偏小，容器放大约 2× 让视觉尺寸与尾迹/整体协调。
  const lottieSize = planeSize * 2;

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

  // 绕屏 swoosh 路径（worklet 与 JS 都会用，故写成可在 worklet 内内联的纯函数）。
  // 起飞后先向左下沉、划一道弧再回到中心偏上，随后进入俯冲。
  const pathX = (p: number) => {
    'worklet';
    return interpolate(
      p,
      [T.swoosh[0], 0.52, 0.64, T.swoosh[1]],
      [0, -safeWidth * 0.32, safeWidth * 0.12, 0],
      Extrapolation.CLAMP,
    );
  };
  const pathY = (p: number) => {
    'worklet';
    return interpolate(
      p,
      [T.swoosh[0], 0.52, 0.64, T.swoosh[1]],
      [0, safeHeight * 0.12, -safeHeight * 0.06, 0],
      Extrapolation.CLAMP,
    );
  };

  // 主机身（Lottie 紫飞机）：浮现成型 → 起飞绕屏 → 冲向镜头（放大+淡出）。
  // 折叠/悬浮段由 Lottie 自身动画演绎，这里只驱动整体的浮现、位移、俯冲。
  const planeStyle = useAnimatedStyle(() => {
    const p = progress.value;

    // 浮现：淡入 + 轻微放大成型。
    const inOpacity = interpolate(p, [T.logoIn[0], T.logoIn[1]], [0, 1], Extrapolation.CLAMP);
    const inScale = interpolate(p, [T.logoIn[0], T.logoIn[1]], [0.62, 1], Extrapolation.CLAMP);

    // 绕屏 swoosh 位置（swoosh 起点前经 CLAMP 恒为 0，飞机在中心悬浮）。
    const swooshX = pathX(p);
    const swooshY = pathY(p);

    // 冲向镜头：放大掠过 + 淡出，略微下压制造透视。
    const diveScale = interpolate(p, [T.dive[0], T.dive[1]], [1, 6.5], Extrapolation.CLAMP);
    const diveFade = interpolate(p, [T.dive[0], T.dive[1]], [1, 0], Extrapolation.CLAMP);
    const diveY = interpolate(p, [T.dive[0], T.dive[1]], [0, safeHeight * 0.04], Extrapolation.CLAMP);

    const scale = (p < T.logoIn[1] ? inScale : 1) * (p >= T.dive[0] ? diveScale : 1);

    return {
      opacity: inOpacity * diveFade,
      transform: [
        { translateX: swooshX },
        { translateY: swooshY + diveY },
        { scale },
      ],
    };
  });

  // 揭幕：白色遮罩淡出，露出下面已渲染好的 App（配合 _layout 的中心弹性放大）。
  const overlayStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const opacity = interpolate(p, [T.reveal[0], T.reveal[1]], [1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View style={[styles.overlay, overlayStyle]} />
      {Array.from({ length: TRAIL_COUNT }).map((_, i) => (
        <TrailGhost
          key={i}
          progress={progress}
          planeSize={planeSize}
          pathX={pathX}
          pathY={pathY}
          lag={(i + 1) * 0.022}
          strength={0.28 - i * 0.03}
        />
      ))}
      {/* 主机身：复用主题紫的 Lottie 飞机，贯穿浮现→绕屏→冲镜。Lottie 尺寸约 2×，
          因飞机在 500×500 画布里居中偏小。 */}
      <Animated.View
        style={[
          styles.plane,
          {
            width: lottieSize,
            height: lottieSize,
            marginLeft: -lottieSize / 2,
            marginTop: -lottieSize / 2,
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
    backgroundColor: 'transparent',
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
