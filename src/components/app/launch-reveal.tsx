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

const planeImage = require('../../../assets/images/login-logo-plane.png');

// 折叠段素材开关：把「你的 logo 折成飞机」的 Lottie JSON 放到
// assets/lottie/plane-fold.json 后，改为 true 并解开下方 LottieView 分支即可。
// 见 assets/lottie/README.md。当前用风格化代码折叠占位。
const HAS_FOLD_LOTTIE = false;

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

  // 主机身：logo 出现 → 折叠成型 → 起飞绕屏 → 冲向镜头（放大+淡出）。
  const planeStyle = useAnimatedStyle(() => {
    const p = progress.value;

    // 出现：淡入 + 轻微放大。
    const inOpacity = interpolate(p, [T.logoIn[0], T.logoIn[1]], [0, 1], Extrapolation.CLAMP);
    const inScale = interpolate(p, [T.logoIn[0], T.logoIn[1]], [0.6, 1], Extrapolation.CLAMP);

    // 风格化折叠占位（有真 Lottie 时这段由 Lottie 承担，主机身在折叠段先隐身）：
    // 扁平(scaleX 0.1、rotateX 感 via scaleY 压扁) → 展开成型。
    const foldX = interpolate(p, [T.fold[0], T.fold[1]], [0.12, 1], Extrapolation.CLAMP);
    const foldY = interpolate(p, [T.fold[0], (T.fold[0] + T.fold[1]) / 2, T.fold[1]], [0.5, 0.86, 1], Extrapolation.CLAMP);
    const foldSpin = interpolate(p, [T.fold[0], T.fold[1]], [-18, 0], Extrapolation.CLAMP);

    // swoosh 位置 + 俯冲。
    const swooshX = pathX(p);
    const swooshY = pathY(p);
    const diveScale = interpolate(p, [T.dive[0], T.dive[1]], [1, 7], Extrapolation.CLAMP);
    const diveFade = interpolate(p, [T.dive[0], T.dive[1]], [1, 0], Extrapolation.CLAMP);
    // 俯冲时朝画面中心并略微下压，制造「冲向镜头」的透视感。
    const diveX = interpolate(p, [T.dive[0], T.dive[1]], [0, 0], Extrapolation.CLAMP);
    const diveY = interpolate(p, [T.dive[0], T.dive[1]], [0, safeHeight * 0.04], Extrapolation.CLAMP);

    const inFold = p < T.fold[1];
    // 有真 Lottie 时，折叠段隐藏主机身（交给 Lottie）；占位模式下主机身自己演折叠。
    const foldGate = HAS_FOLD_LOTTIE && p >= T.fold[0] && inFold ? 0 : 1;

    const opacity = Math.min(inOpacity, diveFade) * foldGate;
    const scale = (inFold ? Math.min(inScale, foldX) : 1) * (p >= T.dive[0] ? diveScale : 1);

    return {
      opacity,
      transform: [
        { translateX: swooshX + diveX },
        { translateY: swooshY + diveY },
        { rotate: `${inFold ? foldSpin : 0}deg` },
        { scaleX: scale },
        { scaleY: (inFold ? foldY : 1) * (p >= T.dive[0] ? diveScale : 1) },
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
      {/* 折叠段：放入 plane-fold.json 后启用（见 README）。当前占位由主机身自身演绎。
      {HAS_FOLD_LOTTIE ? (
        <LottieFold progress={progress} planeSize={planeSize} window={T.fold} />
      ) : null} */}
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
});
