import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  buildFriendActivityInboxRows,
  getFriendActivityCopy,
  getFriendActivityDisplayName,
} from '@/features/contacts/friend-activities';
import { getFriendActivityDetailHref } from '@/features/user/utils/routes';
import {
  fetchFriendActivities,
  markFriendActivityRead,
  type FriendActivity,
} from '@/services/api/friends';
import { Spacing, Typography, useTheme } from '@/theme';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const s = StyleSheet.create({
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
  const [activities, setActivities] = useState<FriendActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);

  const loadActivities = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);

    try {
      const nextActivities = await fetchFriendActivities();
      if (signal?.cancelled) return;
      setActivities(nextActivities);
      setError(null);
    } catch {
      if (signal?.cancelled) return;
      setError('好友动态加载失败，请稍后重试');
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    loadActivities(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadActivities]);

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
    }),
    [colors],
  );

  const inboxRows = useMemo(
    () => buildFriendActivityInboxRows(activities),
    [activities],
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
                    markFriendActivityRead(activityId).catch(() => {}),
                  ),
                );
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
            <Text style={d.title}>
              {getFriendActivityDisplayName(item.activity)}
            </Text>
            <Text style={d.subtitle}>{getFriendActivityCopy(item.activity)}</Text>
            <Text style={d.time}>
              {new Date(item.activity.createdAt).toLocaleString('zh-CN')}
            </Text>
          </View>
          {item.unreadActivityIds.length > 0 ? (
            <View style={[s.unreadDot, d.unreadDot]} />
          ) : null}
        </Pressable>
        {index < inboxRows.length - 1 ? <Divider /> : null}
      </View>
    ),
    [d, inboxRows.length, navigating, router],
  );

  const emptyState = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>正在加载好友动态...</Text>
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
        <Text style={d.retryButtonText}>重试</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>还没有好友动态</Text>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="新的朋友" />
      <FlatList
        data={inboxRows}
        keyExtractor={(item) => item.activity.counterparty.id}
        renderItem={renderItem}
        ListEmptyComponent={emptyState}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
