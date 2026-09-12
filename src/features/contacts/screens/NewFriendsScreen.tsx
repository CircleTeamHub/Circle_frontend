import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { InboxTabsHeader } from '@/features/contacts/components/InboxTabsHeader';
import { NewGroupsInboxList } from '@/features/contacts/components/NewGroupsInboxList';
import { filterFriendInboxRows } from '@/features/contacts/utils/friend-inbox-filter';
import {
  buildFriendActivityInboxRows,
  getFriendActivityCopy,
  getFriendActivityDisplayName,
} from '@/features/contacts/friend-activities';
import { getFriendActivityDetailHref } from '@/features/user/utils/routes';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import {
  fetchFriendActivities,
  markFriendActivityRead,
  type FriendActivity,
} from '@/services/api/friends';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { Spacing, Typography, useTheme } from '@/theme';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  // 页签、搜索框和列表同住一张白面板上，面板上缘圆角。
  panel: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
  },
  rowMeta: {
    flex: 1,
    gap: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  retryButton: {
    minWidth: 96,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
});

export default function NewFriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const [activities, setActivities] = useState<FriendActivity[]>([]);
  // 页签是主轴：好友动态和入圈申请是两批数据、两套接口，分开收才不会互相淹没。
  const [activeTab, setActiveTab] = useState<'friends' | 'groups'>('friends');
  // 关键词跨页签保留：用户常常只记得名字、不记得那是个人还是圈子。
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const markRead = useFriendActivityUnreadStore((state) => state.markRead);
  const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore(
    (state) => state.refresh,
  );

  const loadActivities = useCallback(async (signal?: { cancelled: boolean }) => {
    const isCancelled = () => Boolean(signal?.cancelled) || !mountedRef.current;
    setLoading(true);

    try {
      const nextActivities = await fetchFriendActivities();
      if (isCancelled()) return;
      setActivities(nextActivities);
      setError(null);
    } catch {
      if (isCancelled()) return;
      setError(t('contacts.friendActivity.loadFailed'));
    } finally {
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    const signal = { cancelled: false };
    loadActivities(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadActivities]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshUnreadFriendActivityCount();
      void markMatchingTargetNotificationsRead({ friendRequests: true });
    }, [refreshUnreadFriendActivityCount]),
  );

  const handleRefreshActivities = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([loadActivities(), refreshUnreadFriendActivityCount()]);
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadActivities, refreshUnreadFriendActivityCount]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '500' as const,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      time: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      unreadDot: {
        backgroundColor: colors.error,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      retryButton: {
        backgroundColor: colors.primary,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      panel: {
        backgroundColor: colors.surface,
      },
    }),
    [colors],
  );

  const inboxRows = useMemo(
    () => filterFriendInboxRows(buildFriendActivityInboxRows(activities), query),
    [activities, query],
  );

  const renderItem = useCallback(
    ({
      item,
      index,
    }: {
      item: ReturnType<typeof buildFriendActivityInboxRows>[number];
      index: number;
    }) => (
      <View>
        <Pressable
          style={s.row}
          disabled={navigating}
          onPress={async () => {
            if (navigating) return;
            setNavigating(true);
            try {
              if (item.unreadActivityIds.length > 0) {
                await Promise.all(
                  item.unreadActivityIds.map((activityId) =>
                    markFriendActivityRead(activityId).catch((error) => {
                      reportHandledFailure('friendActivity', 'markRead', error);
                    }),
                  ),
                );
                markRead(item.unreadActivityIds);
                setActivities((current) =>
                  current.map((activity) =>
                    item.unreadActivityIds.includes(activity.id)
                      ? { ...activity, readAt: new Date().toISOString() }
                      : activity,
                  ),
                );
              }
              router.push(getFriendActivityDetailHref(item.activity.id));
            } finally {
              setNavigating(false);
            }
          }}
        >
          <Avatar
            size={44}
            name={getFriendActivityDisplayName(item.activity)}
            uri={item.activity.counterparty.avatarUrl ?? undefined}
          />
          <View style={s.rowMeta}>
            <MemberName
              name={getFriendActivityDisplayName(item.activity)}
              userId={item.activity.counterparty.id}
              style={d.title}
            />
            <Text style={d.subtitle}>{getFriendActivityCopy(item.activity)}</Text>
            <Text style={d.time}>
              {new Date(item.activity.createdAt).toLocaleString(
                getLocalizedDateTimeLocale(i18n.language),
              )}
            </Text>
          </View>
          {item.unreadActivityIds.length > 0 ? (
            <View style={[s.unreadDot, d.unreadDot]} />
          ) : null}
        </Pressable>
        {index < inboxRows.length - 1 ? <Divider /> : null}
      </View>
    ),
    [d, i18n.language, inboxRows.length, markRead, navigating, router],
  );

  const emptyState = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.friendActivity.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable
        style={[s.retryButton, d.retryButton]}
        onPress={() => {
          void loadActivities();
        }}
      >
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>
        {query.trim()
          ? t('contacts.friendActivity.noMatches')
          : t('contacts.friendActivity.empty')}
      </Text>
    </View>
  );

  const tabs = useMemo(
    () => [
      { id: 'friends' as const, label: t('contacts.friendActivity.tabFriends') },
      { id: 'groups' as const, label: t('contacts.friendActivity.tabGroups') },
    ],
    [t],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('contacts.friendActivity.title')}
        // 深链/推送直接落到这屏时栈里没有上一级，router.back() 会退到上一个 tab
        // （用户看到的是「退出后到了消息页」）。给个上级页面兜底。
        fallbackHref="/(tabs)/contacts"
      />
      <View style={[s.panel, d.panel]}>
        <InboxTabsHeader
          tabs={tabs}
          activeId={activeTab}
          onSelect={(id) => setActiveTab(id === 'groups' ? 'groups' : 'friends')}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={t('contacts.friendActivity.searchPlaceholder')}
        />
        {activeTab === 'groups' ? (
          <NewGroupsInboxList query={query} />
        ) : (
          <FlatList
            data={inboxRows}
            keyExtractor={(item) => item.activity.counterparty.id}
            renderItem={renderItem}
            ListEmptyComponent={emptyState}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={handleRefreshActivities}
          />
        )}
      </View>
    </View>
  );
}
