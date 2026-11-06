import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/** Unknown byte totals animate without claiming a percentage. */
export function MediaProgressBar({ percent }: { percent: number | null }) {
  const offset = useRef(new Animated.Value(0)).current;
  const indeterminate = percent === null;
  useEffect(() => {
    if (!indeterminate) return;
    offset.setValue(0);
    const animation = Animated.loop(Animated.timing(offset, {
      toValue: 1,
      duration: 1100,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [indeterminate, offset]);

  return (
    <View testID="media-progress-track" style={s.track}>
      {indeterminate ? (
        <Animated.View style={[s.fill, { width: 24, transform: [{ translateX: offset.interpolate({ inputRange: [0, 1], outputRange: [-24, 72] }) }] }]} />
      ) : <View style={[s.fill, { width: `${percent}%` }]} />}
    </View>
  );
}

const s = StyleSheet.create({
  track: { width: 72, height: 3, marginTop: 5, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { height: '100%', backgroundColor: '#fff' },
});
