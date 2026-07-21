import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';
import { Divider } from '@/components/ui/divider';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/api/notifications';
import {
  fetchAllMyCirclePosts,
  markMyPostSignupsRead,
} from '@/services/api/plaza';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import type { MyCirclePost, NotificationItem } from '@/types';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import {
  mapNotificationToRow,
  type NotificationRowData,
} from '@/features/notifications/utils/notification-summary';
import { mapMyPostToRow } from '@/features/notifications/utils/my-post-summary';
import { getSnackbarRoute } from '@/features/notifications/utils/snackbar-route';
import {
  NotificationTabBar,
  type NotificationTabKey,
} from '@/features/notifications/components/NotificationTabBar';
import {
  ReadFilterBar,
  type ReadFilter,
} from '@/features/notifications/components/ReadFilterBar';
import { NotificationRow } from '@/features/notifications/components/NotificationRow';
import { NotificationEmptyState } from '@/features/notifications/components/NotificationEmptyState';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

interface Row {
  raw: NotificationItem | MyCirclePost;
  view: NotificationRowData;
}

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const rawInteractive = useNotificationCenterStore((s) => s.interactive);
  // 报名通知（有人报名 CIRCLE_POST_SIGNUP_CREATED）已在「报名管理」以未读计数体现，
  // 互动消息里不再重复展示——否则同一件事两个 tab 各出现一次。
  const interactive = useMemo(
    () =>
      rawInteractive.filter((n) => n.type !== 'CIRCLE_POST_SIGNUP_CREATED'),
    [rawInteractive],
  );
  const signupPosts = useNotificationCenterStore((s) => s.signupPosts);
  const store = useNotificationCenterStore.getState;

  const [tab, setTab] = useState<NotificationTabKey>('interactive');
  const [filter, setFilter] = useState<ReadFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const notificationScope = (segments as readonly string[]).includes('discover')
    ? 'discover'
    : 'messages';

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [notificationsResult, postsResult] = await Promise.allSettled([
        fetchNotifications(1),
        fetchAllMyCirclePosts(),
      ]);
      if (!mountedRef.current) return;

      let failed = false;
      if (notificationsResult.status === 'fulfilled') {
        store().setInteractive(notificationsResult.value);
      } else {
        failed = true;
        if (isDev) {
          console.warn(
            '[NotificationCenterScreen] load notifications failed',
            notificationsResult.reason,
          );
        }
      }

      if (postsResult.status === 'fulfilled') {
        store().setSignupPosts(postsResult.value);
      } else {
        failed = true;
        if (isDev) {
          console.warn(
            '[NotificationCenterScreen] load signup posts failed',
            postsResult.reason,
          );
        }
      }

      setLoadError(
        failed
          ? t('notifications.loadFailed', {
              defaultValue: '部分消息加载失败，请下拉重试',
            })
          : null,
      );
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [store, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const interactiveUnread = useMemo(
    () => interactive.some((n) => !n.read),
    [interactive],
  );
  const circleUnread = useMemo(
    () => signupPosts.some((p) => p.unreadSignupCount > 0),
    [signupPosts],
  );

  const rows = useMemo<Row[]>(() => {
    const mapped: Row[] =
      tab === 'interactive'
        ? interactive.map((n) => ({ raw: n, view: mapNotificationToRow(n, t) }))
        : signupPosts.map((p) => ({ raw: p, view: mapMyPostToRow(p, t) }));
    return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
  }, [tab, filter, interactive, signupPosts, t]);

  const handleMarkAll = useCallback(async () => {
    if (tab === 'interactive') {
      const previousInteractive = store().interactive;
      const previousDiscoverUnread = useTabBadgeStore.getState().discoverUnread;
      store().markAllInteractiveReadLocal();
      useTabBadgeStore.getState().setDiscoverUnread(0);
      try {
        await markAllNotificationsRead();
      } catch (error) {
        if (isDev) console.warn('[NotificationCenterScreen] mark all failed', error);
        store().setInteractive(previousInteractive);
        useTabBadgeStore.getState().setDiscoverUnread(previousDiscoverUnread);
        await load();
      }
      return;
    }

    const previousSignupPosts = store().signupPosts;
    const previousSignupUnread = useTabBadgeStore.getState().signupUnread;
    const unreadPostIds = previousSignupPosts
      .filter((p) => p.unreadSignupCount > 0)
      .map((p) => p.id);
    if (unreadPostIds.length === 0) return;

    store().markAllSignupsSeenLocal();
    useTabBadgeStore.getState().setSignupUnread(0);
    try {
      await Promise.all(unreadPostIds.map((id) => markMyPostSignupsRead(id)));
    } catch (error) {
      if (isDev) console.warn('[NotificationCenterScreen] mark all signups failed', error);
      store().setSignupPosts(previousSignupPosts);
      useTabBadgeStore.getState().setSignupUnread(previousSignupUnread);
      await load();
    }
  }, [load, tab, store]);

  const handleRowPress = useCallback(
    (raw: NotificationItem | MyCirclePost, view: NotificationRowData) => {
      if ('type' in raw) {
        store().markInteractiveReadLocal(raw.id);
        if (!raw.read) {
          const badgeStore = useTabBadgeStore.getState();
          badgeStore.setDiscoverUnread(
            Math.max(0, badgeStore.discoverUnread - 1),
          );
        }
        void markNotificationRead(raw.id).catch((e) => isDev && console.warn(e));
        const route = getSnackbarRoute(
          { ...raw, kind: 'notification' },
          {
            untitledPost: t('notifications.signupMgmt.untitledPost'),
            scope: notificationScope,
          },
        );
        router.push(route);
        return;
      }
      // 报名管理: open the post's signer list. Opening it marks signups read
      // server-side, so zero the local badge optimistically.
      store().markPostSignupsSeenLocal(raw.id);
      router.push({
        pathname:
          notificationScope === 'discover'
            ? '/(tabs)/discover/post-signups'
            : '/(tabs)/messages/post-signups',
        params: { postId: raw.id, title: view.title },
      });
    },
    [store, router, t, notificationScope],
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
          {t('notifications.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <NotificationTabBar
        active={tab}
        interactiveUnread={interactiveUnread}
        circleUnread={circleUnread}
        labels={{
          interactive: t('notifications.tabInteractive'),
          circle: t('notifications.tabCircle'),
        }}
        onSelect={setTab}
      />
      <ReadFilterBar
        filter={filter}
        labels={{
          all: t('notifications.filterAll'),
          unread: t('notifications.filterUnread'),
          markAll: t('notifications.markAllRead'),
        }}
        onSelect={setFilter}
        onMarkAll={handleMarkAll}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.view.id}
        renderItem={({ item }) => (
          <NotificationRow
            data={item.view}
            onPress={() => handleRowPress(item.raw, item.view)}
          />
        )}
        ItemSeparatorComponent={Divider}
        refreshing={refreshing}
        onRefresh={load}
        contentContainerStyle={{
          paddingHorizontal: Spacing.md,
          paddingBottom: 40,
        }}
        ListEmptyComponent={
          <NotificationEmptyState
            title={
              loadError
                ? t('notifications.loadFailedTitle', {
                    defaultValue: '加载失败',
                  })
                : t('notifications.emptyTitle')
            }
            subtitle={loadError ?? t('notifications.emptySubtitle')}
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
