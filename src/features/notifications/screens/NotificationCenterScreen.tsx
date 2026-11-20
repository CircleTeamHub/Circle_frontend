import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, usePathname, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';
import { Divider } from '@/components/ui/divider';
import {
  fetchNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/api/notifications';
import { markTraceLikeNotificationsRead } from '@/features/notifications/utils/seen-target';
import {
  fetchAllMyCirclePosts,
  markMyPostSignupsRead,
} from '@/services/api/plaza';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useAuthStore } from '@/stores/authStore';
import type { MyCirclePost, NotificationItem } from '@/types';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import {
  isNotificationInDomain,
  MEMBERSHIP_NOTICE_TYPES,
  notificationDomain,
  parseNotificationDomain,
  type NotificationDomain,
} from '@/features/notifications/utils/notification-domain';
import { decrementUnreadBadgesFor } from '@/features/notifications/utils/unread-badges';
import { NewFriendsShortcutRow } from '@/features/notifications/components/NewFriendsShortcutRow';
import { orderNotificationTabs } from '@/features/notifications/utils/notification-tabs';
import {
  groupTraceLikes,
  mapNotificationGroupToRow,
  type NotificationRowData,
} from '@/features/notifications/utils/notification-summary';
import { mapMyPostToRow } from '@/features/notifications/utils/my-post-summary';
import {
  getSnackbarRoute,
  isUserProfileSnackbarRoute,
} from '@/features/notifications/utils/snackbar-route';
import { isCurrentRoute } from '@/utils/current-route';
import {
  getCircleNotificationSettingsHref,
  getNewFriendsHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import {
  NotificationTabBar,
  type NoticeCategory,
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
import { usePullRefresh } from '@/hooks/use-pull-refresh';

interface Row {
  raw: NotificationItem | MyCirclePost;
  view: NotificationRowData;
}

// 报名管理只属于圈子域；朋友圈铃铛和消息页「通知」不该出现这个 tab，也不该为它拉数据。
function hasSignupTab(domain: NotificationDomain | null): boolean {
  return domain === 'circle' || domain === null;
}

function initialTab(domain: NotificationDomain | null): NotificationTabKey {
  if (domain === 'circle') return 'signups';
  if (domain === 'notice') return 'notice';
  return 'notifications';
}

const NOTICE_CATEGORIES: readonly NoticeCategory[] = ['notice', 'moments', 'group', 'system'];

function isNoticeCategory(tab: NotificationTabKey): tab is NoticeCategory {
  return (NOTICE_CATEGORIES as readonly string[]).includes(tab);
}

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ domain?: string }>();
  const domainParam = params.domain;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const ownerId = useAuthStore((state) =>
    state.isAuthenticated ? (state.user?.id ?? null) : null,
  );
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const mountedRef = useRef(true);
  const paginationEpochRef = useRef(0);
  const failedCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const [pageFailed, setPageFailed] = useState(false);

  // 铃铛的域由入口决定：朋友圈页 -> moments，广场页 / 飞机 -> circle，消息列表「通知」-> notice。
  // 缺省（推送兜底页 /messages/notifications）保持不限域的老行为。
  const domain = useMemo(
    () => parseNotificationDomain(domainParam),
    [domainParam],
  );
  const showSignupTab = hasSignupTab(domain);

  const [tab, setTab] = useState<NotificationTabKey>(() => initialTab(domain));
  const isListTab = tab !== 'signups';
  // 「通知」的四个分类各自是一个域（全部 = notice）；其余入口列表就是入口自己的域。
  const listDomain: NotificationDomain | null =
    domain === 'notice' && isNoticeCategory(tab) ? tab : domain;

  const rawInteractive = useNotificationCenterStore((s) => s.interactive);
  // 报名通知（有人报名 CIRCLE_POST_SIGNUP_CREATED）已在「报名管理」以未读计数体现，
  // 互动消息里不再重复展示——否则同一件事两个 tab 各出现一次。
  const interactive = useMemo(
    () =>
      rawInteractive.filter(
        (n) =>
          n.type !== 'CIRCLE_POST_SIGNUP_CREATED' &&
          isNotificationInDomain(n.type, listDomain),
      ),
    [rawInteractive, listDomain],
  );
  const signupPosts = useNotificationCenterStore((s) => s.signupPosts);
  const store = useNotificationCenterStore.getState;
  // 「通知」分类页签的红点读服务端计数：列表只拉了当前分类，拿行算会漏掉别的分类。
  const momentsUnread = useTabBadgeStore((s) => s.momentsUnread);
  const groupNoticeUnread = useTabBadgeStore((s) => s.groupNoticeUnread);
  const announcementsUnread = useTabBadgeStore((s) => s.profileUnread);
  const requestsUnread = useTabBadgeStore((s) => s.contactsUnread + s.groupAdmissionsUnread);
  const [filter, setFilter] = useState<ReadFilter>('all');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorScopeRef = useRef({ domain: listDomain, ownerId, sessionEpoch });
  const [loadError, setLoadError] = useState<string | null>(null);
  const notificationScope = getUserProfileScopeFromSegments(segments);
  const handleOpenCircleSettings = useCallback(() => {
    router.push(getCircleNotificationSettingsHref(getUserProfileScopeFromSegments(segments)));
  }, [router, segments]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; paginationEpochRef.current += 1; };
  }, []);

  const isCurrentSession = useCallback(() => {
    const auth = useAuthStore.getState();
    return mountedRef.current && Boolean(ownerId) && auth.isAuthenticated &&
      auth.user?.id === ownerId && auth.sessionEpoch === sessionEpoch;
  }, [ownerId, sessionEpoch]);

  const load = useCallback(async () => {
    if (!isCurrentSession()) return;
    const epoch = ++paginationEpochRef.current;
    failedCursorRef.current = null;
    loadingMoreRef.current = false;
    setPageFailed(false);
    setLoadingMore(false);
    // Cached rows keep their matching cursor until their replacement succeeds.
    // A domain change must not reuse a cursor belonging to another feed.
    const scope = cursorScopeRef.current;
    if (scope.domain !== listDomain || scope.ownerId !== ownerId ||
        scope.sessionEpoch !== sessionEpoch) {
      cursorScopeRef.current = { domain: listDomain, ownerId, sessionEpoch };
      setNextCursor(null);
      setLoadError(null);
    }
    setLoading(true);
    try {
      const [notificationsResult, postsResult] = await Promise.allSettled([
        fetchNotificationsPage(undefined, listDomain),
        showSignupTab ? fetchAllMyCirclePosts() : Promise.resolve(null),
      ]);
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;

      let failed = false;
      if (notificationsResult.status === 'fulfilled') {
        store().setInteractiveForDomain(
          listDomain,
          notificationsResult.value.items,
        );
        setNextCursor(notificationsResult.value.nextCursor);
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
      if (
        isCurrentSession() &&
        epoch === paginationEpochRef.current
      ) {
        setLoading(false);
      }
    }
  }, [listDomain, isCurrentSession, ownerId, sessionEpoch, showSignupTab, store, t]);

  const loadMore = useCallback(async () => {
    if (
      !isCurrentSession() ||
      !isListTab ||
      loadingMore ||
      loading ||
      !nextCursor ||
      loadingMoreRef.current ||
      failedCursorRef.current === nextCursor
    ) {
      return;
    }

    const epoch = paginationEpochRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchNotificationsPage(nextCursor, listDomain);
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      store().appendInteractivePage(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      failedCursorRef.current = nextCursor;
      setPageFailed(true);
      reportHandledFailure('notificationCenter', 'loadMoreNotifications', error);
    } finally {
      if (
        isCurrentSession() &&
        epoch === paginationEpochRef.current
      ) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [listDomain, isCurrentSession, isListTab, loading, loadingMore, nextCursor, store]);

  useEffect(() => {
    void load();
  }, [load]);

  // 打开页面的自动加载只走 loading;下拉刷新控件只跟下拉走,见 usePullRefresh。
  const pull = usePullRefresh(load);

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
        : domain === 'notice'
          ? 'notifications.notice.title'
          : 'notifications.title',
  );

  const emptySubtitleKey =
    domain === 'moments'
      ? 'notifications.emptySubtitleMoments'
      : domain === 'circle'
        ? 'notifications.emptySubtitleCircle'
        : domain === 'notice'
          ? 'notifications.notice.emptySubtitle'
          : 'notifications.emptySubtitle';

  const tabs = useMemo<NotificationTabItem[]>(() => {
    if (domain === 'notice') {
      const groupUnread = groupNoticeUnread + requestsUnread > 0;
      return [
        {
          key: 'notice',
          label: t('notifications.notice.tabAll'),
          unread: momentsUnread > 0 || groupUnread || announcementsUnread > 0,
        },
        { key: 'moments', label: t('notifications.notice.tabInteractive'), unread: momentsUnread > 0 },
        { key: 'group', label: t('notifications.notice.tabFriendsGroups'), unread: groupUnread },
        { key: 'system', label: t('notifications.notice.tabSystem'), unread: announcementsUnread > 0 },
      ];
    }
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
    const signups: NotificationTabItem = {
      key: 'signups',
      label: t('notifications.tabSignups'),
      unread: signupUnread,
    };
    return orderNotificationTabs(domain, { notifications: primary, signups });
  }, [
    domain,
    showSignupTab,
    notificationsUnread,
    signupUnread,
    momentsUnread,
    groupNoticeUnread,
    requestsUnread,
    announcementsUnread,
    t,
  ]);

  const rows = useMemo<Row[]>(() => {
    const mapped: Row[] =
      isListTab
        ? groupTraceLikes(interactive).map((group) => ({
            raw: group[0],
            view: mapNotificationGroupToRow(group, t),
          }))
        : signupPosts.map((p) => ({ raw: p, view: mapMyPostToRow(p, t) }));
    return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
  }, [isListTab, filter, interactive, signupPosts, t]);

  const handleMarkAll = useCallback(async () => {
    if (!isCurrentSession()) return;
    if (isListTab) {
      const previousInteractive = store().interactive;
      const badgeStore = useTabBadgeStore.getState();
      const previousBadges = {
        discoverUnread: badgeStore.discoverUnread,
        momentsUnread: badgeStore.momentsUnread,
        circleUnread: badgeStore.circleUnread,
        groupNoticeUnread: badgeStore.groupNoticeUnread,
        profileUnread: badgeStore.profileUnread,
      };
      // 本地只有第一页，扣减可能少算；服务端 markAll 之后会推一条
      // interaction.unread.changed 把计数一起校准，这里只求即时手感。
      // discoverUnread 只含两个铃铛的类型：群聊知会和公告不在里面。
      const clearedDiscoverCount = previousInteractive.filter((n) => {
        const home = notificationDomain(n.type);
        return !n.read && isNotificationInDomain(n.type, listDomain) &&
          (home === 'moments' || home === 'circle');
      }).length;
      const covers = (target: NotificationDomain) =>
        !listDomain || listDomain === target ||
        (listDomain === 'notice' && target !== 'circle');

      store().markDomainInteractiveReadLocal(listDomain);
      badgeStore.setDiscoverUnread(
        listDomain ? Math.max(0, previousBadges.discoverUnread - clearedDiscoverCount) : 0,
      );
      if (covers('moments')) badgeStore.setMomentsUnread(0);
      if (covers('circle')) badgeStore.setCircleUnread(0);
      // 不限域的兜底页沿用老口径：只清两个铃铛（服务端那边也不含群聊知会和公告）。
      if (listDomain && covers('group')) badgeStore.setGroupNoticeUnread(0);
      if (listDomain && covers('system')) badgeStore.setProfileUnread(0);

      try {
        await markAllNotificationsRead(listDomain);
      } catch (error) {
        if (!isCurrentSession()) return;
        reportHandledFailure('notificationCenter', 'markAllRead', error);
        store().setInteractive(previousInteractive);
        const rollback = useTabBadgeStore.getState();
        rollback.setDiscoverUnread(previousBadges.discoverUnread);
        rollback.setMomentsUnread(previousBadges.momentsUnread);
        rollback.setCircleUnread(previousBadges.circleUnread);
        rollback.setGroupNoticeUnread(previousBadges.groupNoticeUnread);
        rollback.setProfileUnread(previousBadges.profileUnread);
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
      if (!isCurrentSession()) return;
      reportHandledFailure('notificationCenter', 'markAllSignupsRead', error);
      store().setSignupPosts(previousSignupPosts);
      useTabBadgeStore.getState().setSignupUnread(previousSignupUnread);
      await load();
    }
  }, [listDomain, isCurrentSession, isListTab, load, store]);

  const handleRowPress = useCallback(
    (raw: NotificationItem | MyCirclePost, view: NotificationRowData) => {
      if (!isCurrentSession()) return;
      if ('type' in raw) {
        if (raw.type === 'TRACE_LIKE' && raw.fromTrace?.id) {
          void markTraceLikeNotificationsRead(raw.fromTrace.id);
        } else {
          store().markInteractiveReadLocal(raw.id);
          if (!raw.read) decrementUnreadBadgesFor(raw.type);
          void markNotificationRead(raw.id).catch((e) => {
            if (isCurrentSession())
              reportHandledFailure('notificationCenter', 'markRead', e);
          });
        }
        // 被移出 / 解散：群已经不在了，没有可去的地方，看过即可。
        if (MEMBERSHIP_NOTICE_TYPES.has(raw.type)) return;
        const route = getSnackbarRoute(
          { ...raw, kind: 'notification' },
          {
            untitledPost: t('notifications.signupMgmt.untitledPost'),
            scope: notificationScope,
          },
        );
        // 没有专属落点的通知会兜底回通知列表 —— 也就是这一页本身，标记已读就够了，
        // 再 push 会叠出第二个通知列表。
        if (isCurrentRoute({ pathname, params }, route)) return;
        if (isUserProfileSnackbarRoute(route)) {
          router.navigate(route);
        } else {
          router.push(route);
        }
        return;
      }
      // 报名管理: open the post's signer list. Opening it marks signups read
      // server-side, so zero the local badge optimistically.
      store().markPostSignupsSeenLocal(raw.id);
      router.push({
        pathname: `/(tabs)/${notificationScope}/post-signups`,
        params: { postId: raw.id, title: view.title },
      });
    },
    [store, router, t, notificationScope, pathname, params, isCurrentSession],
  );

  // 留在当前栈(消息栈也有一份「新的朋友」):跳去通讯录 tab 的话,返回停在通讯录首页。
  const handleOpenNewFriends = useCallback(() => {
    router.push(getNewFriendsHref(getUserProfileScopeFromSegments(segments)));
  }, [router, segments]);
  const showNewFriendsShortcut =
    domain === 'notice' && (tab === 'notice' || tab === 'group');

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
          {title}
        </Text>
        {/* 圈子通知设置就放在圈子通知页里；消息页飞机进来的同一页按当前栈跳，不甩去别的 tab。 */}
        {domain === 'circle' ? (
          <Pressable
            style={s.headerAction}
            onPress={handleOpenCircleSettings}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('discover.notifications.title')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <View style={s.headerAction} />
        )}
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
        ListHeaderComponent={showNewFriendsShortcut ? (
          <NewFriendsShortcutRow count={requestsUnread} onPress={handleOpenNewFriends} />
        ) : null}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{
          paddingHorizontal: Spacing.md,
          paddingBottom: 40,
        }}
        ListFooterComponent={<View>
          {loadError && rows.length > 0 ? <Pressable accessibilityRole="button"
            accessibilityLabel={t('common.retry')} onPress={() => void load()}
            style={{ padding: Spacing.lg, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary }}>{loadError}</Text>
          </Pressable> : null}
          {isListTab && pageFailed ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          onPress={() => { failedCursorRef.current = null; setPageFailed(false); void loadMore(); }}
          style={{ padding: Spacing.lg, alignItems: 'center' }}
        ><Text style={{ color: colors.iconAccent }}>{t('common.retry')}</Text></Pressable> : null}
          {isListTab && !pageFailed && loadingMore ? <ActivityIndicator color={colors.iconAccent} /> : null}</View>}
        ListEmptyComponent={loading && !pull.refreshing ? (
          <View style={s.loading} testID="notification-center-loading">
            <ActivityIndicator color={colors.iconAccent} />
          </View>
        ) : (
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
        )}
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
  // 和空状态的图标同一高度,加载完换成内容或空状态时不跳位。
  loading: { paddingTop: 80, alignItems: 'center' },
  headerAction: { width: 26, alignItems: 'flex-end' },
});
