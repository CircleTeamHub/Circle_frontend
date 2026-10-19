import { useAnnouncementSignalStore } from '../store-announcement-signal';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { fetchProfileNotificationDetail } from '@/services/api/notifications';
import { reportHandledFailure } from '@/observability/report-failure';
import type { NotificationItem } from '@/types';

export default function SystemAnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const notificationId = Array.isArray(id) ? id[0] : id;
  const owner = useAuthStore(state => `${state.user?.id ?? ''}:${state.sessionEpoch}`);
  const [result, setResult] = useState<{key: string; item: NotificationItem} | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const announcementVersion = useAnnouncementSignalStore(state=>state.version);
  const key = `${owner}:${notificationId ?? ''}:${announcementVersion}`;
  const item = result?.key === key ? result.item : null;
  useEffect(() => {
    let active = true;
    setResult(null);setError(false);
    if (!notificationId) { setError(true); return; }
    void fetchProfileNotificationDetail(notificationId).then(value => {
      if (active) setResult({key,item:value});
    }).catch(failure => {
      if (active) {setError(true);reportHandledFailure('profile','announcementDetail',failure);}
    });
    return () => {active=false;};
  },[key,notificationId,retry]);

  return <View style={{flex:1,backgroundColor:colors.background,paddingTop:insets.top}}>
    <NavHeader title={t('systemAnnouncements.detailTitle')} fallbackHref="/(tabs)/profile/system-announcements" />
    <ScrollView contentContainerStyle={{padding:Spacing.lg,paddingBottom:insets.bottom+Spacing.xl,gap:Spacing.md}}>
      {item ? <>
        <Text selectable style={{color:colors.text,fontSize:24,lineHeight:32,fontWeight:'700'}}>{item.title?.trim() || t('notifications.system')}</Text>
        <Text style={{color:colors.textSecondary,fontSize:13}}>{new Date(item.createdAt).toLocaleString()}</Text>
        <Text selectable style={{color:colors.text,fontSize:16,lineHeight:26}}>{item.content}</Text>
      </> : error ? <>
        <Text style={{color:colors.textSecondary}}>{t('systemAnnouncements.unavailable')}</Text>
        <Pressable accessibilityRole="button" onPress={()=>setRetry(value=>value+1)}><Text style={{color:colors.primary}}>{t('common.retry')}</Text></Pressable>
      </> : <Text style={{color:colors.textSecondary}}>{t('common.loading')}</Text>}
    </ScrollView>
  </View>;
}
