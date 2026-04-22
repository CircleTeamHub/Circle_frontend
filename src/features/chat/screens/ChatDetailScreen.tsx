import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ImageBackground,
} from 'react-native';
import type { FlatList as FlatListType } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
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
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { SessionType } from '@openim/rn-client-sdk';
import type { ChatMessage } from '@/types';

const s = StyleSheet.create({
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: 12,
  },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerMeta: { flex: 1, gap: 2 },
  headerName: { fontSize: 16, fontWeight: '600' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  headerStatusText: { ...Typography.small },
  messageList: { padding: Spacing.md, gap: 14 },
  messageListContent: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  messageListInset: {
    paddingHorizontal: 2,
  },
  previewNotice: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    textAlign: 'center',
  },
  sendError: { textAlign: 'center', paddingVertical: 4 },
  inputBar: {
    paddingTop: 10,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  composerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  composerShell: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: Spacing.xs,
  },
  composerInput: { flex: 1, ...Typography.bodyRegular, padding: 0 },
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
    searchedMsgID?: string;
  }>();
  const navigation = useNavigation();
  const currentUserID = useIMStore((state) => state.currentUserID);
  const messagesByConversation = useIMStore((state) => state.messagesByConversation);
  const setActiveConversation = useIMStore((state) => state.setActiveConversation);
  const appendMessages = useIMStore((state) => state.appendMessages);
  const authUser = useAuthStore((state) => state.user);
  const flatListRef = useRef<FlatListType<ChatMessage>>(null);
  const scrolledToSearchRef = useRef(false);
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
  const searchedMsgID =
    typeof params.searchedMsgID === 'string' ? params.searchedMsgID : '';
  const isPreviewMode = !conversationID;
  const backgroundPreference = useChatPreferencesStore(
    (state) =>
      state.backgroundsByConversationID[conversationID] ??
      DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  );
  const backgroundStyle = useMemo(
    () => resolveChatBackgroundStyle(backgroundPreference, colors.background),
    [backgroundPreference, colors.background],
  );

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/messages');
    }
  }, [navigation]);
  const handleOpenUserProfile = useCallback(() => {
    router.push(getUserProfileHref('messages', sourceID, conversationTitle));
  }, [conversationTitle, sourceID]);

  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: backgroundStyle.backgroundColor },
    headerName: { color: colors.text },
    onlineDot: { backgroundColor: colors.online },
    headerStatusText: { color: colors.online },
    inputBar: { backgroundColor: backgroundStyle.backgroundColor },
    circleBtn: { backgroundColor: colors.surface },
    composerActionBtn: { backgroundColor: colors.surfaceBorder },
    composerShell: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    composerInput: { color: colors.text },
  }), [backgroundStyle.backgroundColor, colors]);

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

  // 消息列表更新时滚动：如果有搜索目标消息则定位到它，否则滚动到底部
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    if (searchedMsgID && !scrolledToSearchRef.current) {
      const idx = messages.findIndex((m) => m.id === searchedMsgID);

      if (idx !== -1) {
        scrolledToSearchRef.current = true;
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
        return;
      }
    }

    if (!searchedMsgID || scrolledToSearchRef.current) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages, searchedMsgID]);

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
  }, [conversationTitle, handleOpenUserProfile]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const handleSend = useCallback(async () => {
    const nextText = draft.trim();

    if (!nextText || sending || !sourceID || isPreviewMode) {
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
  }, [appendMessages, conversationID, conversationType, draft, isPreviewMode, sending, sourceID]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      {backgroundStyle.imageUri ? (
        <ImageBackground
          source={{ uri: backgroundStyle.imageUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        >
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]} />
        </ImageBackground>
      ) : null}
      <View style={s.header}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => router.push(getUserProfileHref('messages', sourceID, conversationTitle))}
        >
          <Avatar size={36} name={conversationTitle} uri={avatarUrl} />
        </Pressable>
        <View style={s.headerInfo}>
          <View style={s.headerMeta}>
            <Text style={[s.headerName, d.headerName]}>{conversationTitle}</Text>
            <View style={s.onlineRow}>
              <View style={[s.onlineDot, d.onlineDot]} />
              <Text style={[s.headerStatusText, d.headerStatusText]}>
                {authUser?.accountId === sourceID ? '自己' : '在线'}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/messages/chat-info',
              params: {
                conversationID,
                sourceID,
                title: conversationTitle,
                originScope: 'messages',
              },
            })
          }
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Divider />
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[s.messageList, s.messageListContent, s.messageListInset]}
        showsVerticalScrollIndicator={false}
      />
      <Divider />
      {isPreviewMode ? (
        <Text style={[s.previewNotice, Typography.small, { color: colors.textSecondary }]}>
          当前仅预览聊天界面，消息发送会在 IM 接通后开放。
        </Text>
      ) : null}
      {sendError ? (
        <Text style={[s.sendError, Typography.small, { color: colors.error }]}>
          {sendError}
        </Text>
      ) : null}
      <View style={[s.inputBar, d.inputBar, { paddingBottom: insets.bottom || 28 }]}>
        <Pressable style={[s.circleBtn, d.circleBtn]}>
          <Ionicons name="mic" size={18} color={colors.textSecondary} />
        </Pressable>
        <View style={[s.composerShell, d.composerShell]}>
          <TextInput
            style={[s.composerInput, d.composerInput]}
            placeholder={isPreviewMode ? '当前仅预览聊天界面' : '输入消息...'}
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSend}
            editable={!isPreviewMode}
          />
          <Ionicons name="happy-outline" size={18} color={colors.textSecondary} />
        </View>
        <Pressable
          style={[s.circleBtn, s.composerActionBtn, d.circleBtn, d.composerActionBtn]}
          onPress={handleSend}
          disabled={sending || isPreviewMode}
        >
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
