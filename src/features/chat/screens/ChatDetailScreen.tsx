import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
import { router, useFocusEffect, useLocalSearchParams, useNavigation, useSegments } from 'expo-router';
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
  VoiceBubble,
  NoteCardBubble,
  FriendCardBubble,
  TransferCardBubble,
} from '@/features/chat/components/chat-bubble';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import {
  getUserProfileHref,
  getUserProfileScopeFromSegments,
  getTabHomeHref,
  getChatInfoTopHref,
  getNoteDetailHref,
} from '@/features/user/utils/routes';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import {
  getOrCreateSingleConversation,
  getOrCreateGroupConversation,
  fromImUserId,
  loadGroupMemberList,
  loadConversationMessages,
  markConversationAsRead,
  sendFriendCardMessage,
  sendImageMessage,
  sendLocationMessage,
  sendNoteCardMessage,
  sendTextMessage,
  sendTransferCardMessage,
  sendVoiceMessage,
  sendVoiceMessageFromSource,
  subscribeUserOnlineStatus,
  toImUserId,
  unsubscribeUserOnlineStatus,
} from '@/im/client';
import { restoreConversationMessages } from '@/im/history-restore';
import { mapMessageItemToChatMessage } from '@/im/mappers';
import { useAuthStore } from '@/stores/authStore';
import { useIMStore } from '@/stores/imStore';
import { type FriendProfile } from '@/services/api/friends';
import { fetchUserProfile } from '@/services/api/profile';
import type { NoteSummary } from '@/features/notes/types';
import { createCollection, type UserCollection } from '@/services/api/collections';
import {
  buildCollectionInputFromMessage,
  getCollectedOpenIMMessagePayload,
} from '@/features/chat/utils/message-collection';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { useTransferComposerStore } from '@/features/chat/store/use-transfer-composer-store';
import { useCallStore } from '@/features/call/store/use-call-store';
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { createGroupCall } from '@/services/api/calls';
import { OnlineState, SessionType } from '@openim/rn-client-sdk';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, FriendCardData } from '@/types';

// Dev-only structured log for a failed send. Never logs the message body —
// only the error and conversation kind — to avoid leaking content into logs.
function logChatSendFailure(
  error: unknown,
  context: { sessionType: SessionType; isGroupChat: boolean },
) {
  if (!__DEV__) return;
  const base =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };
  console.warn('[chat] text send failed', { ...base, ...context });
}

type AttachmentId =
  | 'media'
  | 'voice-call'
  | 'location'
  | 'notes'
  | 'friend-card'
  | 'favorites'
  | 'quick-reply'
  | 'transfer';

