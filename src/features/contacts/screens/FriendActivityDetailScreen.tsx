import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import {
  canHandleFriendActivity,
  getFriendActivityCopy,
  getFriendActivityDisplayName,
} from '@/features/contacts/friend-activities';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  fetchFriendActivityDetail,
  markFriendActivityRead,
  rejectFriendRequest,
  type FriendActivity,
} from '@/services/api/friends';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const [activity, setActivity] = useState<FriendActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [handling, setHandling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activityId = typeof params.id === 'string' ? params.id : '';

  const loadActivity = useCallback(
    (signal?: { cancelled: boolean }) => {
      if (!activityId) {
        setError(t('contacts.friendActivity.notExist'));
        setLoading(false);
        return Promise.resolve();
      }

      setLoading(true);

      return markFriendActivityRead(activityId)
        .catch((markError) => {
          // mark-read failures are non-critical — continue loading detail
          if (__DEV__) {
            console.warn(
              '[FriendActivityDetailScreen] markFriendActivityRead failed',
              { activityId },
              markError,
            );
          }
        })
        .then(() => fetchFriendActivityDetail(activityId))
        .then((nextActivity) => {
          if (signal?.cancelled) return;
          setActivity(nextActivity);
          setError(null);
        })
        .catch(() => {
          if (signal?.cancelled) return;
          setError(t('contacts.friendActivity.detailLoadFailed'));
        })
        .finally(() => {
          if (signal?.cancelled) return;
          setLoading(false);
        });
    },
    [activityId, t],
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
          Alert.alert(
            t('contacts.friendActivity.accepted'),
            t('contacts.friendActivity.acceptedMessage'),
          );
        } else {
          await rejectFriendRequest(activity.requestId);
          setActivity((current) =>
            current ? { ...current, requestState: 'REJECTED' } : current,
          );
          Alert.alert(
            t('contacts.friendActivity.rejected'),
            t('contacts.friendActivity.rejectedMessage'),
          );
        }
      } catch (nextError) {
        Alert.alert(
          t('contacts.friendActivity.handleFailed'),
          nextError instanceof Error ? nextError.message : t('contacts.friendActivity.handleError'),
        );
      } finally {
        setHandling(false);
      }
    },
    [activity, handling, t],
  );

  const handleCancel = useCallback(() => {
    if (!activity || handling) {
      return;
    }
    Alert.alert(
      t('contacts.friendActivity.cancelTitle', { defaultValue: '撤回申请' }),
      t('contacts.friendActivity.cancelMessage', {
        defaultValue: '确定撤回这条好友申请吗？',
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('contacts.friendActivity.cancelConfirm', {
            defaultValue: '撤回',
          }),
          style: 'destructive',
          onPress: async () => {
            setHandling(true);
            try {
              await cancelFriendRequest(activity.requestId);
              setActivity((current) =>
                current ? { ...current, requestState: 'WITHDRAWN' } : current,
              );
            } catch (nextError) {
              Alert.alert(
                t('contacts.friendActivity.handleFailed'),
                nextError instanceof Error
                  ? nextError.message
                  : t('contacts.friendActivity.handleError'),
              );
            } finally {
              setHandling(false);
            }
          },
        },
      ],
    );
  }, [activity, handling, t]);

  const stateBlock = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.friendActivity.loadingDetail')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable
        style={[s.retryButton, d.retryButton]}
        onPress={() => {
          void loadActivity();
        }}
      >
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : null;

  const isPendingIncoming =
    activity?.type === 'REQUEST_RECEIVED' && canHandleFriendActivity(activity);
  const canCancelOutgoing =
    activity?.type === 'REQUEST_SENT' && activity?.requestState === 'PENDING';

  return (
    <View style={d.container}>
      <NavHeader title={t('contacts.friendActivity.detail')} />
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
                  {new Date(activity.createdAt).toLocaleString(
                    getLocalizedDateTimeLocale(i18n.language),
                  )}
                </Text>
              </View>
            </View>

            <View>
              <Text style={d.messageLabel}>{t('contacts.friendActivity.message')}</Text>
              <Text style={d.messageText}>
                {activity.messageSnapshot?.trim() || t('contacts.friendActivity.noMessage')}
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
                    {handling ? t('common.processing') : t('contacts.friendActivity.reject')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.actionButton, d.acceptButton]}
                  disabled={handling}
                  onPress={() => handleDecision('accept')}
                >
                  <Text style={d.acceptButtonText}>
                    {handling ? t('common.processing') : t('contacts.friendActivity.accept')}
                  </Text>
                </Pressable>
              </View>
            ) : canCancelOutgoing ? (
              <Pressable
                style={[s.actionButton, d.rejectButton]}
                disabled={handling}
                onPress={handleCancel}
              >
                <Text style={d.rejectButtonText}>
                  {handling
                    ? t('common.processing')
                    : t('contacts.friendActivity.cancel', {
                        defaultValue: '撤回申请',
                      })}
                </Text>
              </Pressable>
            ) : (
              <Text style={d.stateText}>
                {t('contacts.friendActivity.currentStatus', { status: activity.requestState })}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
