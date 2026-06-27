import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { loadConversationList, sendCircleCardMessage } from '@/im/client';
import { mapConversationItemToUI } from '@/im/mappers';
import { useIMStore } from '@/stores/imStore';
import { getShareCircleCardListState } from '@/features/discover/utils/share-circle-card';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import type { Conversation } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const SENDING_STATE_FALLBACK_MS = 8000;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  introCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  listCard: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowContent: { flex: 1, gap: 4 },
  empty: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    alignItems: 'center',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.md,
    minWidth: 96,
    height: 36,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Pick a conversation to drop the circle's share card into. The recipient taps
// the card to open the circle detail, where they can apply to join.
export default function ShareCircleCardScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    avatar?: string;
  }>();
  const circleId = typeof params.id === 'string' ? params.id : '';
  const circleName =
    typeof params.title === 'string'
      ? params.title
      : t('circle.card.type', { defaultValue: '圈子' });
  const circleAvatar =
    typeof params.avatar === 'string' && params.avatar ? params.avatar : null;

  const rawConversations = useIMStore((state) => state.conversations);
  const [sendingConversationID, setSendingConversationID] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(
    rawConversations.length === 0,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const inFlightRef = useRef(false);
  const sendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSendingTimeout = useCallback(() => {
    if (sendingTimeoutRef.current) {
      clearTimeout(sendingTimeoutRef.current);
      sendingTimeoutRef.current = null;
    }
  }, []);

  const clearSendingState = useCallback(() => {
    clearSendingTimeout();
    inFlightRef.current = false;
    setSendingConversationID('');
  }, [clearSendingTimeout]);

  useEffect(() => clearSendingTimeout, [clearSendingTimeout]);

  useEffect(() => {
    if (rawConversations.length > 0) {
      setLoadingConversations(false);
      setLoadFailed(false);
      return;
    }

    let cancelled = false;
    setLoadingConversations(true);
    setLoadFailed(false);
    loadConversationList()
      .catch((error) => {
        if (!cancelled) {
          setLoadFailed(true);
          logClientDiagnostic('share_circle_conversations_load_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingConversations(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt, rawConversations.length]);

  const conversations = useMemo(
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );
  const listState = getShareCircleCardListState({
    loading: loadingConversations,
    error: loadFailed,
    conversationCount: conversations.length,
  });

  const confirmSend = useCallback(
    (conversation: Conversation) => {
      if (!circleId || sendingConversationID || inFlightRef.current) return;
      Alert.alert(
        t('circle.shareCard.confirmTitle', {
          defaultValue: '发送圈子名片',
        }),
        t('circle.shareCard.confirmMessage', {
          circleName,
          conversationName: conversation.name,
          defaultValue: `把「${circleName}」发送给 ${conversation.name}？`,
        }),
        [
          {
            text: t('common.cancel', { defaultValue: '取消' }),
            style: 'cancel',
          },
          {
            text: t('common.send', { defaultValue: '发送' }),
            onPress: () => {
              if (inFlightRef.current) return;
              inFlightRef.current = true;
              setSendingConversationID(conversation.id);
              clearSendingTimeout();
              sendingTimeoutRef.current = setTimeout(() => {
                logClientDiagnostic('share_circle_send_state_timeout', {
                  circleId,
                  conversationID: conversation.id,
                });
                // 只清掉「发送中」的 UI 态并提示用户；保留 inFlightRef 锁，
                // 避免真实发送仍在飞行时被再次点击造成重复发送。锁的释放交给
                // 下方 .finally(clearSendingState)，等真正的发送 settle 再放开。
                setSendingConversationID('');
                sendingTimeoutRef.current = null;
                Alert.alert(
                  t('common.tip', { defaultValue: '提示' }),
                  t('common.retryLater', { defaultValue: '请稍后重试' }),
                );
              }, SENDING_STATE_FALLBACK_MS);
              void sendCircleCardMessage({
                targetConversationID: conversation.id,
                circleId,
                name: circleName,
                avatarUrl: circleAvatar,
              })
                .then(() => {
                  Alert.alert(
                    t('circle.shareCard.sentTitle', {
                      defaultValue: '已发送',
                    }),
                    t('circle.shareCard.sentMessage', {
                      defaultValue: '圈子名片已发送。',
                    }),
                    [
                      {
                        text: t('common.ok', { defaultValue: '知道了' }),
                        onPress: () => router.back(),
                      },
                    ],
                  );
                })
                .catch((error: unknown) => {
                  logClientDiagnostic('share_circle_send_failed', {
                    circleId,
                    conversationID: conversation.id,
                    message:
                      error instanceof Error ? error.message : String(error),
                  });
                  Alert.alert(
                    t('circle.shareCard.failedTitle', {
                      defaultValue: '发送失败',
                    }),
                    error instanceof Error
                      ? error.message
                      : t('common.retryLater', { defaultValue: '请稍后重试' }),
                  );
                })
                .finally(clearSendingState);
            },
          },
        ],
        { cancelable: true },
      );
    },
    [
      circleId,
      circleName,
      circleAvatar,
      clearSendingState,
      clearSendingTimeout,
      sendingConversationID,
      t,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <Pressable
        style={s.row}
        onPress={() => confirmSend(item)}
        disabled={Boolean(sendingConversationID)}
      >
        <Avatar size={42} name={item.name} uri={item.avatarUrl} />
        <View style={s.rowContent}>
          <Text
            style={[Typography.body, { color: colors.text, fontWeight: '600' }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            style={[Typography.caption, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {sendingConversationID === item.id
              ? t('circle.shareCard.sending', { defaultValue: '发送中...' })
              : item.message ||
                t('circle.shareCard.rowFallback', {
                  defaultValue: '发送圈子名片',
                })}
          </Text>
        </View>
      </Pressable>
    ),
    [
      colors.text,
      colors.textSecondary,
      confirmSend,
      sendingConversationID,
      t,
    ],
  );

  return (
    <View
      style={[
        s.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <NavHeader
        title={t('circle.shareCard.title', { defaultValue: '发送圈子名片' })}
      />
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View style={s.content}>
            <View style={[s.introCard, { backgroundColor: colors.surface }]}>
              <Text
                style={[
                  Typography.body,
                  { color: colors.text, fontWeight: '600' },
                ]}
              >
                {t('circle.shareCard.pickConversation', {
                  defaultValue: '选择一个会话',
                })}
              </Text>
              <Text
                style={[Typography.caption, { color: colors.textSecondary }]}
              >
                {t('circle.shareCard.description', {
                  circleName,
                  defaultValue:
                    '把「{{circleName}}」的圈子名片发到聊天里，对方点击即可申请加入。',
                })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          listState === 'loading' ? (
            <View style={s.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : listState === 'error' ? (
            <View style={s.empty}>
              <Text
                style={[
                  Typography.bodyRegular,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                {t('circle.shareCard.loadFailed', {
                  defaultValue: '无法加载聊天对象，请稍后重试',
                })}
              </Text>
              <Pressable
                style={[s.retryButton, { borderColor: colors.surfaceBorder }]}
                onPress={() => setLoadAttempt((current) => current + 1)}
              >
                <Text style={[Typography.body, { color: colors.primary }]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text
              style={[
                s.empty,
                Typography.bodyRegular,
                { color: colors.textSecondary },
              ]}
            >
              {t('circle.shareCard.empty', {
                defaultValue: '暂无可发送的聊天对象',
              })}
            </Text>
          )
        }
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
          conversations.length > 0 ? undefined : { flexGrow: 1 },
        ]}
        style={s.listCard}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
