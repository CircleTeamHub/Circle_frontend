import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
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
  fetchFriendRequestMessages,
  markFriendActivityRead,
  rejectFriendRequest,
  sendFriendRequestMessage,
  type FriendActivity,
  type FriendRequestMessage,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MESSAGE_MAX_LENGTH = 500;

const s = StyleSheet.create({
  flex: {
    flex: 1,
  },
  threadContent: {
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
  bubbleRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '76%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 4,
  },
  emptyThread: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    ...Typography.bodyRegular,
  },
  sendButton: {
    height: 40,
    borderRadius: Radius.lg,
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
  const [messages, setMessages] = useState<FriendRequestMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const selfUserId = useAuthStore((state) => state.user?.id ?? null);

  const activityId = typeof params.id === 'string' ? params.id : '';
  const requestId = activity?.requestId ?? null;

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

  // Pull the message thread once the detail (and its requestId) is known. The
  // thread is notification-driven, not real-time, so a single fetch on entry is
  // enough; a failure just leaves the fallback snapshot visible.
  useEffect(() => {
    if (!requestId) return;
    const signal = { cancelled: false };
    fetchFriendRequestMessages(requestId)
      .then((rows) => {
        if (signal.cancelled) return;
        setMessages(rows);
      })
      .catch((fetchError) => {
        if (__DEV__) {
          console.warn(
            '[FriendActivityDetailScreen] fetchFriendRequestMessages failed',
            { requestId },
            fetchError,
          );
        }
      });
    return () => {
      signal.cancelled = true;
    };
  }, [requestId]);

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
      bubbleMine: {
        backgroundColor: colors.primary,
      },
      bubbleTheirs: {
        backgroundColor: colors.surface,
      },
      bubbleTextMine: {
        color: colors.white,
        ...Typography.bodyRegular,
      },
      bubbleTextTheirs: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      bubbleTimeMine: {
        color: colors.white,
        opacity: 0.7,
        ...Typography.tiny,
      },
      bubbleTimeTheirs: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      inputBar: {
        borderTopColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      input: {
        backgroundColor: colors.surface,
        color: colors.text,
      },
      sendButton: {
        backgroundColor: colors.primary,
      },
      sendButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      sendButtonText: {
        color: colors.white,
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
          getApiErrorMessage(nextError, t('contacts.friendActivity.handleError')),
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
                getApiErrorMessage(
                  nextError,
                  t('contacts.friendActivity.handleError'),
                ),
              );
            } finally {
              setHandling(false);
            }
          },
        },
      ],
    );
  }, [activity, handling, t]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !requestId) {
      return;
    }
    setSending(true);
    try {
      const created = await sendFriendRequestMessage(requestId, content);
      setMessages((prev) => [...prev, created]);
      setDraft('');
    } catch (sendError) {
      Alert.alert(
        t('contacts.friendActivity.sendFailed'),
        getApiErrorMessage(sendError, t('contacts.friendActivity.sendFailed')),
      );
    } finally {
      setSending(false);
    }
  }, [draft, sending, requestId, t]);

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
  // Both sides can keep exchanging messages while the request is still pending.
  const canReply = activity?.requestState === 'PENDING';

  const renderBubble = useCallback(
    ({ item }: { item: FriendRequestMessage }) => {
      const isMine = item.senderId === selfUserId;
      return (
        <View
          style={[
            s.bubbleRow,
            isMine ? s.bubbleRowMine : s.bubbleRowTheirs,
          ]}
        >
          <View style={[s.bubble, isMine ? d.bubbleMine : d.bubbleTheirs]}>
            <Text style={isMine ? d.bubbleTextMine : d.bubbleTextTheirs}>
              {item.content}
            </Text>
            <Text style={isMine ? d.bubbleTimeMine : d.bubbleTimeTheirs}>
              {new Date(item.createdAt).toLocaleTimeString(
                getLocalizedDateTimeLocale(i18n.language),
                { hour: '2-digit', minute: '2-digit' },
              )}
            </Text>
          </View>
        </View>
      );
    },
    [selfUserId, d, i18n.language],
  );

  const listHeader = activity ? (
    <View style={[s.card, d.card]}>
      <View style={s.profileRow}>
        <Avatar
          size={52}
          name={getFriendActivityDisplayName(activity)}
          uri={activity.counterparty.avatarUrl ?? undefined}
        />
        <View style={s.profileMeta}>
          <MemberName
            name={getFriendActivityDisplayName(activity)}
            userId={activity.counterparty.id}
            style={d.title}
          />
          <Text style={d.subtitle}>{getFriendActivityCopy(activity)}</Text>
          <Text style={d.time}>
            {new Date(activity.createdAt).toLocaleString(
              getLocalizedDateTimeLocale(i18n.language),
            )}
          </Text>
        </View>
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
          {t('contacts.friendActivity.currentStatus', {
            status: t(`contacts.friendActivity.status.${activity.requestState}`),
          })}
        </Text>
      )}
    </View>
  ) : null;

  const listEmpty =
    activity && activity.messageSnapshot?.trim() ? (
      <View style={s.emptyThread}>
        <Text style={d.messageLabel}>
          {t('contacts.friendActivity.message')}
        </Text>
        <Text style={d.messageText}>{activity.messageSnapshot.trim()}</Text>
      </View>
    ) : null;

  return (
    <View style={d.container}>
      <NavHeader title={t('contacts.friendActivity.detail')} />
      {stateBlock ? (
        stateBlock
      ) : activity ? (
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 44}
        >
          <FlatList
            style={s.flex}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderBubble}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            contentContainerStyle={s.threadContent}
            keyboardShouldPersistTaps="handled"
          />
          {canReply ? (
            <View
              style={[
                s.inputBar,
                d.inputBar,
                { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
              ]}
            >
              <TextInput
                style={[s.input, d.input]}
                value={draft}
                onChangeText={setDraft}
                placeholder={t('contacts.friendActivity.replyPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={MESSAGE_MAX_LENGTH}
                editable={!sending}
              />
              <Pressable
                style={[
                  s.sendButton,
                  draft.trim() && !sending
                    ? d.sendButton
                    : d.sendButtonDisabled,
                ]}
                disabled={!draft.trim() || sending}
                onPress={handleSend}
              >
                <Text style={d.sendButtonText}>
                  {sending
                    ? t('common.processing')
                    : t('contacts.friendActivity.send')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}
