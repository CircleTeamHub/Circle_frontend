import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ImageBackground,
} from 'react-native';
import type { FlatList as FlatListType } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import {
  DatePill,
  ReceivedBubble,
  SentBubble,
  LocationCard,
  ImageBubble,
  NoteCardBubble,
  FriendCardBubble,
  TransferCardBubble,
} from '@/features/chat/components/chat-bubble';
import { getUserProfileHref } from '@/features/user/utils/routes';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  loadConversationMessages,
  markConversationAsRead,
  sendFriendCardMessage,
  sendImageMessage,
  sendLocationMessage,
  sendNoteCardMessage,
  sendTextMessage,
  sendTransferCardMessage,
  subscribeUserOnlineStatus,
  toImUserId,
  unsubscribeUserOnlineStatus,
} from '@/im/client';
import { mapMessageItemToChatMessage } from '@/im/mappers';
import { useAuthStore } from '@/stores/authStore';
import { useIMStore } from '@/stores/imStore';
import { type FriendProfile } from '@/services/api/friends';
import { fetchUserProfile } from '@/services/api/profile';
import type { NoteSummary } from '@/features/notes/types';
import { type UserCollection } from '@/services/api/collections';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import { useTransferComposerStore } from '@/features/chat/store/use-transfer-composer-store';
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { OnlineState, SessionType } from '@openim/rn-client-sdk';
import type { ChatMessage, FriendCardData } from '@/types';

type AttachmentId =
  | 'media'
  | 'video-call'
  | 'location'
  | 'notes'
  | 'friend-card'
  | 'favorites'
  | 'quick-reply'
  | 'transfer';

