import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  PanResponder,
  Platform,
  UIManager,
  View,
  Text,
  TextInput,
  Share,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  ImageBackground,
  useWindowDimensions,
  type FlatList as FlatListType,
  type GestureResponderEvent,
} from 'react-native';
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
  CircleCardBubble,
  VerificationCardBubble,
  TransferCardBubble,
} from '@/features/chat/components/chat-bubble';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { VoiceRecordingOverlay } from '@/features/chat/components/voice-recording-overlay';
import {
  MessageActionMenu,
  type MessageAction,
} from '@/features/chat/components/MessageActionMenu';
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
  deleteLocalMessage,
  sendFriendCardMessage,
  sendImageMessage,
  sendLocationMessage,
  sendNoteCardMessage,
  sendQuoteMessage,
  sendTextAtMessage,
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
import type { NoteSummary } from '@/features/notes/types';
import { createCollection, type UserCollection } from '@/services/api/collections';
import {
  buildCollectionInputFromMessage,
  resolveCollectionSendPlan,
} from '@/features/chat/utils/message-collection';
import {
  getNotificationRestoreMaxMessages,
  hasMessageWithClientID,
} from '@/features/chat/utils/notification-scroll';
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
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { createGroupCall } from '@/services/api/calls';
import { getApiErrorMessage } from '@/services/api/errors';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import {
  assertLocalCanSendMessage,
  CreditPolicyError,
} from '@/services/api/credit-policy';
import { OnlineState, SessionType, type MessageItem } from '@openim/rn-client-sdk';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/types';
import {
  buildAtMessagePayload,
  buildQuotePreviewText,
  filterMentionCandidates,
  getActiveMentionQuery,
  getMentionsPresentInText,
  type MentionTarget,
} from '@/features/chat/utils/chat-send-payloads';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';

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

function getChatSendErrorMessage(error: unknown, fallback: string) {
  return error instanceof CreditPolicyError ? error.message : fallback;
}

type AttachmentId =
  | 'media'
  | 'camera'
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
  labelKey: string;
  label: string;
}[] = [
  { id: 'media', icon: 'image-outline', labelKey: 'chat.attachments.photos', label: '照片' },
  { id: 'camera', icon: 'camera-outline', labelKey: 'chat.attachments.camera', label: '拍照' },
  { id: 'voice-call', icon: 'call-outline', labelKey: 'chat.attachments.voiceCall', label: '语音通话' },
  { id: 'location', icon: 'location-outline', labelKey: 'chat.attachments.location', label: '位置' },
  { id: 'notes', icon: 'create-outline', labelKey: 'chat.attachments.notes', label: '笔记' },
  { id: 'friend-card', icon: 'person-outline', labelKey: 'chat.attachments.friendCard', label: '好友名片' },
  { id: 'favorites', icon: 'star-outline', labelKey: 'chat.attachments.favorites', label: '我的收藏' },
  { id: 'quick-reply', icon: 'rocket-outline', labelKey: 'chat.attachments.quickReply', label: '快捷语' },
  { id: 'transfer', icon: 'card-outline', labelKey: 'chat.attachments.transfer', label: '转账' },
];

// 工具面板每页最多 8 个（4 列 × 2 行），超出的横向翻页
const ATTACHMENT_PAGE_SIZE = 8;
const MENTION_CANDIDATE_LIMIT = 200;
const ATTACHMENT_PAGES: (typeof ATTACHMENT_ITEMS)[number][][] = Array.from(
  { length: Math.ceil(ATTACHMENT_ITEMS.length / ATTACHMENT_PAGE_SIZE) },
  (_, page) =>
    ATTACHMENT_ITEMS.slice(
      page * ATTACHMENT_PAGE_SIZE,
      page * ATTACHMENT_PAGE_SIZE + ATTACHMENT_PAGE_SIZE,
    ),
);

