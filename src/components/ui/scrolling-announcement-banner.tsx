import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Volume2 } from 'lucide-react-native';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

const LOOP_GAP = 40;
const FADE_WIDTH = 16;

function EdgeFade({ side, color }: { side: 'left' | 'right'; color: string }) {
  const id = `announcement-fade-${side}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const solidAt = side === 'left' ? 0 : 1;
  return (
    <View pointerEvents="none" style={[styles.fade, side === 'left' ? styles.fadeLeft : styles.fadeRight]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset={solidAt} stopColor={color} stopOpacity={1} />
            <Stop offset={1 - solidAt} stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Shared scrolling presentation for system and group announcements. */
export function ScrollingAnnouncementBanner({ title, body: content, tag, onPress, testID }: {
  title: string;
  body: string;
  tag: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const body = content.replace(/\s+/g, ' ').trim();
  const text = title ? `${title} ${body}` : body;
  const [measurement, setMeasurement] = useState({ text: '', width: 0 });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [running, setRunning] = useState(false);
  const reduceMotion = useReduceMotion();
  const offset = useRef(new Animated.Value(0)).current;
  useFocusEffect(useCallback(() => {
    const activate = () => setRunning(AppState.currentState === 'active');
    activate();
    const subscription = AppState.addEventListener('change', activate);
    return () => { setRunning(false); subscription.remove(); };
  }, []));

  const textWidth = measurement.text === text ? measurement.width : 0;
  useEffect(() => {
    offset.setValue(0);
    if (!running || reduceMotion !== false || !viewportWidth || !textWidth || textWidth <= viewportWidth) return;
    const distance = textWidth + LOOP_GAP;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(800),
      Animated.timing(offset, {toValue:-distance, duration:Math.max(3000, distance / 35 * 1000), easing:Easing.linear, useNativeDriver:true}),
    ]));
    animation.start();
    return () => {animation.stop();offset.setValue(0);};
  }, [offset, reduceMotion, running, textWidth, viewportWidth]);

  const canScroll = reduceMotion === false && viewportWidth > 0 && textWidth > viewportWidth;
  const line = (
    <>
      {title ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
      <Text style={[styles.body, { color: colors.textSecondary }]}>{`${title ? '  ' : ''}${body}`}</Text>
    </>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: colors.surface, borderColor: withAlpha(colors.text, 0.06) },
        pressed && styles.barPressed,
      ]}
    >
      <View style={[styles.tag, { backgroundColor: colors.primary }]}>
        <Volume2 size={14} strokeWidth={2} color={colors.white} />
        <Text style={[styles.tagText, { color: colors.white }]} maxFontSizeMultiplier={1.2}>
          {tag}
        </Text>
      </View>
      <View style={styles.viewport} onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}>
        <ScrollView horizontal scrollEnabled={reduceMotion === true} showsHorizontalScrollIndicator={false} style={styles.scroller} pointerEvents={reduceMotion === true ? 'auto' : 'none'}>
          <Animated.View style={[styles.track, { transform: [{ translateX: offset }] }]}>
            <Text
              key={text}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              onLayout={event => setMeasurement({text,width:Math.ceil(event.nativeEvent.layout.width)})}
              style={styles.line}
            >{line}</Text>
            {canScroll && <Text aria-hidden numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.line, styles.loopCopy]}>{line}</Text>}
          </Animated.View>
        </ScrollView>
        {canScroll ? (
          <>
            <EdgeFade side="left" color={colors.surface} />
            <EdgeFade side="right" color={colors.surface} />
          </>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 40,
    paddingLeft: Spacing.sm,
    paddingRight: 12,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  barPressed: { opacity: 0.72 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 24,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  tagText: { ...Typography.tiny, fontWeight: '700' },
  viewport: { flex: 1, overflow: 'hidden', minHeight: 24, justifyContent: 'center' },
  scroller: { flexGrow: 0 },
  track: { flexDirection: 'row', alignItems: 'center' },
  line: { flexShrink: 0 },
  loopCopy: { marginLeft: LOOP_GAP },
  title: { ...Typography.caption, fontWeight: '600' },
  body: { ...Typography.caption, fontWeight: '400' },
  fade: { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
});