const ATTACHMENT_ITEMS: ReadonlyArray<{
  id: AttachmentId;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { id: 'media', icon: 'image-outline', label: '媒体' },
  { id: 'video-call', icon: 'videocam-outline', label: '视频通话' },
  { id: 'location', icon: 'location-outline', label: '位置' },
  { id: 'notes', icon: 'create-outline', label: '笔记' },
  { id: 'friend-card', icon: 'person-outline', label: '好友名片' },
  { id: 'favorites', icon: 'star-outline', label: '我的收藏' },
  { id: 'quick-reply', icon: 'rocket-outline', label: '快捷语' },
  { id: 'transfer', icon: 'card-outline', label: '转账' },
];


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
  attachmentPanel: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  attachmentItem: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  attachmentIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentLabel: {
    ...Typography.small,
  },
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
  const onlineStatusByUser = useIMStore((state) => state.onlineStatusByUser);
  const authUser = useAuthStore((state) => state.user);
  const flatListRef = useRef<FlatListType<ChatMessage>>(null);
  const scrolledToSearchRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const consumePendingShare = useSharePickerStore((s) => s.consume);
  const consumePendingTransfer = useTransferComposerStore((s) => s.consume);

  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const sourceID = typeof params.sourceID === 'string' ? params.sourceID : '';
  const conversationTitle =
    typeof params.title === 'string' ? params.title : '聊天详情';
  const conversationType =
    params.conversationType === 'group' ? SessionType.Group : SessionType.Single;
  const isGroupChat = conversationType === SessionType.Group;
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

  // 单聊场景下订阅对方在线状态。订阅 Promise 立刻返回当前快照，
  // 之后由全局 onUserStatusChanged 维护增量。
  const peerImId = useMemo(
    () =>
      conversationType === SessionType.Single && sourceID
        ? toImUserId(sourceID)
        : null,
    [conversationType, sourceID],
  );
  const peerOnline =
    peerImId != null && onlineStatusByUser[peerImId] === OnlineState.Online;
  const statusColor =
    conversationType !== SessionType.Single || authUser?.accountId === sourceID
      ? colors.online
      : peerOnline
        ? colors.online
        : colors.textSecondary;
  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: backgroundStyle.backgroundColor },
    headerName: { color: colors.text },
    onlineDot: { backgroundColor: statusColor },
    headerStatusText: { color: statusColor },
    inputBar: { backgroundColor: backgroundStyle.backgroundColor },
    circleBtn: { backgroundColor: colors.surface },
    composerActionBtn: { backgroundColor: colors.surfaceBorder },
    composerShell: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    composerInput: { color: colors.text },
    attachmentPanel: { backgroundColor: backgroundStyle.backgroundColor },
    attachmentIcon: { backgroundColor: colors.surface },
  }), [backgroundStyle.backgroundColor, colors, statusColor]);

  useEffect(() => {
    if (!conversationID || !sourceID) {
      return;
    }

    setActiveConversation({
      conversationID,
      // SDK 推过来的 sendID/recvID 都是去连字符的 IM 形式，
      // activeConversation.sourceID 用同样形式才能匹配
      sourceID:
        conversationType === SessionType.Single ? toImUserId(sourceID) : sourceID,
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

  useEffect(() => {
    if (!peerImId) return;
    void subscribeUserOnlineStatus([peerImId]).catch(() => {
      // 忽略：拿不到状态时回落显示离线
    });
    return () => {
      void unsubscribeUserOnlineStatus([peerImId]).catch(() => {});
    };
  }, [peerImId]);

  // FlatList 用 inverted 渲染：index 0 = 最新消息，自然停在底部。
  // 因此把按时间升序的 messages 反转一次，新到旧排列。
  const messages = useMemo(
    () =>
      [...(messagesByConversation[conversationID] ?? [])]
        .reverse()
        .map((item) => mapMessageItemToChatMessage(item, currentUserID))
        .filter((item): item is ChatMessage => Boolean(item)),
    [conversationID, currentUserID, messagesByConversation],
  );

  // 搜索定位：在 inverted 列表里 scrollToIndex 仍然按 index 计数，找到就跳。
  useEffect(() => {
    if (messages.length === 0 || !searchedMsgID || scrolledToSearchRef.current) {
      return;
    }

    const idx = messages.findIndex((m) => m.id === searchedMsgID);
    if (idx !== -1) {
      scrolledToSearchRef.current = true;
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.3,
      });
      return;
    }
  }, [messages, searchedMsgID]);

  const selfAvatarUri = authUser?.avatarUrl ?? undefined;
  const selfName = authUser?.nickname ?? authUser?.accountId;

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'received':
        return (
          <ReceivedBubble
            message={item}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            onAvatarPress={handleOpenUserProfile}
          />
        );
      case 'sent':
        return (
          <SentBubble
            message={item}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            hideStatus={isGroupChat}
          />
        );
      case 'location':
        return (
          <LocationCard
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : handleOpenUserProfile}
          />
        );
      case 'image':
        return (
          <ImageBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : handleOpenUserProfile}
            hideStatus={isGroupChat}
          />
        );
      case 'note-card':
        return (
          <NoteCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : handleOpenUserProfile}
            hideStatus={isGroupChat}
          />
        );
      case 'friend-card':
        return (
          <FriendCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : handleOpenUserProfile}
            onPress={(card) =>
              router.push(getUserProfileHref('messages', card.userID, card.nickname))
            }
            hideStatus={isGroupChat}
          />
        );
      case 'transfer-card':
        return (
          <TransferCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : handleOpenUserProfile}
            hideStatus={isGroupChat}
          />
        );
      default: return null;
    }
  }, [avatarUrl, conversationTitle, handleOpenUserProfile, isGroupChat, selfAvatarUri, selfName]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const handleAttachmentToggle = useCallback(() => {
    Keyboard.dismiss();
    setAttachmentOpen((prev) => !prev);
  }, []);

  const sendDraftAsText = useCallback(
    async (text: string) => {
      console.log('[chat] text:request', JSON.stringify(text), {
        sourceID,
        isPreviewMode,
      });
      if (!text.trim() || !sourceID || isPreviewMode) {
        console.log('[chat] text:skipped (empty or preview)');
        return;
      }
      try {
        const sentMessage = await sendTextMessage({
          sourceID,
          sessionType: conversationType,
          text,
        });
        console.log(
          '[chat] text:sent',
          sentMessage.clientMsgID,
          'content=',
          sentMessage.textElem?.content ?? '<no textElem>',
        );
        appendMessages(conversationID, [sentMessage]);
      } catch (error) {
        console.log(
          '[chat] text:fail',
          error instanceof Error ? error.message : error,
        );
        setSendError('消息发送失败，请重试');
      }
    },
    [appendMessages, conversationID, conversationType, isPreviewMode, sourceID],
  );

  const handleSendCurrentLocation = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请在系统设置开启定位权限');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      // 反向解析成可读地址；解析失败就用经纬度兜底，不阻塞主流程
      let description = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        const place = places[0];
        if (place) {
          const parts = [
            place.city ?? place.region,
            place.district ?? place.subregion,
            place.street,
            place.name,
          ].filter((s): s is string => Boolean(s));
          if (parts.length) description = parts.join(' ');
        }
      } catch {
        // ignore — fallback to coords
      }
      const sent = await sendLocationMessage({
        sourceID,
        sessionType: conversationType,
        longitude: position.coords.longitude,
        latitude: position.coords.latitude,
        description,
      });
      appendMessages(conversationID, [sent]);
    } catch {
      setSendError('位置发送失败，请重试');
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    isPreviewMode,
    sourceID,
  ]);

  const handlePickMedia = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请在系统设置开启相册权限');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    const filename = asset.uri.split('/').pop() ?? 'image.jpg';
    const contentType =
      resolveUploadContentType({
        mimeType: asset.mimeType,
        fileName: filename,
      }) ?? 'image/jpeg';

    try {
      console.log('[chat] image:presign request');
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(filename),
        contentType,
        folder: 'chat',
      });
      console.log('[chat] image:presign ok →', presign.fileUrl);
      console.log('[chat] image:put start →', presign.uploadUrl);
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, asset.uri);
      console.log('[chat] image:put done');
      const sentMessage = await sendImageMessage({
        sourceID,
        sessionType: conversationType,
        url: presign.fileUrl,
        sourcePath: asset.uri,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        size: asset.fileSize ?? undefined,
        mimeType: contentType,
      });
      console.log('[chat] image:sent', sentMessage.clientMsgID);
      appendMessages(conversationID, [sentMessage]);
    } catch (error) {
      console.log(
        '[chat] image:fail',
        error instanceof Error ? error.message : error,
      );
      setSendError('图片发送失败，请重试');
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    isPreviewMode,
    sourceID,
  ]);

  const openSharePicker = useCallback(
    (type: 'note' | 'friend' | 'favorite' | 'quick-reply') => {
      router.push({
        pathname: '/(tabs)/messages/share-picker',
        params: { type },
      });
    },
    [],
  );

  const handleAttachmentAction = useCallback(
    (id: AttachmentId) => {
      setAttachmentOpen(false);
      switch (id) {
        case 'media':
          void handlePickMedia();
          return;
        case 'notes':
          openSharePicker('note');
          return;
        case 'friend-card':
          openSharePicker('friend');
          return;
        case 'favorites':
          openSharePicker('favorite');
          return;
        case 'quick-reply':
          openSharePicker('quick-reply');
          return;
        case 'location':
          void handleSendCurrentLocation();
          return;
        case 'video-call':
          Alert.alert('视频通话', '需要接入 RTC SDK（Agora/WebRTC）后开放');
          return;
        case 'transfer':
          if (conversationType !== SessionType.Single) {
            Alert.alert('转账', '群聊暂不支持积分转账');
            return;
          }
          if (!sourceID) return;
          router.push({
            pathname: '/(tabs)/messages/transfer-composer',
            params: {
              recipientId: sourceID,
              recipientName: conversationTitle,
              recipientAvatar: avatarUrl ?? '',
            },
          });
          return;
      }
    },
    [
      avatarUrl,
      conversationTitle,
      conversationType,
      handlePickMedia,
      handleSendCurrentLocation,
      openSharePicker,
      sourceID,
    ],
  );

  const handlePickNote = useCallback(
    async (note: NoteSummary) => {
      if (!sourceID || isPreviewMode) return;
      try {
        const sent = await sendNoteCardMessage({
          sourceID,
          sessionType: conversationType,
          payload: {
            noteId: note.id,
            title: note.title,
            contentPreview: note.contentPreview ?? null,
            coverUrl: note.cover?.url ?? null,
            imageCount: note.imageCount ?? 0,
            videoCount: note.videoCount ?? 0,
            groupNames: note.groups.map((g) => g.name),
          },
        });
        appendMessages(conversationID, [sent]);
      } catch {
        setSendError('笔记发送失败，请重试');
      }
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      isPreviewMode,
      sourceID,
    ],
  );

  const handlePickFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!conversationID) return;
      try {
        // 拉一遍完整资料，把 persona + displayIcons 塞进 ext
        // 失败也无所谓，只是 receiver 看不到 persona/icons，基础名片照样能发。
        let persona: string | null = null;
        let displayIcons: FriendCardData['displayIcons'] = [];
        try {
          const profile = await fetchUserProfile(friend.id);
          persona = profile.persona ?? null;
          displayIcons = profile.displayIcons ?? [];
        } catch {
          // ignore — fall back to lean card
        }

        const sent = await sendFriendCardMessage({
          targetConversationID: conversationID,
          userID: friend.id,
          nickname: friend.nickname,
          faceURL: friend.avatarUrl ?? '',
          persona,
          displayIcons,
        });
        appendMessages(conversationID, [sent]);
      } catch {
        setSendError('名片发送失败，请重试');
      }
    },
    [appendMessages, conversationID],
  );

  const handlePickFavorite = useCallback(
    async (item: UserCollection) => {
      const text = `⭐ ${item.title}${item.summary ? `\n${item.summary}` : ''}`;
      await sendDraftAsText(text);
    },
    [sendDraftAsText],
  );

  const handlePickQuickReply = useCallback(
    async (phrase: string) => {
      await sendDraftAsText(phrase);
    },
    [sendDraftAsText],
  );

  const handleSendTransferCard = useCallback(
    async (payload: { amount: number; message: string | null }) => {
      if (!sourceID || isPreviewMode) return;
      try {
        const sent = await sendTransferCardMessage({
          sourceID,
          sessionType: conversationType,
          payload,
        });
        appendMessages(conversationID, [sent]);
      } catch {
        setSendError('转账卡片发送失败，但积分已扣减');
      }
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      isPreviewMode,
      sourceID,
    ],
  );

  // 从 SharePickerScreen / TransferComposerScreen 返回时消费 pending 项
  // 并触发对应发送动作。
  useFocusEffect(
    useCallback(() => {
      const transfer = consumePendingTransfer();
      if (transfer) {
        void handleSendTransferCard(transfer);
      }
      const item = consumePendingShare();
      if (!item) return;
      switch (item.kind) {
        case 'note':
          void handlePickNote(item.data);
          return;
        case 'friend':
          void handlePickFriend(item.data);
          return;
        case 'favorite':
          void handlePickFavorite(item.data);
          return;
        case 'quick-reply':
          void handlePickQuickReply(item.data);
          return;
      }
    }, [
      consumePendingShare,
      consumePendingTransfer,
      handlePickFavorite,
      handlePickFriend,
      handlePickNote,
      handlePickQuickReply,
      handleSendTransferCard,
    ]),
  );

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
                {authUser?.accountId === sourceID
                  ? '自己'
                  : conversationType !== SessionType.Single
                    ? '群聊'
                    : peerOnline
                      ? '在线'
                      : '离线'}
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
        inverted
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
      <View
        style={[
          s.inputBar,
          d.inputBar,
          { paddingBottom: attachmentOpen ? Spacing.sm : insets.bottom || 28 },
        ]}
      >
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
            onFocus={() => setAttachmentOpen(false)}
            editable={!isPreviewMode}
          />
          <Ionicons name="happy-outline" size={18} color={colors.textSecondary} />
        </View>
        <Pressable
          style={[s.circleBtn, s.composerActionBtn, d.circleBtn, d.composerActionBtn]}
          onPress={draft.trim() ? handleSend : handleAttachmentToggle}
          disabled={sending || isPreviewMode}
        >
          <Ionicons
            name={draft.trim() ? 'send' : 'add'}
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      {attachmentOpen ? (
        <View
          style={[
            s.attachmentPanel,
            d.attachmentPanel,
            { paddingBottom: insets.bottom || Spacing.md },
          ]}
        >
          <View style={s.attachmentGrid}>
            {ATTACHMENT_ITEMS.map((item) => (
              <Pressable
                key={item.id}
                style={s.attachmentItem}
                onPress={() => handleAttachmentAction(item.id)}
              >
                <View style={[s.attachmentIcon, d.attachmentIcon]}>
                  <Ionicons name={item.icon} size={26} color={colors.text} />
                </View>
                <Text style={[s.attachmentLabel, { color: colors.textSecondary }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

    </View>
  );
}
