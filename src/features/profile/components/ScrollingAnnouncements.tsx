import { useAnnouncementSignalStore } from '../store-announcement-signal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { fetchScrollingAnnouncements, type ScrollingAnnouncement } from '@/services/api/notifications';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTheme, withAlpha } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

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
  const text = current ? `${current.title?.trim() || t('notifications.system')}：${current.content.replace(/\s+/g, ' ').trim()}` : '';

  useFocusEffect(useCallback(() => {
    let alive = true;
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const values = await fetchScrollingAnnouncements();
        if (alive) { setData({owner, items: values.slice(0,1)}); }
      } catch (error) {
        if (alive) { setData({owner, items: []}); reportHandledFailure('profile', 'scrollingAnnouncements', error); }
      } finally { fetching = false; }
    };
    const activate = () => { setRunning(AppState.currentState === 'active'); if (AppState.currentState === 'active') void load(); };
    activate();
    const subscription = AppState.addEventListener('change', activate);
    const refresh = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 60000);
    return () => { alive = false; setRunning(false); clearInterval(refresh); subscription.remove(); };
  }, [owner]));

  const textWidth = measurement.text === text ? measurement.width : 0;
  useEffect(() => {
    offset.setValue(0);
    if (!running || reduceMotion !== false || !viewportWidth || !textWidth || textWidth <= viewportWidth) return;
    const distance = textWidth + 40;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(800),
      Animated.timing(offset, {toValue:-distance, duration:Math.max(3000, distance / 35 * 1000), easing:Easing.linear, useNativeDriver:true}),
    ]));
    animation.start();
    return () => {animation.stop();offset.setValue(0);};
  }, [offset, reduceMotion, running, textWidth, viewportWidth]);

  if (!current) return null;
  const canScroll = reduceMotion === false && viewportWidth > 0 && textWidth > viewportWidth;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={() => router.push({pathname:'/(tabs)/profile/system-announcements/[id]',params:{id:current.notificationID}})}
      style={{flexDirection:'row',alignItems:'center',gap:8,borderRadius:12,paddingHorizontal:10,paddingVertical:7,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.surfaceBorder}}
    >
      <View style={{width:24,height:24,borderRadius:8,backgroundColor:withAlpha(colors.primary,0.1),alignItems:'center',justifyContent:'center'}}>
        <Ionicons name="notifications-outline" size={15} color={colors.primary} />
      </View>
      <View style={{flex:1,overflow:'hidden',minHeight:24,justifyContent:'center'}} onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}>
        <ScrollView horizontal scrollEnabled={reduceMotion === true} showsHorizontalScrollIndicator={false} style={{flexGrow:0}} pointerEvents={reduceMotion === true ? 'auto' : 'none'}>
          <Animated.View style={{flexDirection:'row',alignItems:'center',transform:[{translateX:offset}]}}>
            <Text
              key={text}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              onLayout={event => setMeasurement({text,width:Math.ceil(event.nativeEvent.layout.width)})}
              style={{color:colors.text,fontSize:13,fontWeight:'600',flexShrink:0}}
            >{text}</Text>
            {canScroll && <Text aria-hidden numberOfLines={1} maxFontSizeMultiplier={1.3} style={{color:colors.text,fontSize:13,fontWeight:'600',flexShrink:0,marginLeft:40}}>{text}</Text>}
          </Animated.View>
        </ScrollView>
      </View>
      <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} />
    </Pressable>
  );
}
