import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

const BLINK_MIN_DELAY_MS = 2800;
const BLINK_JITTER_MS = 2400;
const ORBIT_SWEEP_MS = 1200;
const HOP_HEIGHT = 6;

export type AssistantSpriteMotion = {
  /** Eye scaleY: 1 open, dips briefly on each blink. */
  blink: Animated.Value;
  /** Mark translateY for the reply hop. */
  hop: Animated.Value;
  /** Orbit layer rotation for the reply sweep. */
  orbitRotate: Animated.AnimatedInterpolation<string>;
};

/**
 * Nothing loops here: the idle blink is a ~160ms squash every few seconds with
 * no frames in between, and the hop + orbit sweep play once per reply. Reduce
 * Motion (or a preference not yet read) turns all of it off.
 */
export function useAssistantSpriteMotion(
  reacting: boolean,
): AssistantSpriteMotion {
  const reduceMotion = useReduceMotion();
  const blink = useRef(new Animated.Value(1)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const orbitProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion !== false) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let squash: Animated.CompositeAnimation | null = null;
    const schedule = () => {
      timer = setTimeout(() => {
        squash = Animated.sequence([
          Animated.timing(blink, {
            toValue: 0.1,
            duration: 70,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(blink, {
            toValue: 1,
            duration: 90,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        squash.start(({ finished }) => {
          if (finished) schedule();
        });
      }, BLINK_MIN_DELAY_MS + Math.random() * BLINK_JITTER_MS);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      squash?.stop();
      blink.setValue(1);
    };
  }, [blink, reduceMotion]);

  // The caller holds `reacting` for longer than the sweep, so the cleanup that
  // runs when it drops back to false never cuts the animation short.
  useEffect(() => {
    if (!reacting || reduceMotion !== false) return;
    const reaction = Animated.parallel([
      Animated.timing(orbitProgress, {
        toValue: 1,
        duration: ORBIT_SWEEP_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(hop, {
          toValue: -HOP_HEIGHT,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(hop, {
          toValue: 0,
          friction: 4,
          tension: 140,
          useNativeDriver: true,
        }),
      ]),
    ]);
    reaction.start();
    return () => {
      reaction.stop();
      // A full turn lands where it started, so snapping back is invisible.
      orbitProgress.setValue(0);
      hop.setValue(0);
    };
  }, [hop, orbitProgress, reacting, reduceMotion]);

  const orbitRotate = orbitProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return { blink, hop, orbitRotate };
}