const ATTACHMENT_ITEMS: readonly {
  id: AttachmentId;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { id: 'media', icon: 'image-outline', label: '媒体' },
  { id: 'voice-call', icon: 'call-outline', label: '语音通话' },
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
  messageArea: {
    flex: 1,
    overflow: 'hidden',
  },
  messageAreaBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  messageAreaOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  messageListSurface: {
    flex: 1,
  },
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
  voiceRecordingBtn: {
    borderWidth: 1,
  },
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
  voiceStatus: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
  },
});

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    conversationType?: 'private' | 'group';
    avatarUrl?: string;
    searchedMsgID?: string;
  }>();
  const navigation = useNavigation();
  // 聊天页在哪个 tab 栈打开（messages/discover/...），决定返回兜底与子页面跳转的 scope。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const currentUserID = useIMStore((state) => state.currentUserID);
  const messagesByConversation = useIMStore((state) => state.messagesByConversation);
  const setActiveConversation = useIMStore((state) => state.setActiveConversation);
  const appendMessages = useIMStore((state) => state.appendMessages);
  const onlineStatusByUser = useIMStore((state) => state.onlineStatusByUser);
  const authUser = useAuthStore((state) => state.user);
  const flatListRef = useRef<FlatListType<ChatMessage>>(null);
  const scrolledToSearchRef = useRef(false);
  // Pattern D 双层防抖：disabled={sending} 在 fast double-tap 下可能晚一帧才生效；
  // inFlightRef 在 hook 入口处再判断一次，保证同一时刻只有一条消息在飞。文本 / 图片 /
  // 位置 / 笔记 / 名片 / 转账 6 条发送路径共享同一道闸。
  const inFlightRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // 记录输入框光标位置：表情面板按光标处插入，而不是一律拼到末尾。
  // 用 ref 持续跟踪、用 state 只在插入后短暂受控，避免长期受控干扰中文输入法。
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  const consumePendingShare = useSharePickerStore((s) => s.consume);
  const setPendingForward = useMessageForwardStore((s) => s.setPending);
  const consumePendingTransfer = useTransferComposerStore((s) => s.consume);
  const setActiveCall = useCallStore((state) => state.setActiveCall);
  const voiceRecorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const voiceRecorderState = useAudioRecorderState(voiceRecorder, 250);
  const [voiceRecordingStartedAt, setVoiceRecordingStartedAt] = useState<number | null>(null);
  const [voiceActionBusy, setVoiceActionBusy] = useState(false);
  const [callStarting, setCallStarting] = useState(false);
  const callStartingRef = useRef(false);
  const mountedRef = useRef(true);
  // 录音状态的纯 JS 快照：卸载 cleanup 里不能调 recorder 的 native getStatus()，
  // 此时 expo-audio 可能已释放其 native shared object（会抛 NativeSharedObjectNotFoundException）。
  const isRecordingRef = useRef(false);
  const recordingAudioModeEnabledRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = voiceRecorderState.isRecording;
  }, [voiceRecorderState.isRecording]);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const restoreRecordingAudioMode = useCallback(() => {
    if (recordingAudioModeEnabledRef.current) {
      recordingAudioModeEnabledRef.current = false;
      setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }, []);

  const paramConversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const sourceID = typeof params.sourceID === 'string' ? params.sourceID : '';
  // 有些入口（联系人/群聊列表/报名管理等）只传了 sourceID 没传 conversationID，
  // 这里就地解析会话，避免聊天页停在预览占位。IM 未接通时解析失败 → 保持预览。
  const [resolvedConversationID, setResolvedConversationID] =
    useState(paramConversationID);
  const conversationID = paramConversationID || resolvedConversationID;
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

  // 入口只给了 sourceID 时，就地把会话解析出来（单聊/群聊各走对应方法）。
  useEffect(() => {
    if (paramConversationID || !sourceID) return;
    let cancelled = false;
    (async () => {
      try {
        const conv = isGroupChat
          ? await getOrCreateGroupConversation(sourceID)
          : await getOrCreateSingleConversation(sourceID);
        if (!cancelled) setResolvedConversationID(conv.conversationID);
      } catch (error) {
        // IM 未接通等：保持预览模式，不阻断页面。
        if (__DEV__) {
          console.warn('[ChatDetailScreen] resolve conversation failed', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramConversationID, sourceID, isGroupChat]);

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
      // 没有可回退栈时回到来源 tab 首页，而不是固定回消息首页。
      router.replace(getTabHomeHref(scope));
    }
  }, [navigation, scope]);

  const openGroupInfo = useCallback(() => {
    router.push(
      getChatInfoTopHref(scope, {
        conversationID,
        sourceID,
        title: conversationTitle,
        conversationType: 'group',
        originScope: scope,
      }),
    );
  }, [scope, conversationID, sourceID, conversationTitle]);

  const handleOpenMessageSender = useCallback(
    (msg: ChatMessage) => {
      if (isGroupChat) {
        // 群聊：跳该消息发送者本人的资料（senderID 已还原成 UUID 形式）。
        if (!msg.senderID) return;
        router.push(getUserProfileHref(scope, msg.senderID, msg.senderName));
        return;
      }
      // 单聊：对方即会话 sourceID。
      router.push(getUserProfileHref(scope, sourceID, conversationTitle));
    },
    [conversationTitle, sourceID, isGroupChat, scope],
  );

  const handleOpenHeaderTarget = useCallback(() => {
    // 群聊点头部头像 → 进群信息（与右上角 ⋮ 一致）；单聊 → 进个人资料。
    if (isGroupChat) {
      openGroupInfo();
      return;
    }
    router.push(getUserProfileHref(scope, sourceID, conversationTitle));
  }, [isGroupChat, openGroupInfo, scope, sourceID, conversationTitle]);

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
    container: { flex: 1, backgroundColor: colors.background },
    messageArea: { backgroundColor: backgroundStyle.backgroundColor },
    headerName: { color: colors.text },
    onlineDot: { backgroundColor: statusColor },
    headerStatusText: { color: statusColor },
    inputBar: { backgroundColor: colors.background },
    circleBtn: { backgroundColor: colors.surface },
    composerActionBtn: { backgroundColor: colors.surfaceBorder },
    composerShell: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    composerInput: { color: colors.text },
    attachmentPanel: { backgroundColor: colors.background },
    attachmentIcon: { backgroundColor: colors.surface },
    voiceRecordingBtn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
  }), [backgroundStyle.backgroundColor, colors, statusColor]);
  const isVoiceRecording =
    voiceRecorderState.isRecording || voiceRecordingStartedAt != null;
  const voiceElapsedSeconds = Math.max(
    1,
    Math.round(
      (voiceRecorderState.durationMillis ||
        (voiceRecordingStartedAt ? Date.now() - voiceRecordingStartedAt : 0)) /
        1000,
    ),
  );

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

    markConversationAsRead(conversationID).catch((err) => {
      // 已读上报失败不阻断 UI；dev 下打印，避免长期静默把未读 badge 卡住没人发现。
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat] markConversationAsRead failed', err);
      }
    });
    loadConversationMessages(conversationID)
      .then(() =>
        restoreConversationMessages({
          conversationID,
          sourceID:
            conversationType === SessionType.Single
              ? toImUserId(sourceID)
              : sourceID,
          sessionType: conversationType,
          maxMessages: 500,
        }),
      )
      .catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] load/restore conversation messages failed', err);
        }
      });

    return () => {
      setActiveConversation(null);
    };
  }, [conversationID, conversationType, setActiveConversation, sourceID]);

  useEffect(() => {
    if (!peerImId) return;
    void subscribeUserOnlineStatus([peerImId]).catch((err) => {
      // 拿不到状态时 UI 回落显示离线；dev 下记录，避免长期静默掉订阅。
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat] subscribeUserOnlineStatus failed', err);
      }
    });
    return () => {
      void unsubscribeUserOnlineStatus([peerImId]).catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] unsubscribeUserOnlineStatus failed', err);
        }
      });
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

  const handleCollectMessage = useCallback(
    async (message: ChatMessage) => {
      if (!conversationID) return;
      const input = buildCollectionInputFromMessage(message, {
        conversationID,
        conversationTitle,
      });
      if (!input) return;

      try {
        await createCollection(input);
        Alert.alert(
          t('chat.messageActions.collected'),
          t('chat.messageActions.collectedHint'),
        );
      } catch (error) {
        if (__DEV__) {
          console.warn('[ChatDetail] collect message failed', error);
        }
        Alert.alert(
          t('chat.messageActions.collectFailed'),
          t('chat.messageActions.collectFailedHint'),
        );
      }
    },
    [conversationID, conversationTitle, t],
  );

  const handleMessageLongPress = useCallback(
    (message: ChatMessage) => {
      if (message.type === 'date') return;
      Alert.alert(t('chat.messageActions.title'), undefined, [
        {
          text: t('chat.messageActions.collect'),
          onPress: () => {
            void handleCollectMessage(message);
          },
        },
        {
          text: t('chat.messageActions.forward'),
          onPress: () => {
            // Read the raw OpenIM item lazily (at tap time) so the message list
            // doesn't re-render on every incoming message. Lets the picker use
            // native forwarding, which preserves images/media.
            const raw = conversationID
              ? useIMStore
                  .getState()
                  .messagesByConversation[conversationID]?.find(
                    (m) => m.clientMsgID === message.id,
                  )
              : undefined;
            setPendingForward({ message, raw });
            router.push({ pathname: '/(tabs)/messages/forward-picker' });
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    },
    [conversationID, handleCollectMessage, setPendingForward, t],
  );

  const withMessageActions = useCallback(
    (message: ChatMessage, node: ReactElement) => (
      <Pressable onLongPress={() => handleMessageLongPress(message)} delayLongPress={350}>
        {node}
      </Pressable>
    ),
    [handleMessageLongPress],
  );

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'received':
        return withMessageActions(item, (
          <ReceivedBubble
            message={item}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            onAvatarPress={() => handleOpenMessageSender(item)}
          />
        ));
      case 'sent':
        return withMessageActions(item, (
          <SentBubble
            message={item}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            hideStatus={isGroupChat}
          />
        ));
      case 'location':
        return withMessageActions(item, (
          <LocationCard
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
          />
        ));
      case 'image':
        return withMessageActions(item, (
          <ImageBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'voice':
        return withMessageActions(item, (
          <VoiceBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'note-card':
        return withMessageActions(item, (
          <NoteCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(note) =>
              router.push(getNoteDetailHref(scope, note.noteId, note.ownerId ?? ''))
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'friend-card':
        return withMessageActions(item, (
          <FriendCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(card) =>
              router.push(getUserProfileHref(scope, card.userID, card.nickname))
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'transfer-card':
        return withMessageActions(item, (
          <TransferCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            hideStatus={isGroupChat}
          />
        ));
      default: return null;
    }
  }, [
    avatarUrl,
    conversationTitle,
    handleOpenMessageSender,
    isGroupChat,
    selfAvatarUri,
    selfName,
    scope,
    withMessageActions,
  ]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const handleAttachmentToggle = useCallback(() => {
    Keyboard.dismiss();
    setEmojiOpen(false);
    setAttachmentOpen((prev) => !prev);
  }, []);

  const handleEmojiToggle = useCallback(() => {
    Keyboard.dismiss();
    setAttachmentOpen(false);
    setEmojiOpen((prev) => !prev);
  }, []);

  const handleInsertEmoji = useCallback((emoji: string) => {
    setDraft((prev) => {
      // 光标位置可能落在旧文本之外（异步态），夹紧到当前长度避免越界。
      const start = Math.min(selectionRef.current.start, prev.length);
      const end = Math.min(selectionRef.current.end, prev.length);
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      const cursor = start + emoji.length;
      selectionRef.current = { start: cursor, end: cursor };
      setSelection({ start: cursor, end: cursor });
      return next;
    });
  }, []);

  const handleSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      selectionRef.current = event.nativeEvent.selection;
      // 插入后短暂受控把光标移到表情之后；用户再次移动光标时释放受控，交还输入法。
      setSelection((current) => (current ? undefined : current));
    },
    [],
  );

  const sendDraftAsText = useCallback(
    async (text: string) => {
      // 不日志 message 文本 —— 消息正文是 app 处理的最敏感数据。
      if (!text.trim() || !sourceID || isPreviewMode) {
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const sentMessage = await sendTextMessage({
          sourceID,
          sessionType: conversationType,
          text,
        });
        appendMessages(conversationID, [sentMessage]);
      } catch (error) {
        logChatSendFailure(error, {
          sessionType: conversationType,
          isGroupChat,
        });
        setSendError('消息发送失败，请重试');
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      isGroupChat,
      isPreviewMode,
      sourceID,
    ],
  );

  const handleVoicePress = useCallback(async () => {
    if (!sourceID || isPreviewMode || voiceActionBusy) return;

    setSendError(null);

    if (isVoiceRecording) {
      setVoiceActionBusy(true);
      try {
        const statusBeforeStop = voiceRecorder.getStatus();
        await voiceRecorder.stop();
        const statusAfterStop = voiceRecorder.getStatus();
        const soundPath =
          voiceRecorder.uri ?? statusAfterStop.url ?? statusBeforeStop.url;
        const elapsedMs =
          statusBeforeStop.durationMillis ||
          statusAfterStop.durationMillis ||
          (voiceRecordingStartedAt ? Date.now() - voiceRecordingStartedAt : 0);
        const duration = Math.max(1, Math.round(elapsedMs / 1000));

        setVoiceRecordingStartedAt(null);

        if (!soundPath) {
          throw new Error('录音文件生成失败');
        }

        const sent = await sendVoiceMessage({
          sourceID,
          sessionType: conversationType,
          soundPath,
          duration,
        });
        appendMessages(conversationID, [sent]);
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[chat] voice send failed',
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          );
        }
        setVoiceRecordingStartedAt(null);
        setSendError('语音发送失败，请重试');
      } finally {
        inFlightRef.current = false;
        setVoiceActionBusy(false);
        restoreRecordingAudioMode();
      }
      return;
    }

    if (inFlightRef.current) return;
    setVoiceActionBusy(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('权限不足', '请在系统设置开启麦克风权限');
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recordingAudioModeEnabledRef.current = true;
      const status = voiceRecorder.getStatus();
      if (!status.canRecord) {
        await voiceRecorder.prepareToRecordAsync();
      }
      Keyboard.dismiss();
      setAttachmentOpen(false);
      setEmojiOpen(false);
      voiceRecorder.record();
      setVoiceRecordingStartedAt(Date.now());
      inFlightRef.current = true;
    } catch (error) {
      if (__DEV__) {
        console.warn(
          '[chat] voice record failed',
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
        );
      }
      inFlightRef.current = false;
      setVoiceRecordingStartedAt(null);
      setSendError('录音启动失败，请重试');
      restoreRecordingAudioMode();
    } finally {
      setVoiceActionBusy(false);
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    isPreviewMode,
    isVoiceRecording,
    sourceID,
    restoreRecordingAudioMode,
    voiceActionBusy,
    voiceRecorder,
    voiceRecordingStartedAt,
  ]);

  useEffect(
    () => () => {
      // 用 JS 快照判断是否在录音，避免在已释放的 native 对象上调 getStatus()；
      // stop() 再用 try/catch + .catch 兜底（卸载时对象可能已被 hook 释放）。
      if (isRecordingRef.current) {
        try {
          void voiceRecorder.stop().catch(() => undefined);
        } catch {
          // native shared object 已释放，录音已随之结束，无需再 stop
        }
      }
      restoreRecordingAudioMode();
    },
    [restoreRecordingAudioMode, voiceRecorder],
  );

  const handleSendCurrentLocation = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    if (inFlightRef.current) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请在系统设置开启定位权限');
      return;
    }
    inFlightRef.current = true;
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
    } finally {
      inFlightRef.current = false;
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
    if (inFlightRef.current) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请在系统设置开启相册权限');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    // 用 || 而非 ??：URI 以 '/' 结尾时 pop() 返回空字符串，?? 不会触发 fallback。
    const filename = asset.uri.split('/').pop() || 'image.jpg';
    const contentType =
      resolveUploadContentType({
        mimeType: asset.mimeType,
        fileName: filename,
      }) ?? 'image/jpeg';

    inFlightRef.current = true;

    try {
      // 不日志 presign 返回的 fileUrl / uploadUrl —— 这是带签名的临时写凭证，
      // 任何能捕获 console 输出的渠道（adb logcat、屏幕录制、第三方 SDK 的
      // breadcrumb）拿到 uploadUrl 就能在过期前向同一对象写入任意内容。
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(filename),
        contentType,
        folder: 'chat',
      });
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, asset.uri);
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
      appendMessages(conversationID, [sentMessage]);
    } catch (error) {
      if (__DEV__) {
        console.warn(
          '[chat] image send failed',
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
        );
      }
      setSendError('图片发送失败，请重试');
    } finally {
      inFlightRef.current = false;
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

  const handleStartGroupAudioCall = useCallback(async () => {
    if (callStartingRef.current) return;

    if (!isGroupChat) {
      Alert.alert('语音通话', '当前只开放群聊语音通话');
      return;
    }

    if (isPreviewMode || !conversationID || !sourceID) {
      Alert.alert('语音通话', '群聊会话尚未准备好');
      return;
    }

    if (!authUser?.id) {
      Alert.alert('语音通话', '请先登录后再发起通话');
      return;
    }

    callStartingRef.current = true;
    setCallStarting(true);
    try {
      const members = await loadGroupMemberList(sourceID, 10_000);
      const inviteeIDs = Array.from(
        new Set(
          members
            .map((member) => fromImUserId(member.userID))
            .filter((userID) => userID && userID !== authUser.id),
        ),
      );

      if (inviteeIDs.length === 0) {
        Alert.alert('语音通话', '群内没有可邀请的其他成员');
        return;
      }

      const response = await createGroupCall({
        conversationID,
        callType: 'AUDIO',
        inviteeIDs,
      });
      if (!mountedRef.current) return;
      setActiveCall(response.call, response.livekit);
      router.push('/(chat)/group-call');
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert('语音通话', '发起失败，请稍后重试');
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat] start group audio call failed', error);
      }
    } finally {
      callStartingRef.current = false;
      if (mountedRef.current) {
        setCallStarting(false);
      }
    }
  }, [
    authUser?.id,
    conversationID,
    isGroupChat,
    isPreviewMode,
    setActiveCall,
    sourceID,
  ]);

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
        case 'voice-call':
          void handleStartGroupAudioCall();
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
      handleStartGroupAudioCall,
      openSharePicker,
      sourceID,
    ],
  );

  const handlePickNote = useCallback(
    async (note: NoteSummary) => {
      if (!sourceID || isPreviewMode) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const sent = await sendNoteCardMessage({
          sourceID,
          sessionType: conversationType,
          payload: {
            noteId: note.id,
            ownerId: authUser?.id ?? null,
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
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      appendMessages,
      authUser?.id,
      conversationID,
      conversationType,
      isPreviewMode,
      sourceID,
    ],
  );

  const handlePickFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!conversationID) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
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
      } finally {
        inFlightRef.current = false;
      }
    },
    [appendMessages, conversationID],
  );

  const handlePickFavorite = useCallback(
    async (item: UserCollection) => {
      const payload = getCollectedOpenIMMessagePayload(item.payload);
      if (payload?.messageType === 'voice' && payload.voice) {
        if (!sourceID || isPreviewMode) return;
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          const sent = await sendVoiceMessageFromSource({
            sourceID,
            sessionType: conversationType,
            sourceUrl: payload.voice.sourceUrl,
            soundPath: payload.voice.soundPath,
            duration: payload.voice.duration ?? 1,
            dataSize: payload.voice.dataSize,
          });
          appendMessages(conversationID, [sent]);
        } catch (error) {
          if (__DEV__) {
            console.warn('[ChatDetail] send collected voice failed', error);
          }
          setSendError('收藏语音发送失败，请重试');
        } finally {
          inFlightRef.current = false;
        }
        return;
      }

      const text = `⭐ ${item.title}${item.summary ? `\n${item.summary}` : ''}`;
      await sendDraftAsText(text);
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      isPreviewMode,
      sendDraftAsText,
      sourceID,
    ],
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
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const sent = await sendTransferCardMessage({
          sourceID,
          sessionType: conversationType,
          payload,
        });
        appendMessages(conversationID, [sent]);
      } catch {
        setSendError('转账卡片发送失败，但积分已扣减');
      } finally {
        inFlightRef.current = false;
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
    if (inFlightRef.current) return;
    inFlightRef.current = true;
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
    } catch (error) {
      logChatSendFailure(error, {
        sessionType: conversationType,
        isGroupChat,
      });
      setSendError('消息发送失败，请重试');
    } finally {
      inFlightRef.current = false;
      setSending(false);
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    draft,
    isGroupChat,
    isPreviewMode,
    sending,
    sourceID,
  ]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable onPress={handleOpenHeaderTarget}>
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
            router.push(
              getChatInfoTopHref(scope, {
                conversationID,
                sourceID,
                title: conversationTitle,
                conversationType: isGroupChat ? 'group' : 'private',
                originScope: scope,
              }),
            )
          }
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Divider />
      <View style={[s.messageArea, d.messageArea]}>
        {backgroundStyle.imageUri ? (
          <View pointerEvents="none" style={s.messageAreaBackground}>
            <ImageBackground
              source={{ uri: backgroundStyle.imageUri }}
              style={s.messageAreaBackground}
              resizeMode="cover"
            >
              <View style={[s.messageAreaOverlay, { backgroundColor: colors.overlay }]} />
            </ImageBackground>
          </View>
        ) : null}
        <FlatList
          ref={flatListRef}
          style={s.messageListSurface}
          data={messages}
          inverted
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[s.messageList, s.messageListContent, s.messageListInset]}
          showsVerticalScrollIndicator={false}
          // scrollToIndex 在 inverted + 没设 getItemLayout 时，目标 index 超出已渲染窗口
          // 就会抛 "scrollToIndex out of range"。fallback：先滚到能测到的最远 index，
          // 等下一帧布局完再精确跳到目标位置，避免搜索定位时整页崩。
          onScrollToIndexFailed={(info) => {
            const fallbackIndex = Math.min(
              info.highestMeasuredFrameIndex ?? info.index,
              info.index,
            );
            flatListRef.current?.scrollToIndex({
              index: fallbackIndex,
              animated: false,
            });
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.3,
              });
            }, 250);
          }}
        />
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
        {isVoiceRecording ? (
          <Text style={[s.voiceStatus, { color: colors.primary }]}>
            正在录音 {voiceElapsedSeconds} 秒
          </Text>
        ) : null}
      </View>
      <Divider />
      <View
        style={[
          s.inputBar,
          d.inputBar,
          {
            paddingBottom:
              attachmentOpen || emojiOpen ? Spacing.sm : insets.bottom || 28,
          },
        ]}
      >
        <Pressable
          style={[
            s.circleBtn,
            d.circleBtn,
            isVoiceRecording ? [s.voiceRecordingBtn, d.voiceRecordingBtn] : null,
          ]}
          onPress={handleVoicePress}
          disabled={isPreviewMode || voiceActionBusy}
          hitSlop={8}
        >
          <Ionicons
            name={isVoiceRecording ? 'stop' : 'mic'}
            size={18}
            color={isVoiceRecording ? colors.white : colors.textSecondary}
          />
        </Pressable>
        <View style={[s.composerShell, d.composerShell]}>
          <TextInput
            style={[s.composerInput, d.composerInput]}
            placeholder={isPreviewMode ? '当前仅预览聊天界面' : '输入消息...'}
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            selection={selection}
            onSelectionChange={handleSelectionChange}
            onSubmitEditing={handleSend}
            onFocus={() => {
              setAttachmentOpen(false);
              setEmojiOpen(false);
            }}
            editable={!isPreviewMode}
          />
          <Pressable onPress={handleEmojiToggle} hitSlop={8} disabled={isPreviewMode}>
            <Ionicons
              name="happy-outline"
              size={18}
              color={emojiOpen ? colors.primary : colors.textSecondary}
            />
          </Pressable>
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
      {emojiOpen ? (
        <View
          style={[
            d.attachmentPanel,
            { paddingBottom: insets.bottom || Spacing.md },
          ]}
        >
          <EmojiPicker onSelect={handleInsertEmoji} />
        </View>
      ) : null}
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
                disabled={item.id === 'voice-call' && callStarting}
              >
                <View style={[s.attachmentIcon, d.attachmentIcon]}>
                  <Ionicons
                    name={item.icon}
                    size={26}
                    color={
                      item.id === 'voice-call' && callStarting
                        ? colors.primary
                        : colors.text
                    }
                  />
                </View>
                <Text style={[s.attachmentLabel, { color: colors.textSecondary }]}>
                  {item.id === 'voice-call' && callStarting ? '呼叫中' : item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

    </View>
  );
}
