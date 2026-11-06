import { useAnnouncementSignalStore } from '../store-announcement-signal';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { captureAuthSessionIdentity, isAuthSessionIdentityCurrent } from '@/stores/auth-session-identity';
import { getPageSnapshotRevision, readPageSnapshot, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { fetchScrollingAnnouncements, type ScrollingAnnouncement } from '@/services/api/notifications';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { reportHandledFailure } from '@/observability/report-failure';
import { ScrollingAnnouncementBanner } from '@/components/ui/scrolling-announcement-banner';

/** 公告只由服务端下发;新公告/切号靠 owner 失效。 */
const NO_TRACKED_WRITES = () => false;

export function ScrollingAnnouncements() {
  const sessionKey = useAuthStore(state => state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null);
  return sessionKey ? <ScrollingAnnouncementsContent key={sessionKey} /> : null;
}

function ScrollingAnnouncementsContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const announcementVersion = useAnnouncementSignalStore(state=>state.version);
  const accountKey = useAuthStore(state => `${state.user?.id ?? ''}:${state.sessionEpoch}`);
  const owner = `${accountKey}:${announcementVersion}`;
  // 外层已按账号换 key,这里的内容只属于当前账号。失效信号(重连补拉)不清空:旧横幅留到
  // 新结果回来再换,否则每次从后台回来都会先消失再出现(闪一下)。过期的响应由 isCurrent 挡掉。
  const [items, setItems] = useState<ScrollingAnnouncement[]>(
    () => readPageSnapshot<ScrollingAnnouncement[]>(useAuthStore.getState().user?.id, 'announcements:scrolling')?.value ?? [],
  );
  const current = items[0];
  const title = current ? current.title?.trim() || t('notifications.system') : '';
  const body = current ? current.content.replace(/\s+/g, ' ').trim() : '';
  // 「我的」是 tab 根,每次切 tab 都会聚焦;30 秒内、同账号、没有新公告就不重拉。
  // 停留期间仍按 60 秒轮询(定时器直接拉,不经闸门)。
  const bannerReloadGate = useFocusReloadGate({ key: owner, mutatedSince: NO_TRACKED_WRITES });

  useFocusEffect(useCallback(() => {
    let alive = true;
    let fetching = false;
    const identity = captureAuthSessionIdentity(useAuthStore.getState());
    if (!identity) return;
    const isCurrent = () => alive && isAuthSessionIdentityCurrent(identity, useAuthStore.getState()) &&
      useAnnouncementSignalStore.getState().version === announcementVersion;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      const startedAt = Date.now();
      const revision = getPageSnapshotRevision();
      try {
        const values = await fetchScrollingAnnouncements();
        if (isCurrent()) {
          const next = values.slice(0,1);
          setItems(next);
          if (getPageSnapshotRevision() === revision) writePageSnapshot(identity.userId, 'announcements:scrolling', next, startedAt);
          bannerReloadGate.markLoaded(startedAt);
        }
      } catch (error) {
        if (isAuthSessionIdentityCurrent(identity, useAuthStore.getState()) && isDefinitiveAuthFailure(error)) {
          removePageSnapshot(identity.userId, 'announcements:scrolling');
        }
        if (isCurrent()) {
          if (isDefinitiveAuthFailure(error)) setItems([]);
          reportHandledFailure('profile', 'scrollingAnnouncements', error);
        }
      } finally { fetching = false; }
    };
    const activate = () => { if (AppState.currentState === 'active' && !bannerReloadGate.shouldSkip()) void load(); };
    activate();
    const subscription = AppState.addEventListener('change', activate);
    const refresh = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 60000);
    return () => { alive = false; clearInterval(refresh); subscription.remove(); };
  }, [announcementVersion, bannerReloadGate]));

  if (!current) return null;
  return <ScrollingAnnouncementBanner title={title} body={body}
    tag={t('profile.announcementTag', { defaultValue: '公告' })}
    onPress={() => router.push({ pathname: '/(tabs)/profile/system-announcements/[id]', params: { id: current.notificationID } })} />;
}
