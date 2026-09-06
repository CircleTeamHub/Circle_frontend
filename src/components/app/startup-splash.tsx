import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { ChatBubbleIcon } from '@/components/app/chat-bubble-icon';

const STARTUP_SPLASH_BACKGROUND = '#FFFFFF';
const STARTUP_ICON_SIZE = 165;
const STARTUP_SPLASH_MAX_WAIT_MS = 5000;

type StartupSplashProps = {
  canFinish?: boolean;
  children?: ReactNode;
};

/**
 * JS 启动完成后展示的短动画。
 * 原生启动图只能提供静态画面，旋转在这里执行，避免首屏直接闪现。
 */
export function StartupSplash({ canFinish = true, children }: StartupSplashProps) {
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
  }, [rotation, scale]);

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
        <Animated.View style={{ opacity: iconOpacity, transform: [{ rotate }, { scale }] }}>
          <ChatBubbleIcon size={STARTUP_ICON_SIZE} />
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
