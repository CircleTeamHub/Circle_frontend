import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { DatePill, ReceivedBubble, SentBubble, LocationCard } from '@/features/chat/components/chat-bubble';
import { getUserProfileHref } from '@/features/user/utils/routes';
import {
  loadConversationMessages,
  markConversationAsRead,
  sendTextMessage,
} from '@/im/client';
import { mapMessageItemToChatMessage } from '@/im/mappers';
import { useAuthStore } from '@/stores/authStore';
import { useIMStore } from '@/stores/imStore';
import { SessionType } from '@openim/rn-client-sdk';
import type { ChatMessage } from '@/types';

const s = StyleSheet.create({
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.md },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '600' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { ...Typography.small },
  messageList: { padding: Spacing.md, gap: 14 },
  sendError: { textAlign: 'center', paddingVertical: 4 },
  inputBar: { paddingTop: 10, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 10 },
  circleBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  textInputWrap: { flex: 1, height: 40, borderWidth: 1, borderRadius: Radius.xl, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  textInput: { flex: 1, ...Typography.bodyRegular, padding: 0 },
});

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    conversationType?: 'private' | 'group';
    avatarUrl?: string;
  }>();
  const currentUserID = useIMStore((state) => state.currentUserID);
  const messagesByConversation = useIMStore((state) => state.messagesByConversation);
  const setActiveConversation = useIMStore((state) => state.setActiveConversation);
  const appendMessages = useIMStore((state) => state.appendMessages);
  const authUser = useAuthStore((state) => state.user);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const sourceID = typeof params.sourceID === 'string' ? params.sourceID : '';
  const conversationTitle =
    typeof params.title === 'string' ? params.title : '聊天详情';
  const conversationType =
    params.conversationType === 'group' ? SessionType.Group : SessionType.Single;
  const avatarUrl =
    typeof params.avatarUrl === 'string' ? params.avatarUrl : undefined;

  const handleBack = useCallback(() => router.back(), []);
  const handleOpenUserProfile = useCallback(() => {
    router.push(getUserProfileHref('messages', sourceID, conversationTitle));
  }, [conversationTitle, sourceID]);

  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: colors.background },
    headerName: { color: colors.text },
    onlineDot: { backgroundColor: colors.online },
    onlineText: { color: colors.textSecondary },
    inputBar: { backgroundColor: colors.background },
    circleBtn: { backgroundColor: colors.surface },
    textInputWrap: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    textInput: { color: colors.text },
  }), [colors]);

  useEffect(() => {
    if (!conversationID || !sourceID) {
      return;
    }

    setActiveConversation({
      conversationID,
      sourceID,
      sessionType: conversationType,
    });

    markConversationAsRead(conversationID).catch(() => {
      // Ignore mark-read failures in the chat detail screen.
    });
    loadConversationMessages(conversationID).catch(() => {
      // Message loading errors are surfaced by an empty state below.
    });

    return () => {
      setActiveConversation(null);
    };
  }, [conversationID, conversationType, setActiveConversation, sourceID]);

  const messages = useMemo(
    () =>
      (messagesByConversation[conversationID] ?? [])
        .map((item) => mapMessageItemToChatMessage(item, currentUserID))
        .filter((item): item is ChatMessage => Boolean(item)),
    [conversationID, currentUserID, messagesByConversation],
  );

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'received':
        return (
          <ReceivedBubble
            message={item}
            senderName={item.senderName ?? conversationTitle}
            onAvatarPress={handleOpenUserProfile}
          />
        );
      case 'sent': return <SentBubble message={item} />;
      case 'location':
        return (
          <LocationCard
            message={item}
            senderName={item.senderName ?? conversationTitle}
            onAvatarPress={handleOpenUserProfile}
          />
        );
      default: return null;
    }
  }, [handleOpenUserProfile]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const handleSend = useCallback(async () => {
    const nextText = draft.trim();

    if (!nextText || sending || !sourceID) {
      return;
    }

    setSending(true);

    try {
      setSendError(null);
      const sentMessage = await sendTextMessage({
        sourceID,
        sessionType: conversationType,
        text: nextText,
      });
      appendMessages(conversationID, [sentMessage]);
      setDraft('');
    } catch {
      setSendError('消息发送失败，请重试');
    } finally {
      setSending(false);
    }
  }, [appendMessages, conversationID, conversationType, draft, sending, sourceID]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => router.push(getUserProfileHref('messages', sourceID, conversationTitle))}
        >
          <Avatar size={40} name={conversationTitle} uri={avatarUrl} />
        </Pressable>
        <View style={s.headerInfo}>
          <Text style={[s.headerName, d.headerName]}>{conversationTitle}</Text>
          <View style={s.onlineRow}>
            <View style={[s.onlineDot, d.onlineDot]} />
            <Text style={[s.onlineText, d.onlineText]}>
              {authUser?.accountId === sourceID ? '自己' : '在线'}
            </Text>
          </View>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => router.push({ pathname: '/(tabs)/messages/chat-info', params: { conversationID } })}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Divider />
      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={s.messageList}
        showsVerticalScrollIndicator={false}
      />
      <Divider />
      {sendError ? (
        <Text style={[s.sendError, Typography.small, { color: colors.error }]}>
          {sendError}
        </Text>
      ) : null}
      <View style={[s.inputBar, d.inputBar, { paddingBottom: insets.bottom || 28 }]}>
        <Pressable style={[s.circleBtn, d.circleBtn]}>
          <Ionicons name="mic" size={18} color={colors.textSecondary} />
        </Pressable>
        <View style={[s.textInputWrap, d.textInputWrap]}>
          <TextInput
            style={[s.textInput, d.textInput]}
            placeholder="输入消息..."
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSend}
          />
          <Ionicons name="happy-outline" size={18} color={colors.textSecondary} />
        </View>
        <Pressable style={[s.circleBtn, d.circleBtn]} onPress={handleSend} disabled={sending}>
          <Ionicons
            name={draft.trim() ? 'send' : 'add'}
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );
}
