import { useAnnouncementSignalStore } from '../store-announcement-signal';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { fetchScrollingAnnouncements, type ScrollingAnnouncement } from '@/services/api/notifications';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

/** 公告只由服务端下发;新公告/切号靠 owner 失效。 */
const NO_TRACKED_WRITES = () => false;
const LOOP_GAP = 40;
const FADE_WIDTH = 16;

/** 滚动文字两端的渐隐,让字从卡片底色里淡入淡出,而不是被硬切。 */
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

export function ScrollingAnnouncements() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const announcementVersion = useAnnouncementSignalStore(state=>state.version);
  const accountKey = useAuthStore(state => `${state.user?.id ?? ''}:${state.sessionEpoch}`);
  const owner = `${accountKey}:${announcementVersion}`;
  const [data, setData] = useState<{ owner: string; items: ScrollingAnnouncement[] }>({owner, items: []});
  const [measurement, setMeasurement] = useState({ text: '', width: 0 });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [running, setRunning] = useState(false);
  const reduceMotion = useReduceMotion();
  const offset = useRef(new Animated.Value(0)).current;
  const items = data.owner === owner ? data.items : [];
  const current = items[0];
  const title = current ? current.title?.trim() || t('notifications.system') : '';
  const body = current ? current.content.replace(/\s+/g, ' ').trim() : '';
  const text = current ? `${title} ${body}` : '';
  // 「我的」是 tab 根,每次切 tab 都会聚焦;30 秒内、同账号、没有新公告就不重拉。
  // 停留期间仍按 60 秒轮询(定时器直接拉,不经闸门)。
  const bannerReloadGate = useFocusReloadGate({ key: owner, mutatedSince: NO_TRACKED_WRITES });

  useFocusEffect(useCallback(() => {
    let alive = true;
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      const startedAt = Date.now();
      try {
        const values = await fetchScrollingAnnouncements();
        if (alive) { setData({owner, items: values.slice(0,1)}); bannerReloadGate.markLoaded(startedAt); }
      } catch (error) {
        if (alive) { setData({owner, items: []}); reportHandledFailure('profile', 'scrollingAnnouncements', error); }
      } finally { fetching = false; }
    };
    const activate = () => { setRunning(AppState.currentState === 'active'); if (AppState.currentState === 'active' && !bannerReloadGate.shouldSkip()) void load(); };
    activate();
    const subscription = AppState.addEventListener('change', activate);
    const refresh = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 60000);
    return () => { alive = false; setRunning(false); clearInterval(refresh); subscription.remove(); };
  }, [bannerReloadGate, owner]));

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

  if (!current) return null;
  const canScroll = reduceMotion === false && viewportWidth > 0 && textWidth > viewportWidth;
  const line = (
    <>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{`  ${body}`}</Text>
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={() => router.push({pathname:'/(tabs)/profile/system-announcements/[id]',params:{id:current.notificationID}})}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: colors.surface, borderColor: withAlpha(colors.text, 0.06) },
        pressed && styles.barPressed,
      ]}
    >
      <View style={[styles.tag, { backgroundColor: colors.primary }]}>
        <Ionicons name="megaphone" size={12} color={colors.white} />
        <Text style={[styles.tagText, { color: colors.white }]} maxFontSizeMultiplier={1.2}>
          {t('profile.announcementTag', { defaultValue: '公告' })}
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
