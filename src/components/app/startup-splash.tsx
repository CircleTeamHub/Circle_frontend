import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { ChatBubbleIcon } from '@/components/app/chat-bubble-icon';
import { SplashMeteors } from '@/components/app/splash-meteors';
import { SplashStars } from '@/components/app/splash-stars';
import { getCoverFrame } from '@/components/app/splash-night-frame';
import nightLayout from '../../../assets/splash/night-layout.json';

// 「紫色夜空」：原生启动图（iOS cover 铺满 splash-night.png）与这里的底图
// splash-night-bg.png 由同一份布局生成，按同样的 cover 裁切对齐，图标/星星的位置和
// 大小一致 —— 系统启动屏交接给 JS 时画面不动，之后才开始闪烁、流星与旋转。
// 两张图由 scripts/generate-splash-night.mjs 生成，改布局后重跑它。
const NIGHT_BACKDROP = require('../../../assets/images/splash-night-bg.png');
const STARTUP_SPLASH_BACKGROUND = nightLayout.baseColor;
const STARTUP_SPLASH_MAX_WAIT_MS = 5000;
// 底图解码失败/过慢时也要及时交出原生启动屏，别让用户卡在静态画面。
const BACKDROP_READY_FALLBACK_MS = 800;
// 安卓 12+ 的系统启动屏做不了整屏图片，只有纯色 + 小图标。安卓上 JS 开屏先复刻
// 那一帧（同色、同尺寸图标），再淡入夜空并把图标放大到夜空布局的尺寸，过渡连续不跳。
const NEEDS_SYSTEM_SPLASH_HANDOFF = Platform.OS === 'android';
const ANDROID_SYSTEM_ICON_DP =
  (nightLayout.androidSystemSplash.imageWidthDp * nightLayout.iconWidth) /
  nightLayout.androidSystemSplash.imageCanvasPx;
const HANDOFF_FADE_MS = 500;

type StartupSplashProps = {
  canFinish?: boolean;
  /** 夜空底图已上屏：父层此时再隐藏原生启动屏，交接无闪烁。 */
  onBackdropReady?: () => void;
  children?: ReactNode;
};

/**
 * JS 启动完成后展示的短动画。
 * 原生启动图只能提供静态画面，旋转在这里执行，避免首屏直接闪现。
 */
export function StartupSplash({
  canFinish = true,
  onBackdropReady,
  children,
}: StartupSplashProps) {
  const window = useWindowDimensions();
  const frame = getCoverFrame(window.width, window.height);
  const iconSize = nightLayout.iconWidth * frame.scale;
  const backdropOpacity = useRef(
    new Animated.Value(NEEDS_SYSTEM_SPLASH_HANDOFF ? 0 : 1),
  ).current;
  const iconZoom = useRef(
    new Animated.Value(NEEDS_SYSTEM_SPLASH_HANDOFF ? ANDROID_SYSTEM_ICON_DP / iconSize : 1),
  ).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const iconOpacity = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const overlayScale = useRef(new Animated.Value(1)).current;
  const appOpacity = useRef(new Animated.Value(children ? 0 : 1)).current;
  const appScale = useRef(new Animated.Value(children ? 0.9 : 1)).current;
  const [rotationDone, setRotationDone] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [backdropReady, setBackdropReady] = useState(false);
  const readyNotifiedRef = useRef(false);

  const markBackdropReady = useCallback(() => {
    setBackdropReady(true);
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    onBackdropReady?.();
  }, [onBackdropReady]);

  useEffect(() => {
    const fallback = setTimeout(markBackdropReady, BACKDROP_READY_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [markBackdropReady]);

  // Authentication may be waiting on a pair of network timeouts. Keep the
  // branded transition short, then expose the normal route guard/loading UI
  // instead of leaving users on a static splash with no progress indication.
  useEffect(() => {
    if (canFinish) {
      setTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setTimedOut(true), STARTUP_SPLASH_MAX_WAIT_MS);
    return () => clearTimeout(timeout);
  }, [canFinish]);

  useEffect(() => {
    if (!backdropReady || !NEEDS_SYSTEM_SPLASH_HANDOFF) return;
    const handoff = Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: HANDOFF_FADE_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(iconZoom, {
        duration: HANDOFF_FADE_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);
    handoff.start();
    return () => handoff.stop();
  }, [backdropOpacity, backdropReady, iconZoom]);

  useEffect(() => {
    // 原生启动屏还盖在上面时不开始转，免得用户错过前半段。
    if (!backdropReady) return;
    let cancelled = false;
    const spin = Animated.sequence([
      Animated.delay(1000),
      Animated.parallel([
        Animated.spring(rotation, {
          bounciness: 13,
          speed: 42,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(scale, {
            duration: 110,
            toValue: 0.88,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            bounciness: 16,
            speed: 48,
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]);

    spin.start(({ finished }) => {
      if (finished && !cancelled) {
        setRotationDone(true);
      }
    });

    return () => {
      cancelled = true;
      spin.stop();
    };
  }, [backdropReady, rotation, scale]);

  useEffect(() => {
    if (!rotationDone || (!canFinish && !timedOut)) {
      return;
    }

    let cancelled = false;
    const reveal = Animated.parallel([
      Animated.timing(iconOpacity, {
        duration: 140,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(overlayScale, {
        bounciness: 7,
        speed: 20,
        toValue: 1.12,
        useNativeDriver: true,
      }),
      Animated.timing(appOpacity, {
        duration: 230,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(appScale, {
        bounciness: 8,
        speed: 22,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    reveal.start(({ finished }) => {
      if (finished && !cancelled) {
        setRevealDone(true);
      }
    });

    return () => {
      cancelled = true;
      reveal.stop();
    };
  }, [
    appOpacity,
    appScale,
    canFinish,
    iconOpacity,
    overlayOpacity,
    overlayScale,
    rotationDone,
    timedOut,
  ]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.root}>
      {children ? (
        <Animated.View
          pointerEvents={revealDone ? 'auto' : 'none'}
          style={[styles.appLayer, { opacity: appOpacity, transform: [{ scale: appScale }] }]}
        >
          {children}
        </Animated.View>
      ) : null}
      <Animated.View
        accessibilityLabel="Loading"
        pointerEvents={revealDone ? 'none' : 'box-only'}
        style={[styles.container, { opacity: overlayOpacity, transform: [{ scale: overlayScale }] }]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Image
            source={NIGHT_BACKDROP}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            onLoad={markBackdropReady}
            onError={markBackdropReady}
          />
        </Animated.View>
        {backdropReady ? (
          <>
            <SplashStars frame={frame} />
            <SplashMeteors />
          </>
        ) : null}
        <Animated.View
          style={{ opacity: iconOpacity, transform: [{ rotate }, { scale }, { scale: iconZoom }] }}
        >
          <ChatBubbleIcon size={iconSize} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: STARTUP_SPLASH_BACKGROUND,
  },
  appLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: STARTUP_SPLASH_BACKGROUND,
    justifyContent: 'center',
  },
});
