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
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { loadConversationList, sendCircleCardMessage } from '@/im/client';
import { mapConversationItemToUI } from '@/im/mappers';
import { useIMStore } from '@/stores/imStore';
import type { Conversation } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
    textAlign: 'center',
  },
});

// Pick a conversation to drop the circle's share card into. The recipient taps
// the card to open the circle detail, where they can apply to join.
export default function ShareCircleCardScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    avatar?: string;
  }>();
  const circleId = typeof params.id === 'string' ? params.id : '';
  const circleName = typeof params.title === 'string' ? params.title : '圈子';
  const circleAvatar =
    typeof params.avatar === 'string' && params.avatar ? params.avatar : null;

  const rawConversations = useIMStore((state) => state.conversations);
  const [sendingConversationID, setSendingConversationID] = useState('');
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (rawConversations.length > 0) return;
    loadConversationList().catch((err) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[share-circle] loadConversationList failed', err);
      }
    });
  }, [rawConversations.length]);

  const conversations = useMemo(
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );

  const confirmSend = useCallback(
    (conversation: Conversation) => {
      if (!circleId || sendingConversationID || inFlightRef.current) return;
      Alert.alert(
        '发送圈子名片',
        `把「${circleName}」发送给 ${conversation.name}？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '发送',
            onPress: () => {
              if (inFlightRef.current) return;
              inFlightRef.current = true;
              setSendingConversationID(conversation.id);
              void sendCircleCardMessage({
                targetConversationID: conversation.id,
                circleId,
                name: circleName,
                avatarUrl: circleAvatar,
              })
                .then(() => {
                  Alert.alert('已发送', '圈子名片已发送。', [
                    { text: '知道了', onPress: () => router.back() },
                  ]);
                })
                .catch((error: unknown) => {
                  Alert.alert(
                    '发送失败',
                    error instanceof Error ? error.message : '请稍后重试',
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
    [circleId, circleName, circleAvatar, sendingConversationID],
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
              ? '发送中…'
              : item.message || '发送圈子名片'}
          </Text>
        </View>
      </Pressable>
    ),
    [colors.text, colors.textSecondary, confirmSend, sendingConversationID],
  );

  return (
    <View
      style={[
        s.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <NavHeader title="发送圈子名片" />
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
                选择一个会话
              </Text>
              <Text
                style={[Typography.caption, { color: colors.textSecondary }]}
              >
                把「{circleName}」的圈子名片发到聊天里，对方点击即可申请加入。
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text
            style={[
              s.empty,
              Typography.bodyRegular,
              { color: colors.textSecondary },
            ]}
          >
            暂无可发送的聊天对象
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