// Android 需显式开启 LayoutAnimation（iOS 默认可用）。
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 底部面板展开/收起的协调布局过渡：面板高度变化与消息区缩放一起平滑动，
// 输入栏位置由 flex 决定、始终在面板上方，不会割裂。稍慢一点更顺眼。
const PANEL_LAYOUT_ANIM = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

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
  quoteComposerBar: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quoteComposerText: {
    flex: 1,
    ...Typography.small,
  },
  mentionPicker: {
    maxHeight: 220,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  mentionName: {
    ...Typography.bodyRegular,
    flex: 1,
  },
  inputBar: {
    paddingTop: 10,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  composerActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  composerShell: {
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: Spacing.xs,
  },
  composerInput: { flex: 1, ...Typography.bodyRegular, fontSize: 16, padding: 0 },
  voiceHoldBar: {
    flex: 1,
    height: 52,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHoldText: { ...Typography.body, fontSize: 16, fontWeight: '600' },
  attachmentPanel: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  attachmentDragHandle: {
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  attachmentDragBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
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
  attachmentDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  attachmentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionTarget[]>([]);
  const mentionCandidatesCacheRef = useRef(new Map<string, MentionTarget[]>());
  const mentionCandidatesInflightRef = useRef(
    new Map<string, Promise<MentionTarget[]>>(),
  );
  const [mentionTargets, setMentionTargets] = useState<MentionTarget[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentPage, setAttachmentPage] = useState(0);
  const [attachmentPagerWidth, setAttachmentPagerWidth] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // 键盘弹起时 KeyboardAvoidingView 已把输入栏顶到键盘上方，此时再叠加 insets.bottom
  // 安全区 padding 会在输入框与键盘间留一道空白。跟踪键盘可见状态，弹起时收掉这层 padding。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
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
  // 语音输入模式：点话筒后输入框变「按住说话」；按住时滑到左侧取消、松手发送。
  const [voiceInputMode, setVoiceInputMode] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  // PanResponder 闭包只在创建时捕获一次，用 ref 把最新状态/回调透进去，避免读到旧值。
  const voicePressActiveRef = useRef(false);
  const voiceStartInProgressRef = useRef(false);
  const voiceRecordSessionRef = useRef(0);
  const recordingAudioModeSessionRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
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
      recordingAudioModeSessionRef.current = 0;
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
  // 只订阅当前会话的消息切片，而非整个 messagesByConversation map。
  // 其他会话来消息时 appendMessages 会新建顶层对象，但本会话的数组引用不变，
  // zustand 的 Object.is 相等判断因此不会触发本页重渲染——这是聊天页最大的流畅提升。
  const conversationMessages = useIMStore(
    (state) => state.messagesByConversation[conversationID],
  );
  const paramTitle =
    typeof params.title === 'string'
      ? params.title
      : t('chat.detail.title', { defaultValue: '聊天详情' });
  const conversationType =
    params.conversationType === 'group' ? SessionType.Group : SessionType.Single;
  const isGroupChat = conversationType === SessionType.Group;
  // 单聊标题响应式吃备注覆盖：用户在资料页改备注后即时刷新（参数仅作初始快照）。
  // 非空覆盖 → 用备注；空串（备注被清除）→ 回退到参数快照；未改过 → 用参数快照。
  // 群聊标题不是好友备注，保持参数原值。
  const remarkOverride = useFriendRemarkStore((state) =>
    isGroupChat ? undefined : state.remarks[sourceID],
  );
  const conversationTitle = remarkOverride
    ? remarkOverride.remark ?? remarkOverride.fallbackName ?? paramTitle
    : paramTitle;
  const avatarUrl =
    typeof params.avatarUrl === 'string' ? params.avatarUrl : undefined;
  const searchedMsgID =
    typeof params.searchedMsgID === 'string' ? params.searchedMsgID : '';
  const isPreviewMode = !conversationID;
  const visibleMentionCandidates = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionQuery),
    [mentionCandidates, mentionQuery],
  );

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

  // 跟踪键盘显隐：iOS 用 Will* 事件与 KeyboardAvoidingView 动画同步，避免空白闪一下。
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
    attachmentDragBar: { backgroundColor: colors.surfaceBorder },
    attachmentIcon: { backgroundColor: colors.surface },
    voiceHoldBarIdle: {
      backgroundColor: colors.inputBg,
      borderColor: colors.surfaceBorder,
    },
    voiceHoldBarActive: {
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
          maxMessages: getNotificationRestoreMaxMessages(searchedMsgID),
        }),
      )
      .then((restoreResult) => {
        if (!searchedMsgID) {
          return;
        }
        const localMessages =
          useIMStore.getState().messagesByConversation[conversationID] ?? [];
        if (hasMessageWithClientID(localMessages, searchedMsgID)) {
          return;
        }
        logClientDiagnostic('chat_notification_target_not_found', {
          conversationID,
          targetMsgID: searchedMsgID,
          fetched: restoreResult.fetched,
          inserted: restoreResult.inserted,
        });
      })
      .catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] load/restore conversation messages failed', err);
        }
      });

    return () => {
      setActiveConversation(null);
    };
  }, [
    conversationID,
    conversationType,
    searchedMsgID,
    setActiveConversation,
    sourceID,
  ]);

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
  // 按 MessageItem 引用缓存映射结果：未变化的消息保持同一 ChatMessage 引用，
  // FlatList 的 CellRenderer 因此跳过未变行的重渲染（无需给气泡加 memo）。
  // 某条消息被更新时（读回执/状态变化）会得到新的 MessageItem 引用 → 缓存未命中
  // → 只有那一行重渲染。currentUserID 变化时整体失效重建。
  const messageMapCacheRef = useRef<{
    userID: string | null;
    cache: WeakMap<MessageItem, ChatMessage>;
  }>({ userID: currentUserID, cache: new WeakMap() });

  const messages = useMemo(() => {
    const box = messageMapCacheRef.current;
    if (box.userID !== currentUserID) {
      box.userID = currentUserID;
      box.cache = new WeakMap();
    }
    const source = conversationMessages ?? [];
    const result: ChatMessage[] = [];
    // inverted 列表：index 0 = 最新消息，故从后往前取。
    for (let i = source.length - 1; i >= 0; i -= 1) {
      const raw = source[i];
      let mapped = box.cache.get(raw);
      if (!mapped) {
        const next = mapMessageItemToChatMessage(raw, currentUserID);
        if (!next) continue;
        box.cache.set(raw, next);
        mapped = next;
      }
      result.push(mapped);
    }
    return result;
  }, [currentUserID, conversationMessages]);

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
        sourceID,
        conversationType: isGroupChat ? 'group' : 'private',
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
    [conversationID, conversationTitle, isGroupChat, sourceID, t],
  );

  const [actionMenu, setActionMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<ChatMessage | null>(null);

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    const text = message.text?.trim();
    if (!text) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
    } catch {
      // copy is best-effort; ignore clipboard failures.
    }
  }, []);

  const handleForwardMessage = useCallback(
    (message: ChatMessage) => {
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
    [conversationID, setPendingForward],
  );

  const handleQuoteMessage = useCallback((message: ChatMessage) => {
    setQuoteTarget(message);
  }, []);

  const handleDeleteMessage = useCallback(
    (message: ChatMessage) => {
      if (!conversationID) return;
      Alert.alert(
        t('chat.messageActions.delete', { defaultValue: '删除' }),
        t('chat.messageActions.deleteConfirm', {
          defaultValue: '删除这条本地消息？',
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              void deleteLocalMessage(conversationID, message.id).catch((error) => {
                if (__DEV__) {
                  console.warn('[ChatDetail] delete local message failed', error);
                }
                Alert.alert(
                  t('chat.messageActions.deleteFailed', {
                    defaultValue: '删除失败',
                  }),
                  t('chat.messageActions.deleteFailedHint', {
                    defaultValue: '请稍后重试',
                  }),
                );
              });
            },
          },
        ],
      );
    },
    [conversationID, t],
  );

  const handleReportMessage = useCallback(() => {
    if (isGroupChat) {
      router.push({
        pathname: '/(tabs)/messages/report-friend',
        params: {
          targetType: 'group',
          groupID: sourceID,
          groupName: conversationTitle,
        },
      });
      return;
    }
    router.push({
      pathname: '/(tabs)/messages/report-friend',
      params: {
        targetType: 'friend',
        friendUserId: sourceID,
        friendName: conversationTitle,
      },
    });
  }, [conversationTitle, isGroupChat, sourceID]);

  const handleSaveMessage = useCallback(
    async (message: ChatMessage) => {
      const url = message.imageUrl ?? message.voiceUrl ?? message.voicePath ?? null;
      try {
        if (url) {
          await Share.share({ url, message: url });
          return;
        }
        if (message.text?.trim()) {
          await Share.share({ message: message.text.trim() });
          return;
        }
        Alert.alert(
          t('chat.messageActions.saveUnsupported', {
            defaultValue: '该消息暂不支持保存',
          }),
        );
      } catch {
        Alert.alert(
          t('chat.messageActions.saveFailed', { defaultValue: '保存失败' }),
          t('chat.messageActions.saveFailedHint', { defaultValue: '请稍后重试' }),
        );
      }
    },
    [t],
  );

  const handleMessageLongPress = useCallback(
    (message: ChatMessage, event: GestureResponderEvent) => {
      if (message.type === 'date') return;
      const { pageX, pageY } = event.nativeEvent;
      setActionMenu({ message, x: pageX, y: pageY });
    },
    [],
  );

  // Build the floating menu's items for the currently long-pressed message.
  const messageActions = useMemo<MessageAction[]>(() => {
    const message = actionMenu?.message;
    if (!message) return [];
    const actions: MessageAction[] = [];
    if (message.text?.trim()) {
      actions.push({
        key: 'copy',
        icon: 'copy-outline',
        label: t('chat.messageActions.copy', { defaultValue: '复制' }),
        onPress: () => void handleCopyMessage(message),
      });
    }
    actions.push({
      key: 'quote',
      icon: 'return-up-back-outline',
      label: t('chat.messageActions.quote', { defaultValue: '引用' }),
      onPress: () => handleQuoteMessage(message),
    });
    actions.push({
      key: 'forward',
      icon: 'arrow-redo-outline',
      label: t('chat.messageActions.forward'),
      onPress: () => handleForwardMessage(message),
    });
    actions.push({
      key: 'collect',
      icon: 'star-outline',
      label: t('chat.messageActions.collect'),
      onPress: () => void handleCollectMessage(message),
    });
    actions.push({
      key: 'delete',
      icon: 'trash-outline',
      label: t('chat.messageActions.delete', { defaultValue: '删除' }),
      onPress: () => handleDeleteMessage(message),
    });
    actions.push({
      key: 'report',
      icon: 'warning-outline',
      label: t('chat.messageActions.report', { defaultValue: '举报' }),
      onPress: handleReportMessage,
    });
    actions.push({
      key: 'save',
      icon: 'download-outline',
      label: t('chat.messageActions.save', { defaultValue: '保存' }),
      onPress: () => void handleSaveMessage(message),
    });
    return actions;
  }, [
    actionMenu,
    handleCollectMessage,
    handleCopyMessage,
    handleDeleteMessage,
    handleForwardMessage,
    handleQuoteMessage,
    handleReportMessage,
    handleSaveMessage,
    t,
  ]);

  const withMessageActions = useCallback(
    (message: ChatMessage, node: ReactElement) => (
      <Pressable
        onLongPress={(event) => handleMessageLongPress(message, event)}
        delayLongPress={350}
      >
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
            onSectionPress={(note, section) =>
              router.push(getNoteDetailHref(scope, note.noteId, note.ownerId ?? '', section))
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
      case 'circle-card':
        return withMessageActions(item, (
          <CircleCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(card) =>
              router.push(`/(tabs)/discover/circle/${encodeURIComponent(card.circleId)}`)
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'verification-card':
        return withMessageActions(item, (
          <VerificationCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={item.senderName ?? conversationTitle}
            senderAvatarUri={avatarUrl}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(card) =>
              router.push({
                pathname: '/(tabs)/discover/verification/[id]',
                params: { id: card.invitationId },
              })
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

  // 面板展开/收起前调一次，让这次布局变化（面板高度 + 消息区缩放）平滑过渡。
  const animatePanels = useCallback(() => {
    LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
  }, []);

  const handleAttachmentToggle = useCallback(() => {
    Keyboard.dismiss();
    animatePanels();
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    setAttachmentPage(0);
    setAttachmentOpen((prev) => !prev);
  }, [animatePanels]);

  const handleEmojiToggle = useCallback(() => {
    Keyboard.dismiss();
    animatePanels();
    setAttachmentOpen(false);
    setMentionPickerVisible(false);
    setEmojiOpen((prev) => !prev);
  }, [animatePanels]);

  // 在消息区下拉/滚动时收起底部面板与键盘（微信式：拖动列表即收回输入区叠层）。
  const closeInputPanels = useCallback(() => {
    animatePanels();
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setMentionPickerVisible(false);
    Keyboard.dismiss();
  }, [animatePanels]);

  // 附件面板下滑收回。面板里是一堆 Pressable 网格项，触摸落到子项上时子项会先抢
  // responder；必须用「捕获阶段」onMove...Capture 才能在明显向下滑时从子项手里截下手势。
  // 阈值要求纵向位移明显大于横向（*1.5），避免点击/斜滑误触发，普通点击（无位移）仍走子项。
  const attachmentPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.5,
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy > 40) {
            LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
            setAttachmentOpen(false);
          }
        },
        onPanResponderTerminate: () => {},
      }),
    [],
  );

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
      const nextSelection = event.nativeEvent.selection;
      selectionRef.current = nextSelection;
      if (isGroupChat) {
        const activeQuery = getActiveMentionQuery(draft, nextSelection.start);
        setMentionQuery(activeQuery);
        if (activeQuery === null) {
          setMentionPickerVisible(false);
        } else {
          setMentionPickerVisible(true);
        }
      }
      // 插入后短暂受控把光标移到表情之后；用户再次移动光标时释放受控，交还输入法。
      setSelection((current) => (current ? undefined : current));
    },
    [draft, isGroupChat],
  );

  const loadMentionCandidates = useCallback(async () => {
    if (!isGroupChat || !sourceID) return;
    const cached = mentionCandidatesCacheRef.current.get(sourceID);
    if (cached) {
      setMentionCandidates(cached);
      return;
    }

    let request = mentionCandidatesInflightRef.current.get(sourceID);
    if (!request) {
      request = loadGroupMemberList(sourceID, MENTION_CANDIDATE_LIMIT)
        .then((members) =>
          members
            .filter((member) => member.userID && member.userID !== currentUserID)
            .map((member) => ({
              userID: member.userID,
              nickname: member.nickname || member.userID,
            })),
        )
        .then((candidates) => {
          mentionCandidatesCacheRef.current.set(sourceID, candidates);
          return candidates;
        })
        .finally(() => {
          mentionCandidatesInflightRef.current.delete(sourceID);
        });
      mentionCandidatesInflightRef.current.set(sourceID, request);
    }

    try {
      const candidates = await request;
      if (!mountedRef.current) return;
      setMentionCandidates(candidates);
    } catch (error) {
      if (__DEV__) {
        console.warn('[chat] load mention candidates failed', error);
      }
      if (mountedRef.current) setMentionCandidates([]);
    }
  }, [currentUserID, isGroupChat, sourceID]);

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      setMentionTargets((current) => getMentionsPresentInText(next, current));
      if (!isGroupChat) {
        setMentionQuery(null);
        setMentionPickerVisible(false);
        return;
      }
      const selectionStart = selectionRef.current.start;
      const inferredCursor =
        selectionStart === draft.length && next.length >= draft.length
          ? next.length
          : Math.min(selectionStart, next.length);
      const activeQuery = getActiveMentionQuery(next, inferredCursor);
      setMentionQuery(activeQuery);
      if (activeQuery !== null) {
        setMentionPickerVisible(true);
        void loadMentionCandidates();
      } else {
        setMentionPickerVisible(false);
      }
    },
    [draft, isGroupChat, loadMentionCandidates],
  );

  const handlePickMention = useCallback((target: MentionTarget) => {
    setDraft((current) => {
      const cursor = Math.min(selectionRef.current.start, current.length);
      const beforeCursor = current.slice(0, cursor);
      const atIndex = beforeCursor.lastIndexOf('@');
      const insert = `@${target.nickname} `;
      const next =
        atIndex >= 0
          ? `${current.slice(0, atIndex)}${insert}${current.slice(cursor)}`
          : `${current}${insert}`;
      const nextCursor = (atIndex >= 0 ? atIndex : current.length) + insert.length;
      selectionRef.current = { start: nextCursor, end: nextCursor };
      setSelection({ start: nextCursor, end: nextCursor });
      return next;
    });
    setMentionTargets((current) => {
      if (current.some((item) => item.userID === target.userID)) return current;
      return [...current, target];
    });
    setMentionQuery(null);
    setMentionPickerVisible(false);
  }, []);

  const sendDraftAsText = useCallback(
    async (text: string) => {
      // 不日志 message 文本 —— 消息正文是 app 处理的最敏感数据。
      if (!text.trim() || !sourceID || isPreviewMode) {
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      // 乐观发送：创建即上屏（发送中态）；成功后同 clientMsgID 覆盖，失败标记失败态。
      let optimisticClientMsgID: string | null = null;
      try {
        const sentMessage = await sendTextMessage({
          sourceID,
          sessionType: conversationType,
          text,
          onCreate: (message) => {
            optimisticClientMsgID = message.clientMsgID;
            appendMessages(conversationID, [message]);
          },
        });
        appendMessages(conversationID, [sentMessage]);
      } catch (error) {
        if (optimisticClientMsgID) {
          useIMStore
            .getState()
            .markMessageSendFailed(conversationID, optimisticClientMsgID);
        }
        logChatSendFailure(error, {
          sessionType: conversationType,
          isGroupChat,
        });
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.sendFailedText', {
                defaultValue: '消息发送失败，请重试',
              }),
            ),
          );
        }
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
      t,
    ],
  );

  // 切换「语音输入模式」：文本框 ↔ 按住说话。退出时若在录音则一并取消。
  const toggleVoiceInputMode = useCallback(() => {
    if (isPreviewMode) return;
    Keyboard.dismiss();
    LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setVoiceInputMode((prev) => !prev);
  }, [isPreviewMode]);

  // 按住开始录音。权限/音频模式准备好后 record()，失败时复位状态。
  const startHoldRecording = useCallback(async () => {
    if (!sourceID || isPreviewMode || voiceActionBusy) return;
    if (inFlightRef.current || voiceStartInProgressRef.current) return;
    voicePressActiveRef.current = true;
    voiceStartInProgressRef.current = true;
    const recordSession = ++voiceRecordSessionRef.current;
    setSendError(null);
    cancelArmedRef.current = false;
    setCancelArmed(false);
    setVoiceActionBusy(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.microphone'));
        voicePressActiveRef.current = false;
        voiceRecordSessionRef.current += 1;
        return;
      }
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recordingAudioModeEnabledRef.current = true;
      recordingAudioModeSessionRef.current = recordSession;
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        restoreRecordingAudioMode();
        return;
      }
      const status = voiceRecorder.getStatus();
      if (!status.canRecord) {
        await voiceRecorder.prepareToRecordAsync();
      }
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        if (recordingAudioModeSessionRef.current === recordSession) {
          restoreRecordingAudioMode();
        }
        return;
      }
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
      if (mountedRef.current) {
        setVoiceRecordingStartedAt(null);
        setSendError(
          t('chat.detail.recordStartFailed', {
            defaultValue: '录音启动失败，请重试',
          }),
        );
      }
      if (recordingAudioModeSessionRef.current === recordSession) {
        restoreRecordingAudioMode();
      }
    } finally {
      if (voiceRecordSessionRef.current === recordSession || !voicePressActiveRef.current) {
        voiceStartInProgressRef.current = false;
      }
      if (mountedRef.current) setVoiceActionBusy(false);
    }
  }, [
    isPreviewMode,
    restoreRecordingAudioMode,
    sourceID,
    t,
    voiceActionBusy,
    voiceRecorder,
  ]);

  // 松手结束录音。cancel=true 丢弃；否则发送。录音过短（<800ms）按误触丢弃。
  const finishHoldRecording = useCallback(
    async (cancel: boolean) => {
      // 还没真正开始录音（极快松手 / 权限未过）→ 直接复位，避免空 stop。
      voicePressActiveRef.current = false;
      voiceRecordSessionRef.current += 1;
      if (!isRecordingRef.current && voiceRecordingStartedAt == null) {
          if (mountedRef.current) setVoiceActionBusy(false);
        return;
      }
      setVoiceActionBusy(true);
      try {
        const statusBeforeStop = voiceRecorder.getStatus();
        const soundPath = voiceRecorder.uri ?? statusBeforeStop.url;
        await voiceRecorder.stop();
        const elapsedMs =
          statusBeforeStop.durationMillis ||
          (voiceRecordingStartedAt ? Date.now() - voiceRecordingStartedAt : 0);
        const duration = Math.max(1, Math.round(elapsedMs / 1000));
        setVoiceRecordingStartedAt(null);

        if (cancel || elapsedMs < 800) return; // 取消 / 误触：丢弃不发
        if (!soundPath) throw new Error('录音文件生成失败');

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
        if (mountedRef.current) {
          setVoiceRecordingStartedAt(null);
          if (!cancel) {
            setSendError(
              getChatSendErrorMessage(
                error,
                t('chat.detail.voiceSendFailed', {
                  defaultValue: '语音发送失败，请重试',
                }),
              ),
            );
          }
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setVoiceActionBusy(false);
        restoreRecordingAudioMode();
        cancelArmedRef.current = false;
        if (mountedRef.current) setCancelArmed(false);
      }
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      restoreRecordingAudioMode,
      sourceID,
      t,
      voiceRecorder,
      voiceRecordingStartedAt,
    ],
  );

  // PanResponder 创建一次即可，用 ref 透传最新回调，避免闭包读旧值。
  const startHoldRef = useRef(startHoldRecording);
  const finishHoldRef = useRef(finishHoldRecording);
  const windowWidthRef = useRef(windowWidth);
  useEffect(() => {
    startHoldRef.current = startHoldRecording;
    finishHoldRef.current = finishHoldRecording;
    windowWidthRef.current = windowWidth;
  }, [startHoldRecording, finishHoldRecording, windowWidth]);

  const voicePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          void startHoldRef.current();
        },
        onPanResponderMove: (_evt, gesture) => {
          // 手指滑到屏幕左侧 40% 区域 → 进入取消态。
          const armed = gesture.moveX > 0 && gesture.moveX < windowWidthRef.current * 0.4;
          if (armed !== cancelArmedRef.current) {
            cancelArmedRef.current = armed;
            setCancelArmed(armed);
          }
        },
        onPanResponderRelease: () => {
          void finishHoldRef.current(cancelArmedRef.current);
        },
        onPanResponderTerminate: () => {
          // 手势被系统打断（来电等）→ 当作取消，丢弃录音。
          void finishHoldRef.current(true);
        },
      }),
    [],
  );

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
      Alert.alert(t('permissions.insufficientTitle'), t('permissions.location'));
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
    } catch (error) {
      if (mountedRef.current) {
        setSendError(
          getChatSendErrorMessage(
            error,
            t('chat.detail.locationSendFailed', {
              defaultValue: '位置发送失败，请重试',
            }),
          ),
        );
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    isPreviewMode,
    sourceID,
    t,
  ]);

  // 相册选择与拍照共用同一套「上传→发送」流程，只有获取 asset 的来源不同。
  const uploadAndSendImageAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      // 用 || 而非 ??：URI 以 '/' 结尾时 pop() 返回空字符串，?? 不会触发 fallback。
      const filename = asset.uri.split('/').pop() || 'image.jpg';
      const contentType =
        resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName: filename,
        }) ?? 'image/jpeg';

      inFlightRef.current = true;

      try {
        // 提前拦一次：文本等廉价路径靠 reportSend 统一 gate 即可，但图片要先
        // presign+上传（有成本，且会发一个带签名的临时写凭证给可能被拦的用户）。
        // 在动手上传前就挡掉，避免无谓开销与凭证外泄面。发送本身仍会在 reportSend
        // 再兜一层，两处同源（assertLocalCanSendMessage），不会产生口径分叉。
        assertLocalCanSendMessage();
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
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.imageSendFailed', {
                defaultValue: '图片发送失败，请重试',
              }),
            ),
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [appendMessages, conversationID, conversationType, sourceID, t],
  );

  const handlePickMedia = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    if (inFlightRef.current) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('permissions.insufficientTitle'), t('permissions.photoLibrary'));
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
    await uploadAndSendImageAsset(result.assets[0]);
  }, [isPreviewMode, sourceID, t, uploadAndSendImageAsset]);

  const handleTakePhoto = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    if (inFlightRef.current) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('permissions.insufficientTitle'), t('permissions.camera'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    await uploadAndSendImageAsset(result.assets[0]);
  }, [isPreviewMode, sourceID, t, uploadAndSendImageAsset]);

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
      Alert.alert(t('chat.call.title'), t('chat.call.groupOnly'));
      return;
    }

    if (isPreviewMode || !conversationID || !sourceID) {
      Alert.alert(t('chat.call.title'), t('chat.call.groupNotReady'));
      return;
    }

    if (!authUser?.id) {
      Alert.alert(t('chat.call.title'), t('chat.call.notLoggedIn'));
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
        Alert.alert(t('chat.call.title'), t('chat.call.noOtherMembers'));
        return;
      }

      const response = await createGroupCall({
        conversationID,
        callType: 'AUDIO',
        inviteeIDs,
      });
      if (!mountedRef.current) return;
      setActiveCall(response.call, response.livekit);
      router.push('/(chat)/group-call' as never);
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          t('chat.call.title'),
          getApiErrorMessage(error, t('chat.call.initiateFailed')),
        );
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
    t,
  ]);

  const handleAttachmentAction = useCallback(
    (id: AttachmentId) => {
      LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
      setAttachmentOpen(false);
      switch (id) {
        case 'media':
          void handlePickMedia();
          return;
        case 'camera':
          void handleTakePhoto();
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
            Alert.alert(t('chat.transferTitle'), t('chat.transferGroupNotSupported'));
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
      handleTakePhoto,
      handleSendCurrentLocation,
      handleStartGroupAudioCall,
      openSharePicker,
      sourceID,
      t,
    ],
  );

  const handlePickNote = useCallback(
    async (note: NoteSummary) => {
      if (!sourceID || isPreviewMode) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const noteCardPayload = {
          ...buildNoteCardPayloadFromSummary(note, authUser?.id ?? null),
          ownerId: authUser?.id ?? null,
        };
        const sent = await sendNoteCardMessage({
          sourceID,
          sessionType: conversationType,
          payload: noteCardPayload,
        });
        appendMessages(conversationID, [sent]);
      } catch (error) {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.noteSendFailed', {
                defaultValue: '笔记发送失败，请重试',
              }),
            ),
          );
        }
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
      t,
    ],
  );

  const handlePickFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!conversationID) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const sent = await sendFriendCardMessage({
          targetConversationID: conversationID,
          userID: friend.id,
          nickname: friend.nickname,
          faceURL: friend.avatarUrl ?? '',
        });
        appendMessages(conversationID, [sent]);
      } catch (error) {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.cardSendFailed', {
                defaultValue: '名片发送失败，请重试',
              }),
            ),
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [appendMessages, conversationID, t],
  );

  const handlePickFavorite = useCallback(
    async (item: UserCollection) => {
      if (!sourceID || isPreviewMode) return;

      // 收藏的是啥就原样发啥：能按原类型还原的（文本/语音/笔记/名片）忠实重建，
      // 不加 title 等装饰；其余回退成干净文本。
      const plan = resolveCollectionSendPlan(item);

      // 文本走统一草稿发送路径（自带 inFlightRef 防抖）。
      if (plan.kind === 'text') {
        await sendDraftAsText(plan.text);
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        let sent;
        switch (plan.kind) {
          case 'voice':
            sent = await sendVoiceMessageFromSource({
              sourceID,
              sessionType: conversationType,
              sourceUrl: plan.sourceUrl,
              soundPath: plan.soundPath,
              duration: plan.duration,
              dataSize: plan.dataSize,
            });
            break;
          case 'note':
            sent = await sendNoteCardMessage({
              sourceID,
              sessionType: conversationType,
              payload: plan.noteCard,
            });
            break;
          case 'friend':
            sent = await sendFriendCardMessage({
              targetConversationID: conversationID,
              userID: plan.friendCard.userID,
              nickname: plan.friendCard.nickname,
              faceURL: plan.friendCard.faceURL,
              persona: plan.friendCard.persona,
              displayIcons: plan.friendCard.displayIcons,
            });
            break;
        }
        if (sent) {
          appendMessages(conversationID, [sent]);
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[ChatDetail] send collected item failed', error);
        }
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.favoriteSendFailed', {
                defaultValue: '收藏内容发送失败，请重试',
              }),
            ),
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      appendMessages,
      conversationID,
      conversationType,
      isPreviewMode,
      sendDraftAsText,
      sourceID,
      t,
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
      } catch (error) {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.transferCardSendFailed', {
                defaultValue: '转账卡片发送失败，但积分已扣减',
              }),
            ),
          );
        }
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
      t,
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
      const rawQuote = quoteTarget
        ? useIMStore
            .getState()
            .messagesByConversation[conversationID]?.find(
              (m) => m.clientMsgID === quoteTarget.id,
            )
        : undefined;
      const activeMentionTargets = getMentionsPresentInText(nextText, mentionTargets);
      const sentMessage =
        quoteTarget && rawQuote
          ? await sendQuoteMessage({
              sourceID,
              sessionType: conversationType,
              text: nextText,
              message: rawQuote,
            })
          : isGroupChat && activeMentionTargets.length > 0
            ? await sendTextAtMessage({
                sourceID,
                sessionType: conversationType,
                ...buildAtMessagePayload(nextText, activeMentionTargets),
              })
          : await sendTextMessage({
              sourceID,
              sessionType: conversationType,
              text: nextText,
            });
      appendMessages(conversationID, [sentMessage]);
      if (mountedRef.current) setDraft('');
      if (mountedRef.current) setQuoteTarget(null);
      if (mountedRef.current) setMentionTargets([]);
      if (mountedRef.current) setMentionQuery(null);
      if (mountedRef.current) setMentionPickerVisible(false);
    } catch (error) {
      logChatSendFailure(error, {
        sessionType: conversationType,
        isGroupChat,
      });
      if (mountedRef.current) {
        setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.sendFailedText', {
                defaultValue: '消息发送失败，请重试',
              }),
            ),
          );
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  }, [
    appendMessages,
    conversationID,
    conversationType,
    draft,
    isGroupChat,
    isPreviewMode,
    mentionTargets,
    quoteTarget,
    sending,
    sourceID,
    t,
  ]);

  return (
    <KeyboardAvoidingView
      style={[d.container, { paddingTop: insets.top }]}
      // iOS：键盘弹起时给容器底部加 padding，把输入框顶到键盘上方。
      // Android 走系统 adjustResize，无需 JS 介入（behavior=undefined）。
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
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
                  ? t('chat.detail.statusSelf', { defaultValue: '自己' })
                  : conversationType !== SessionType.Single
                    ? t('chat.detail.statusGroup', { defaultValue: '群聊' })
                    : peerOnline
                      ? t('chat.detail.statusOnline', { defaultValue: '在线' })
                      : t('chat.detail.statusOffline', {
                          defaultValue: '离线',
                        })}
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
          // 虚拟化调优：限制单批渲染数与窗口大小，降低活跃/长会话的渲染与内存压力。
          // 消息气泡高度可变，无法安全提供 getItemLayout，故只调这几个安全项；
          // removeClippedSubviews 仅在 Android 开启（iOS 上 inverted 列表可能出现空白格）。
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={[s.messageList, s.messageListContent, s.messageListInset]}
          showsVerticalScrollIndicator={false}
          // 下拉/滚动消息列表即收起底部面板与键盘（微信式）。on-drag 让键盘跟手滑落。
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={closeInputPanels}
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
            {t('chat.detail.previewNotice', {
              defaultValue: '当前仅预览聊天界面，消息发送会在 IM 接通后开放。',
            })}
          </Text>
        ) : null}
        {sendError ? (
          <Text style={[s.sendError, Typography.small, { color: colors.error }]}>
            {sendError}
          </Text>
        ) : null}
        {isVoiceRecording ? (
          <Text style={[s.voiceStatus, { color: colors.primary }]}>
            {t('chat.detail.recordingSeconds', {
              defaultValue: '正在录音 {{seconds}} 秒',
              seconds: voiceElapsedSeconds,
            })}
          </Text>
        ) : null}
      </View>
      <Divider />
      {mentionPickerVisible ? (
        <View style={[s.mentionPicker, d.composerShell]}>
          <FlatList
            data={visibleMentionCandidates}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(member) => member.userID}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={4}
            renderItem={({ item: member }) => (
              <Pressable
                style={s.mentionRow}
                onPress={() => handlePickMention(member)}
              >
                <Avatar size={28} shape="square" name={member.nickname} />
                <Text
                  style={[s.mentionName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {member.nickname}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={s.mentionRow}>
                <Text style={[s.mentionName, { color: colors.textSecondary }]}>
                  {t('chat.mentions.empty', { defaultValue: '暂无可 @ 的成员' })}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}
      {quoteTarget ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {buildQuotePreviewText(quoteTarget, t)}
          </Text>
          <Pressable onPress={() => setQuoteTarget(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <View
        style={[
          s.inputBar,
          d.inputBar,
          {
            // 键盘弹起 / 面板展开时无需安全区 padding（键盘或面板已占住底部），紧贴即可；
            // 仅在底部裸露时留 insets.bottom 让输入栏避开 home indicator。
            paddingBottom:
              attachmentOpen || emojiOpen || keyboardVisible
                ? Spacing.sm
                : insets.bottom || 28,
          },
        ]}
      >
        {/* 左侧：语音模式→切回键盘；文本模式→话筒。录音中由全屏浮层接管，禁用。 */}
        <Pressable
          key="voice-left"
          style={[s.circleBtn, d.circleBtn]}
          onPress={toggleVoiceInputMode}
          disabled={isPreviewMode || isVoiceRecording}
          hitSlop={8}
        >
          <Ionicons
            name={voiceInputMode ? 'create-outline' : 'mic'}
            size={22}
            color={colors.textSecondary}
          />
        </Pressable>

        {/* 中间：文本模式=输入框；语音模式=按住说话（gesture 元素全程保持挂载）。 */}
        {voiceInputMode ? (
          <View
            key="voice-hold-bar"
            style={[
              s.voiceHoldBar,
              isVoiceRecording ? d.voiceHoldBarActive : d.voiceHoldBarIdle,
            ]}
            {...voicePanResponder.panHandlers}
          >
            <Text
              style={[
                s.voiceHoldText,
                { color: isVoiceRecording ? colors.white : colors.text },
              ]}
            >
              {isVoiceRecording
                ? cancelArmed
                  ? t('chat.detail.voiceReleaseCancel', {
                      defaultValue: '松开 取消',
                    })
                  : t('chat.detail.voiceReleaseSend', {
                      defaultValue: '松开发送 {{seconds}}"',
                      seconds: voiceElapsedSeconds,
                    })
                : t('chat.detail.voiceHoldToTalk', {
                    defaultValue: '按住 说话',
                  })}
            </Text>
          </View>
        ) : (
          <View key="text-shell" style={[s.composerShell, d.composerShell]}>
            <TextInput
              style={[s.composerInput, d.composerInput]}
              placeholder={
                isPreviewMode
                  ? t('chat.detail.previewPlaceholder', {
                      defaultValue: '当前仅预览聊天界面',
                    })
                  : t('chat.detail.inputPlaceholder', {
                      defaultValue: '输入消息...',
                    })
              }
              placeholderTextColor={colors.textSecondary}
              value={draft}
              onChangeText={handleDraftChange}
              selection={selection}
              onSelectionChange={handleSelectionChange}
              onSubmitEditing={handleSend}
              onFocus={() => {
                LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
                setAttachmentOpen(false);
                setEmojiOpen(false);
                setMentionPickerVisible(false);
              }}
              editable={!isPreviewMode}
            />
            <Pressable onPress={handleEmojiToggle} hitSlop={8} disabled={isPreviewMode}>
              <Ionicons
                name="happy-outline"
                size={22}
                color={emojiOpen ? colors.primary : colors.textSecondary}
              />
            </Pressable>
          </View>
        )}

        {/* 右侧：发送/附件。录音中由全屏浮层接管，禁用。 */}
        <Pressable
          key="voice-right"
          style={[s.circleBtn, s.composerActionBtn, d.circleBtn, d.composerActionBtn]}
          onPress={draft.trim() ? handleSend : handleAttachmentToggle}
          disabled={sending || isPreviewMode || isVoiceRecording}
        >
          <Ionicons
            name={draft.trim() ? 'send' : 'add'}
            size={22}
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
          {...attachmentPanResponder.panHandlers}
        >
          <View style={s.attachmentDragHandle}>
            <View style={[s.attachmentDragBar, d.attachmentDragBar]} />
          </View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={ATTACHMENT_PAGES.length > 1}
            onLayout={(e) => setAttachmentPagerWidth(e.nativeEvent.layout.width)}
            onMomentumScrollEnd={(e) => {
              const w = attachmentPagerWidth || windowWidth - Spacing.md * 2;
              if (w > 0) {
                setAttachmentPage(Math.round(e.nativeEvent.contentOffset.x / w));
              }
            }}
          >
            {ATTACHMENT_PAGES.map((page, pageIndex) => (
              <View
                key={pageIndex}
                style={[
                  s.attachmentGrid,
                  { width: attachmentPagerWidth || windowWidth - Spacing.md * 2 },
                ]}
              >
                {page.map((item) => (
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
                    <Text
                      style={[s.attachmentLabel, { color: colors.textSecondary }]}
                    >
                      {item.id === 'voice-call' && callStarting
                        ? t('chat.call.calling', { defaultValue: '呼叫中' })
                        : t(item.labelKey, { defaultValue: item.label })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
          {ATTACHMENT_PAGES.length > 1 ? (
            <View style={s.attachmentDots}>
              {ATTACHMENT_PAGES.map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.attachmentDot,
                    {
                      backgroundColor:
                        i === attachmentPage
                          ? colors.primary
                          : colors.surfaceBorder,
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <MessageActionMenu
        anchor={actionMenu ? { x: actionMenu.x, y: actionMenu.y } : null}
        actions={messageActions}
        onDismiss={() => setActionMenu(null)}
      />

      {/* 微信式全屏录音浮层：录音时盖在最上层，纯展示（pointerEvents none）。 */}
      {isVoiceRecording ? (
        <VoiceRecordingOverlay
          cancelArmed={cancelArmed}
          elapsedSeconds={voiceElapsedSeconds}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
