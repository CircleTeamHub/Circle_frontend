import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, UIManager, View, useWindowDimensions } from 'react-native';
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
// 原生 Lottie 缺席时的静态兜底（与原生启动图同一张紫飞机，视觉不断层）。
const staticPlaneSource = require('../../../assets/images/splash-icon.png');

/** Fabric 运行时注入的组件注册表探针（RN 的 unstable_hasComponent 内部用的就是它）。 */
type ComponentRegistryGlobal = {
  __nativeComponentRegistry__hasComponent?: (name: string) => boolean;
};

let nativeLottieCache: boolean | null = null;

/**
 * 原生二进制里到底有没有 Lottie 组件。
 *
 * 装着旧二进制的 dev-client 跑新 JS 时（或任何漏装原生模块的构建），Fabric 会把
 * 未注册组件渲染成整块粉红「Unimplemented component: <LottieAnimationView>」——
 * 正好糊在开屏正中。宁可退回静态图，也不能把这块红斑丢给用户。
 *
 * 懒探测并缓存：探针是运行时注入的全局，模块求值时不保证已就绪。
 */
function hasNativeLottie(): boolean {
  if (nativeLottieCache != null) return nativeLottieCache;
  const registry = globalThis as ComponentRegistryGlobal;
  const probe = registry.__nativeComponentRegistry__hasComponent;
  // 新架构走组件注册表；老架构没有该全局，退回 view manager 查询。
  // 两者都问不到就当它在，维持原行为（正常构建里 Lottie 一直装着）。
  nativeLottieCache =
    typeof probe === 'function'
      ? probe('LottieAnimationView')
      : UIManager.getViewManagerConfig?.('LottieAnimationView') != null;
  return nativeLottieCache;
}

type LottieTimeline = {
  fr?: number;
  ip?: number;
  op?: number;
};

const lottieTimeline = foldSource as LottieTimeline;
const lottieFramerate = Number(lottieTimeline.fr) > 0 ? Number(lottieTimeline.fr) : 60;
const lottieStartFrame = Number.isFinite(Number(lottieTimeline.ip))
  ? Number(lottieTimeline.ip)
  : 0;
const lottieEndFrame = Number.isFinite(Number(lottieTimeline.op))
  ? Number(lottieTimeline.op)
  : lottieStartFrame;
// Lottie 播放速度（<1 更慢）。飞机飞得慢一点就调小这个值；
// 实际播放时长按此换算，揭幕时机随之延后，保持同步。
const LOTTIE_SPEED = 0.75;
const LOTTIE_DURATION_MS = Math.max(
  0,
  Math.round(
    ((lottieEndFrame - lottieStartFrame) / lottieFramerate / LOTTIE_SPEED) * 1000,
  ),
);
const REVEAL_BUFFER_MS = 300;
// 兜底态没有动画可播，只做一次短暂的品牌亮相就揭幕，别让用户干等 2.4 秒。
const FALLBACK_DURATION_MS = 900;

// 开场：白底播放「信封开→折成飞机→飞走」的一次性 Lottie → 飞机飞走瞬间揭幕
// （遮罩淡出 + App 从中心弹性展开）。Lottie 本身 2.4s，总时长留一点揭幕缓冲。
// progress 是时间轴，必须线性递增；缓动只应放在具体视觉插值里，不能影响揭幕时机。
const DURATION_MS = LOTTIE_DURATION_MS + REVEAL_BUFFER_MS;
const T = {
  planeIn: [0, 0.05],
  reveal: [0.92, 1],
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
  // 当前 Lottie 是大画布，容器取屏幕短边的 0.78 让纸飞机主体足够醒目。
  const size = Math.min(360, Math.max(240, minDim * 0.78));
  const lottieRef = useRef<LottieView>(null);
  const lottieReady = hasNativeLottie();

  useEffect(() => {
    if (!play) {
      return;
    }
    if (lottieReady) {
      // 完整播放整段动画（信封开→折成飞机→转向飞走→poof），一帧不删。
      lottieRef.current?.reset();
      lottieRef.current?.play();
    }
    progress.value = 0;
    progress.value = withTiming(
      1,
      {
        duration: lottieReady ? DURATION_MS : FALLBACK_DURATION_MS,
        easing: Easing.linear,
      },
      (finished) => {
        if (finished) {
          scheduleOnRN(onFinish);
        }
      },
    );
  }, [lottieReady, onFinish, play, progress]);

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

  // 容器只做淡入/收尾淡出，运动全交给 Lottie（信封开→折→飞走）自身完成。
  const planeStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const appear = interpolate(p, [T.planeIn[0], T.planeIn[1]], [0, 1], Extrapolation.CLAMP);
    // 收尾淡出（此时飞机已在 Lottie 里飞走，画面基本空）。
    const out = interpolate(p, [T.reveal[0] + 0.06, T.reveal[1]], [1, 0], Extrapolation.CLAMP);
    return { opacity: appear * out };
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
      <Animated.View
        style={[
          styles.overlay,
          // 兜底态铺纯白：静态图自带白底，遮罩同色才不会露出一圈方块边，
          // 也与原生启动图（app.json splash.backgroundColor = #FFFFFF）无缝衔接。
          lottieReady ? null : styles.overlayFallback,
          overlayStyle,
        ]}
      />
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
        {lottieReady ? (
          <LottieView
            ref={lottieRef}
            source={foldSource}
            loop={false}
            speed={LOTTIE_SPEED}
            resizeMode="contain"
            style={styles.lottie}
          />
        ) : (
          <Image
            source={staticPlaneSource}
            resizeMode="contain"
            style={styles.lottie}
          />
        )}
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
  overlayFallback: {
    backgroundColor: '#FFFFFF',
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
