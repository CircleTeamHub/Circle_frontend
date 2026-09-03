import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
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
  notificationDomain,
  parseNotificationDomain,
  type NotificationDomain,
} from '@/features/notifications/utils/notification-domain';
import {
  mapNotificationToRow,
  type NotificationRowData,
} from '@/features/notifications/utils/notification-summary';
import { mapMyPostToRow } from '@/features/notifications/utils/my-post-summary';
import { getSnackbarRoute } from '@/features/notifications/utils/snackbar-route';
import {
  NotificationTabBar,
  type NotificationTabItem,
  type NotificationTabKey,
} from '@/features/notifications/components/NotificationTabBar';
import {
  ReadFilterBar,
  type ReadFilter,
} from '@/features/notifications/components/ReadFilterBar';
import { NotificationRow } from '@/features/notifications/components/NotificationRow';
import { NotificationEmptyState } from '@/features/notifications/components/NotificationEmptyState';
import { reportHandledFailure } from '@/observability/report-failure';

interface Row {
  raw: NotificationItem | MyCirclePost;
  view: NotificationRowData;
}

// 报名管理只属于圈子域；朋友圈铃铛不该出现这个 tab，也不该为它拉数据。
function hasSignupTab(domain: NotificationDomain | null): boolean {
  return domain !== 'moments';
}

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { domain: domainParam } = useLocalSearchParams<{ domain?: string }>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  // 铃铛的域由入口决定：朋友圈页 -> moments，广场页 -> circle。
  // 缺省（推送兜底页 /messages/notifications）保持不限域的老行为。
  const domain = useMemo(
    () => parseNotificationDomain(domainParam),
    [domainParam],
  );
  const showSignupTab = hasSignupTab(domain);

  const rawInteractive = useNotificationCenterStore((s) => s.interactive);
  // 报名通知（有人报名 CIRCLE_POST_SIGNUP_CREATED）已在「报名管理」以未读计数体现，
  // 互动消息里不再重复展示——否则同一件事两个 tab 各出现一次。
  const interactive = useMemo(
    () =>
      rawInteractive.filter(
        (n) =>
          n.type !== 'CIRCLE_POST_SIGNUP_CREATED' &&
          (!domain || notificationDomain(n.type) === domain),
      ),
    [rawInteractive, domain],
  );
  const signupPosts = useNotificationCenterStore((s) => s.signupPosts);
  const store = useNotificationCenterStore.getState;

  const [tab, setTab] = useState<NotificationTabKey>('notifications');
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
        fetchNotifications(1, domain),
        showSignupTab ? fetchAllMyCirclePosts() : Promise.resolve(null),
      ]);
      if (!mountedRef.current) return;

      let failed = false;
      if (notificationsResult.status === 'fulfilled') {
        store().setInteractiveForDomain(domain, notificationsResult.value);
      } else {
        failed = true;
        reportHandledFailure(
          'notificationCenter',
          'loadNotifications',
          notificationsResult.reason,
        );
      }

      if (postsResult.status === 'fulfilled') {
        if (postsResult.value) store().setSignupPosts(postsResult.value);
      } else {
        failed = true;
        reportHandledFailure(
          'notificationCenter',
          'loadSignupPosts',
          postsResult.reason,
        );
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
  }, [domain, showSignupTab, store, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const notificationsUnread = useMemo(
    () => interactive.some((n) => !n.read),
    [interactive],
  );
  const signupUnread = useMemo(
    () => signupPosts.some((p) => p.unreadSignupCount > 0),
    [signupPosts],
  );

  const title = t(
    domain === 'moments'
      ? 'notifications.momentsTitle'
      : domain === 'circle'
        ? 'notifications.circleTitle'
        : 'notifications.title',
  );

  const emptySubtitleKey =
    domain === 'moments'
      ? 'notifications.emptySubtitleMoments'
      : domain === 'circle'
        ? 'notifications.emptySubtitleCircle'
        : 'notifications.emptySubtitle';

  const tabs = useMemo<NotificationTabItem[]>(() => {
    const primary: NotificationTabItem = {
      key: 'notifications',
      label: t(
        domain === 'circle'
          ? 'notifications.tabCircleNotifications'
          : 'notifications.tabInteractive',
      ),
      unread: notificationsUnread,
    };
    if (!showSignupTab) return [primary];
    return [
      primary,
      {
        key: 'signups',
        label: t('notifications.tabSignups'),
        unread: signupUnread,
      },
    ];
  }, [domain, showSignupTab, notificationsUnread, signupUnread, t]);

  const rows = useMemo<Row[]>(() => {
    const mapped: Row[] =
      tab === 'notifications'
        ? interactive.map((n) => ({ raw: n, view: mapNotificationToRow(n, t) }))
        : signupPosts.map((p) => ({ raw: p, view: mapMyPostToRow(p, t) }));
    return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
  }, [tab, filter, interactive, signupPosts, t]);

  // 已读一条通知：总数和它所属域的计数都要减，否则另一个铃铛的红点会跟着掉。
  const decrementUnreadBadges = useCallback((type: string) => {
    const badgeStore = useTabBadgeStore.getState();
    badgeStore.setDiscoverUnread(Math.max(0, badgeStore.discoverUnread - 1));
    const itemDomain = notificationDomain(type);
    if (itemDomain === 'moments') {
      badgeStore.setMomentsUnread(Math.max(0, badgeStore.momentsUnread - 1));
    } else if (itemDomain === 'circle') {
      badgeStore.setCircleUnread(Math.max(0, badgeStore.circleUnread - 1));
    }
  }, []);

  const handleMarkAll = useCallback(async () => {
    if (tab === 'notifications') {
      const previousInteractive = store().interactive;
      const badgeStore = useTabBadgeStore.getState();
      const previousBadges = {
        discoverUnread: badgeStore.discoverUnread,
        momentsUnread: badgeStore.momentsUnread,
        circleUnread: badgeStore.circleUnread,
      };
      // 本地只有第一页，扣减可能少算；服务端 markAll 之后会推一条
      // interaction.unread.changed 把三个计数一起校准，这里只求即时手感。
      const clearedCount = previousInteractive.filter(
        (n) => !n.read && (!domain || notificationDomain(n.type) === domain),
      ).length;

      store().markDomainInteractiveReadLocal(domain);
      badgeStore.setDiscoverUnread(
        domain ? Math.max(0, previousBadges.discoverUnread - clearedCount) : 0,
      );
      if (!domain || domain === 'moments') badgeStore.setMomentsUnread(0);
      if (!domain || domain === 'circle') badgeStore.setCircleUnread(0);

      try {
        await markAllNotificationsRead(domain);
      } catch (error) {
        reportHandledFailure('notificationCenter', 'markAllRead', error);
        store().setInteractive(previousInteractive);
        const rollback = useTabBadgeStore.getState();
        rollback.setDiscoverUnread(previousBadges.discoverUnread);
        rollback.setMomentsUnread(previousBadges.momentsUnread);
        rollback.setCircleUnread(previousBadges.circleUnread);
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
      reportHandledFailure('notificationCenter', 'markAllSignupsRead', error);
      store().setSignupPosts(previousSignupPosts);
      useTabBadgeStore.getState().setSignupUnread(previousSignupUnread);
      await load();
    }
  }, [domain, load, tab, store]);

  const handleRowPress = useCallback(
    (raw: NotificationItem | MyCirclePost, view: NotificationRowData) => {
      if ('type' in raw) {
        store().markInteractiveReadLocal(raw.id);
        if (!raw.read) decrementUnreadBadges(raw.type);
        void markNotificationRead(raw.id).catch((e) =>
          reportHandledFailure('notificationCenter', 'markRead', e),
        );
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
    [store, router, t, notificationScope, decrementUnreadBadges],
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
          {title}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <NotificationTabBar active={tab} tabs={tabs} onSelect={setTab} />
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
            subtitle={
              loadError ??
              t(emptySubtitleKey)
            }
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
