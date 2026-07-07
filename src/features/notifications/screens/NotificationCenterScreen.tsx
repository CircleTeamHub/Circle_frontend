import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';
import { Divider } from '@/components/ui/divider';
import {
  deleteNotification,
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
import { getSnackbarRoute } from '@/features/notifications/utils/snackbar-route';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
const PAGE_SIZE = 20;

interface Row {
  raw: NotificationItem | MyCirclePost;
  view: NotificationRowData;
}

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const interactive = useNotificationCenterStore((s) => s.interactive);
  const signupPosts = useNotificationCenterStore((s) => s.signupPosts);
  const store = useNotificationCenterStore.getState;

  const [tab, setTab] = useState<NotificationTabKey>('interactive');
  const [filter, setFilter] = useState<ReadFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [interactivePage, setInteractivePage] = useState(1);
  const [interactiveHasMore, setInteractiveHasMore] = useState(true);
  const [loadingMoreInteractive, setLoadingMoreInteractive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        setInteractivePage(1);
        setInteractiveHasMore(notificationsResult.value.length >= PAGE_SIZE);
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

  const loadMoreInteractive = useCallback(async () => {
    if (
      tab !== 'interactive' ||
      loadingMoreInteractive ||
      refreshing ||
      !interactiveHasMore
    ) {
      return;
    }

    const nextPage = interactivePage + 1;
    setLoadingMoreInteractive(true);
    try {
      const nextItems = await fetchNotifications(nextPage);
      if (!mountedRef.current) return;
      store().appendInteractivePage(nextItems);
      setInteractivePage(nextPage);
      setInteractiveHasMore(nextItems.length >= PAGE_SIZE);
    } catch (error) {
      reportNotificationFailure('notification_load_more_failed', error, {
        page: nextPage,
      });
      if (mountedRef.current) {
        setLoadError(
          t('notifications.loadFailed', {
            defaultValue: '部分消息加载失败，请下拉重试',
          }),
        );
      }
    } finally {
      if (mountedRef.current) setLoadingMoreInteractive(false);
    }
  }, [
    interactiveHasMore,
    interactivePage,
    loadingMoreInteractive,
    refreshing,
    store,
    tab,
    t,
  ]);

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
      store().markAllInteractiveReadLocal();
      try {
        await markAllNotificationsRead();
      } catch (error) {
        reportNotificationFailure('notification_mark_all_read_failed', error);
        store().setInteractive(previousInteractive);
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
    (row: Row) => {
      const { raw, view } = row;
      if (tab === 'interactive') {
        const notification = raw as NotificationItem;
        store().markInteractiveReadLocal(notification.id);
        void markNotificationRead(notification.id).catch((e) => isDev && console.warn(e));
        logClientDiagnostic('notification_open', {
          source: 'notification_center',
          notificationId: notification.id,
        });
        router.push(
          getSnackbarRoute(
            { ...notification, kind: 'notification' },
            {
              untitledPost: t('notifications.signupMgmt.untitledPost'),
            },
          ),
        );
        return;
      }
      // 报名管理: open the post's signer list. Opening it marks signups read
      // server-side, so zero the local badge optimistically.
      store().markPostSignupsSeenLocal(view.id);
      router.push({
        pathname: '/(tabs)/messages/post-signups',
        params: { postId: view.id, title: view.title },
      });
    },
    [tab, store, router, t],
  );

  const handleRowMarkRead = useCallback(
    async (row: Row) => {
      if (tab !== 'interactive' || !row.view.unread) return;
      const notification = row.raw as NotificationItem;
      const previousInteractive = store().interactive;
      store().markInteractiveReadLocal(notification.id);
      try {
        await markNotificationRead(notification.id);
      } catch (error) {
        reportNotificationFailure('notification_mark_read_failed', error, {
          notificationId: notification.id,
        });
        store().setInteractive(previousInteractive);
        await load();
      }
    },
    [load, store, tab],
  );

  const handleRowDelete = useCallback(
    (row: Row) => {
      if (tab !== 'interactive') return;
      const notification = row.raw as NotificationItem;
      Alert.alert(t('common.delete'), row.view.title, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const previousInteractive = store().interactive;
            store().removeInteractiveLocal(notification.id);
            try {
              await deleteNotification(notification.id);
            } catch (error) {
              reportNotificationFailure('notification_delete_failed', error, {
                notificationId: notification.id,
              });
              store().setInteractive(previousInteractive);
              await load();
            }
          },
        },
      ]);
    },
    [load, store, t, tab],
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
            onPress={() => handleRowPress(item)}
            onMarkRead={
              tab === 'interactive' && item.view.unread
                ? () => void handleRowMarkRead(item)
                : undefined
            }
            onDelete={
              tab === 'interactive' ? () => handleRowDelete(item) : undefined
            }
          />
        )}
        ItemSeparatorComponent={Divider}
        onEndReached={loadMoreInteractive}
        onEndReachedThreshold={0.4}
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
