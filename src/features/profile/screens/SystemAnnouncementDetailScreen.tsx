import { useAnnouncementSignalStore } from '../store-announcement-signal';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useSegments, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import {
  fetchProfileNotificationDetail,
  markNotificationRead,
} from '@/services/api/notifications';
import { reportHandledFailure } from '@/observability/report-failure';
import type { NotificationItem } from '@/types';

import { getNotificationCenterHref, getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
// 「我」页的公告列表;其余栈没有这个列表,兜底回本栈的通知列表。
const PROFILE_ANNOUNCEMENTS_HREF: Href = '/(tabs)/profile/system-announcements';

export default function SystemAnnouncementDetailScreen() {
  const scope = getUserProfileScopeFromSegments(useSegments());
  // 拆成 if 收敛推断:三元把两种 Href 合起来会触发 TS2590。
  let fallbackHref = PROFILE_ANNOUNCEMENTS_HREF;
  if (scope !== 'profile') fallbackHref = getNotificationCenterHref(scope);
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
      if (!active) return;
      setResult({key,item:value});
      if (!value.read) {
        void markNotificationRead(notificationId).catch(failure => {
          if (active) {
            reportHandledFailure('profile','announcementMarkRead',failure);
          }
        });
      }
    }).catch(failure => {
      if (active) {setError(true);reportHandledFailure('profile','announcementDetail',failure);}
    });
    return () => {active=false;};
  },[key,notificationId,retry]);

  return <View style={{flex:1,backgroundColor:colors.background,paddingTop:insets.top}}>
    <NavHeader title={t('systemAnnouncements.detailTitle')} fallbackHref={fallbackHref} />
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
