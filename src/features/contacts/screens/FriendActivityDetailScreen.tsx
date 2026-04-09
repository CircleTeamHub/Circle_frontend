import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import {
  canHandleFriendActivity,
  getFriendActivityCopy,
  getFriendActivityDisplayName,
} from '@/features/contacts/friend-activities';
import {
  acceptFriendRequest,
  fetchFriendActivityDetail,
  markFriendActivityRead,
  rejectFriendRequest,
  type FriendActivity,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  profileMeta: {
    flex: 1,
    gap: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
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

export default function FriendActivityDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const [activity, setActivity] = useState<FriendActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [handling, setHandling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activityId = typeof params.id === 'string' ? params.id : '';

  const loadActivity = useCallback(
    (signal?: { cancelled: boolean }) => {
      if (!activityId) {
        setError('好友动态不存在');
        setLoading(false);
        return Promise.resolve();
      }

      setLoading(true);

      return markFriendActivityRead(activityId)
        .catch(() => {
          // mark-read failures are non-critical — continue loading detail
        })
        .then(() => fetchFriendActivityDetail(activityId))
        .then((nextActivity) => {
          if (signal?.cancelled) return;
          setActivity(nextActivity);
          setError(null);
        })
        .catch(() => {
          if (signal?.cancelled) return;
          setError('好友动态详情加载失败，请稍后重试');
        })
        .finally(() => {
          if (signal?.cancelled) return;
          setLoading(false);
        });
    },
    [activityId],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    loadActivity(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadActivity]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      card: {
        backgroundColor: colors.surface,
      },
      title: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      time: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      messageLabel: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      messageText: {
        color: colors.text,
        ...Typography.bodyRegular,
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
      acceptButton: {
        backgroundColor: colors.primary,
      },
      rejectButton: {
        backgroundColor: colors.surfaceBorder,
      },
      acceptButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      rejectButtonText: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.top],
  );

  const handleDecision = useCallback(
    async (decision: 'accept' | 'reject') => {
      if (!activity || handling) {
        return;
      }

      setHandling(true);

      try {
        if (decision === 'accept') {
          await acceptFriendRequest(activity.requestId);
          setActivity((current) =>
            current ? { ...current, requestState: 'ACCEPTED' } : current,
          );
          Alert.alert('已接受', '你已通过这条好友申请。');
        } else {
          await rejectFriendRequest(activity.requestId);
          setActivity((current) =>
            current ? { ...current, requestState: 'REJECTED' } : current,
          );
          Alert.alert('已拒绝', '你已拒绝这条好友申请。');
        }
      } catch (nextError) {
        Alert.alert(
          '处理失败',
          nextError instanceof Error ? nextError.message : '操作失败，请稍后重试',
        );
      } finally {
        setHandling(false);
      }
    },
    [activity, handling],
  );

  const stateBlock = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>正在加载好友动态详情...</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable style={[s.retryButton, d.retryButton]} onPress={loadActivity}>
        <Text style={d.retryButtonText}>重试</Text>
      </Pressable>
    </View>
  ) : null;

  const isPendingIncoming =
    activity?.type === 'REQUEST_RECEIVED' && canHandleFriendActivity(activity);

  return (
    <View style={d.container}>
      <NavHeader title="好友动态" />
      {stateBlock ? (
        stateBlock
      ) : activity ? (
        <View style={s.content}>
          <View style={[s.card, d.card]}>
            <View style={s.profileRow}>
              <Avatar
                size={52}
                name={getFriendActivityDisplayName(activity)}
                uri={activity.counterparty.avatarUrl ?? undefined}
              />
              <View style={s.profileMeta}>
                <Text style={d.title}>{getFriendActivityDisplayName(activity)}</Text>
                <Text style={d.subtitle}>{getFriendActivityCopy(activity)}</Text>
                <Text style={d.time}>
                  {new Date(activity.createdAt).toLocaleString('zh-CN')}
                </Text>
              </View>
            </View>

            <View>
              <Text style={d.messageLabel}>附言</Text>
              <Text style={d.messageText}>
                {activity.messageSnapshot?.trim() || '对方没有填写附言'}
              </Text>
            </View>

            {isPendingIncoming ? (
              <View style={s.actionRow}>
                <Pressable
                  style={[s.actionButton, d.rejectButton]}
                  disabled={handling}
                  onPress={() => handleDecision('reject')}
                >
                  <Text style={d.rejectButtonText}>
                    {handling ? '处理中...' : '拒绝'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.actionButton, d.acceptButton]}
                  disabled={handling}
                  onPress={() => handleDecision('accept')}
                >
                  <Text style={d.acceptButtonText}>
                    {handling ? '处理中...' : '接受'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Text style={d.stateText}>
                当前状态：{activity.requestState}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
