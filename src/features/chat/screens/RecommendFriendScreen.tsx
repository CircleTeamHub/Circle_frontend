import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { loadChatConversations } from '@/chat-core/api';
import { sendCardMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useChatStore } from '@/chat-core/store';
import type { Conversation } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

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
  rowContent: {
    flex: 1,
    gap: 4,
  },
  empty: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    textAlign: 'center',
  },
});

export default function RecommendFriendScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    friendId?: string;
    friendName?: string;
  }>();
  const rawConversations = useChatStore((state) => state.conversations);
  const [sendingConversationID, setSendingConversationID] = useState('');
  // Pattern D 第二道：sendingConversationID 是 state，fast double-tap 下可能晚一帧；
  // 用 ref 在入口处兜底，避免给同一个会话连发两张名片。
  const inFlightRef = useRef(false);

  const currentConversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const friendId = typeof params.friendId === 'string' ? params.friendId : '';
  const friendName =
    typeof params.friendName === 'string'
      ? params.friendName
      : t('chat.recommend.fallbackFriend', { defaultValue: '这位好友' });

  useEffect(() => {
    if (rawConversations.length > 0) {
      return;
    }

    loadChatConversations().catch((err) => {
      // 失败时保留已有的会话（即便为空），dev 下让我们知道这里失败过。
      reportHandledFailure('recommendFriend', 'loadConversations', err);
    });
  }, [rawConversations.length]);

  const conversations = useMemo(
    () =>
      rawConversations
        .filter((conversation) => conversation.id !== currentConversationID)
        .map(mapChatConversationToUI),
    [currentConversationID, rawConversations],
  );

  const confirmSend = useCallback(
    (conversation: Conversation) => {
      if (!friendId || sendingConversationID || inFlightRef.current) {
        return;
      }

      Alert.alert(
        t('chat.recommend.title', { defaultValue: '推荐给朋友' }),
        t('chat.recommend.confirmMsg', {
          defaultValue: '确认把 {{friend}} 推荐给 {{target}} 吗？',
          friend: friendName,
          target: conversation.name,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.send', { defaultValue: '发送' }),
            onPress: () => {
              if (inFlightRef.current) return;
              inFlightRef.current = true;
              setSendingConversationID(conversation.id);
              void sendCardMessage({
                conversationId: conversation.id,
                type: 'friend-card',
                payload: { userID: friendId, nickname: friendName, faceURL: '' },
              })
                .then(() => {
                  Alert.alert(
                    t('chat.recommend.sentTitle', { defaultValue: '已发送' }),
                    t('chat.recommend.sentMsg', {
                      defaultValue: '好友名片已发送。',
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
                  Alert.alert(
                    t('chat.recommend.sendFailed', { defaultValue: '发送失败' }),
                    getChatSendErrorMessage(
                      error,
                      t('common.retryLater', { defaultValue: '请稍后重试' }),
                    ),
                  );
                })
                .finally(() => {
                  inFlightRef.current = false;
                  setSendingConversationID('');
                });
            },
          },
        ],
        { cancelable: true },
      );
    },
    [friendId, friendName, sendingConversationID, t],
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
              ? t('chat.recommend.sending', { defaultValue: '发送中…' })
              : item.message ||
                t('chat.recommend.sendCardHint', {
                  defaultValue: '发送好友名片',
                })}
          </Text>
        </View>
      </Pressable>
    ),
    [colors.text, colors.textSecondary, confirmSend, sendingConversationID, t],
  );

  return (
    <View
      style={[
        s.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <NavHeader title={t('chat.recommend.title', { defaultValue: '推荐给朋友' })} />
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View style={s.content}>
            <View style={[s.introCard, { backgroundColor: colors.surface }]}>
              <Text style={[Typography.body, { color: colors.text, fontWeight: '600' }]}>
                {t('chat.recommend.pickConversation', {
                  defaultValue: '选择一个会话',
                })}
              </Text>
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                {t('chat.recommend.intro', {
                  defaultValue: '发送 {{friend}} 的好友名片到另一个聊天。',
                  friend: friendName,
                })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={[s.empty, Typography.bodyRegular, { color: colors.textSecondary }]}>
            {t('chat.recommend.empty', {
              defaultValue: '暂无可推荐的聊天对象',
            })}
          </Text>
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
