import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Alert,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  PanResponder,
  Platform,
  UIManager,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  ImageBackground,
  useWindowDimensions,
  type FlatList as FlatListType,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation, useSegments } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import {
  DatePill,
  SystemNoticePill,
  ReceivedBubble,
  SentBubble,
  LocationCard,
  ImageBubble,
  VideoBubble,
  VoiceBubble,
  NoteCardBubble,
  FriendCardBubble,
  CircleCardBubble,
  QrCardBubble,
  PlazaPostCardBubble,
  VerificationCardBubble,
  TransferCardBubble,
  CallRecordBubble,
} from '@/features/chat/components/chat-bubble';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { VoiceRecordingOverlay } from '@/features/chat/components/voice-recording-overlay';
import { PhotoEditorModal } from '@/features/chat/components/photo-editor-modal';
import {
  MediaSourceSheet,
  type MediaSourceAction,
} from '@/features/chat/components/media-source-sheet';
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
  getCircleDetailHref,
  getPlazaPostDetailHref,
  getVerificationDetailHref,
} from '@/features/user/utils/routes';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
// 消息数据面已切到 chat-core;成员目录 / @ 候选 / 在线状态仍走 OpenIM 双轨
// (OpenIM groupID === circle.id,ID 同值,Phase 3 随成员子系统一起迁)。
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';
import {
  ensureCircleConversation,
  ensureDirectConversation,
  failMediaSend,
  finishMediaSend,
  hasMoreHistory,
  loadConversationMessages,
  loadOlderConversationMessages,
  resetHistoryCursor,
  markConversationAsRead,
  retryFailedChatMessage,
  startMediaSend,
  sendCardMessage,
  sendImageMessage,
  sendVideoMessage,
  sendLocationMessage,
  sendQuoteMessage,
  sendTextMessage,
  sendVoiceMessage,
} from '@/chat-core/client';
import { waitForSendSlot } from '@/features/chat/utils/send-slot';
import {
  getChatSendErrorMessage,
  reportChatSendFailure,
} from '@/chat-core/send-errors';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import {
  createChatMessageMapCache,
  mapChatMessageDtosToUI,
} from '@/chat-core/message-mappers';
import { fetchChatMembers, fetchMessageReaders } from '@/chat-core/api';
import {
  queryChatPresence,
  revokeChatMessage,
  sendChatEditMessage,
  sendChatReaction,
  sendChatTyping,
} from '@/chat-core/socket-manager';
import { CHAT_REACTION_EMOJIS } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useAuthStore } from '@/stores/authStore';
import { type FriendProfile } from '@/services/api/friends';
import type { NoteSummary } from '@/features/notes/types';
import {
  collectNote,
  fetchNoteDetail,
  importNoteChatMedia,
} from '@/services/api/notes';
import {
  buildNoteSendTasks,
  noteSendWindowDelayMs,
  recordNoteSendAttempt,
  resolveSendableNoteLocation,
  sectionsToImport,
  type ImportedNoteChatMedia,
  type NoteSendOptions,
  type NoteSendTask,
} from '@/features/chat/utils/note-batch-send';
import { createCollection, type UserCollection } from '@/services/api/collections';
import {
  buildCollectionInputFromMessage,
  buildNoteCollectSource,
  resolveCollectionSendPlan,
} from '@/features/chat/utils/message-collection';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import { usePendingChatCardStore } from '@/features/chat/store/use-pending-chat-card-store';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { useChatLocationPickerStore } from '@/features/chat/store/use-chat-location-picker-store';
import { canForwardMessage } from '@/features/chat/screens/ForwardPickerScreen';
import { useCallStore } from '@/features/call/store/use-call-store';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { AVATAR_SIZE } from '@/features/chat/components/bubbles/shared';
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { createDirectCall, createGroupCall } from '@/services/api/calls';
import { resolveDirectCalleeID } from '@/features/call/resolve-direct-callee';
import { resolveChatDetailIdentity } from '@/features/chat/chat-detail-identity';
import type { CallType } from '@/features/call/types';
import { getApiErrorMessage } from '@/services/api/errors';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import {
  assertLocalCanSendMessage,
  getCreditPolicyMessage,
  getLocalLowCreditDecision,
} from '@/services/api/credit-policy';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, PlazaPostCardData } from '@/types';
import {
  AT_ALL_USER_ID,
  buildQuotePreviewText,
  filterMentionCandidates,
  getActiveMentionQuery,
  getMentionsPresentInText,
  type MentionTarget,
} from '@/features/chat/utils/chat-send-payloads';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';
import {
  isChatImageTooLarge,
  isChatVideoTooLarge,
  isChatVideoTooLong,
} from '@/features/chat/utils/chat-media-policy';
import { uploadChatImageThumbnail } from '@/features/chat/utils/image-thumbnail';
import { assertMyTempChatConversationOpen } from '@/services/api/temp-chat';

// Dev-only structured log for a failed send. Never logs the message body —
// only the error and conversation kind — to avoid leaking content into logs.
function logChatSendFailure(
  error: unknown,
  context: { sessionType: ConversationKind; isGroupChat: boolean },
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
  labelKey: string;
  label: string;
}[] = [
  { id: 'media', icon: 'images-outline', labelKey: 'chat.attachments.mediaHub', label: '自媒体' },
  { id: 'voice-call', icon: 'call-outline', labelKey: 'chat.attachments.voiceCall', label: '语/视频通话' },
  { id: 'location', icon: 'location-outline', labelKey: 'chat.attachments.location', label: '位置' },
  { id: 'notes', icon: 'create-outline', labelKey: 'chat.attachments.notes', label: '笔记' },
  { id: 'friend-card', icon: 'person-outline', labelKey: 'chat.attachments.friendCard', label: '好友名片' },
  { id: 'favorites', icon: 'star-outline', labelKey: 'chat.attachments.favorites', label: '我的收藏' },
  { id: 'transfer', icon: 'card-outline', labelKey: 'chat.attachments.transfer', label: '转账' },
  { id: 'quick-reply', icon: 'rocket-outline', labelKey: 'chat.attachments.quickReply', label: '快捷语' },
];

// 工具面板每页最多 8 个（4 列 × 2 行），超出的横向翻页
const ATTACHMENT_PAGE_SIZE = 8;
const MENTION_CANDIDATE_LIMIT = 200;
// scrollToIndex 定位失败后最多重试几次（每次间隔 250ms）。够覆盖「再渲染一两批就能
// 测到目标行」的正常情况，又不至于在测不到时无限跳动。
const MAX_SCROLL_TO_INDEX_RETRIES = 4;
// inverted 列表中 contentOffset.y=0 就是最新消息。用户仍在这个范围内时，
// 收到新消息可以自然跟随；超出后视为正在翻历史，不抢走阅读位置。
const LATEST_MESSAGE_SCROLL_THRESHOLD = 80;
const VIDEO_UPLOAD_TIMEOUT_MS = 5 * 60_000;
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

/** 会话形态判别(旧 OpenIM SessionType 枚举的最小替代)。 */
type ConversationKind = 'single' | 'group';

const s = StyleSheet.create({
  // 群聊接收气泡上方的发送者名字（缩进对齐气泡起点 = 头像宽 + 间距）。
  // marginBottom 给名字与气泡之间留一点呼吸空间，避免名字贴着气泡显得拥挤。
  senderLabel: {
    ...Typography.small,
    marginLeft: AVATAR_SIZE + Spacing.sm,
    marginBottom: Spacing.xs + 2,
  },
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
  targetMessageHighlight: {
    borderRadius: Radius.lg,
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

/** 引用跳转最多往回翻几页(一页 50 条);翻不到就放弃,不能无界翻。 */
const QUOTE_PAGING_MAX = 10;

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    conversationType?: 'private' | 'group';
    conversationKind?: 'direct' | 'group' | 'temp' | 'support';
    avatarUrl?: string;
    searchedMsgID?: string;
  }>();
  const navigation = useNavigation();
  // 聊天页在哪个 tab 栈打开（messages/discover/...），决定返回兜底与子页面跳转的 scope。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const currentUserID = useChatStore((state) => state.currentUserId);
  const setActiveConversationId = useChatStore(
    (state) => state.setActiveConversationId,
  );
  const authUser = useAuthStore((state) => state.user);
  const flatListRef = useRef<FlatListType<ChatMessage>>(null);
  const isNearLatestMessageRef = useRef(true);
  const latestMessageIdentityRef = useRef<{
    conversationID: string;
    messageID: string;
  } | null>(null);
  const latestMessageScrollTaskRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const scrolledToSearchRef = useRef(false);
  // 为定位搜索目标而翻页时的在途标记:effect 会随 messages 变化重跑,
  // 不挡住的话每一页返回都会再打一次请求。
  const searchPagingRef = useRef(false);
  // scrollToIndex 失败重试的次数与在飞的定时器。没有上限时，一次失败的定位会
  // 每 250ms 重试同一个 index，而每次重试又可能再次触发 onScrollToIndexFailed —— 在
  // 变高气泡 + 虚拟化回收下能连续跳动好几秒，看起来就像进聊天页就卡住。
  const scrollRetryCountRef = useRef(0);
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 供延时重试读取的「当前列表长度」。定时器闭包捕获的是排定那一刻的 messages，
  // 用它判断边界会漏掉这 250ms 内发生的删除 / 清空。
  const messagesLengthRef = useRef(0);
  // Pattern D 双层防抖：disabled={sending} 在 fast double-tap 下可能晚一帧才生效；
  // inFlightRef 在 hook 入口处再判断一次，保证同一时刻只有一条消息在飞。文本 / 图片 /
  // 位置 / 笔记 / 名片 / 转账 6 条发送路径共享同一道闸。
  const inFlightRef = useRef(false);
  // 批量发笔记的串行队列:第二批在上一批发完之前不开跑,避免两次突发叠进
  // 服务端同一个 20 条/10s 的用户级 send 桶(消息触限会被直接拒收)。
  const noteBatchQueueRef = useRef<Promise<void>>(Promise.resolve());
  // 真实滚动窗口跨批保留；批量最多用 17/20 个槽位，余下 3 个留给手动发送。
  const noteSendTimestampsRef = useRef<number[]>([]);
  const [draft, setDraft] = useState('');
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionTarget[]>([]);
  const mentionCandidatesCacheRef = useRef(new Map<string, MentionTarget[]>());
  const mentionCandidatesInflightRef = useRef(
    new Map<string, Promise<MentionTarget[]>>(),
  );
  const [mentionTargets, setMentionTargets] = useState<MentionTarget[]>([]);
  // 群成员权威昵称表：senderID(UUID 形式) → 群内昵称。用于接收气泡上方的发送者名字，
  // 覆盖「消息自带 senderNickname 为空 → 只能显示原始 hex id/群名」的情况（访客、早期账号常见）。
  const [groupMemberNames, setGroupMemberNames] = useState<
    Record<string, string>
  >({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [mediaSourceSheetVisible, setMediaSourceSheetVisible] = useState(false);
  const [photoEditorAsset, setPhotoEditorAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
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
  const consumePendingChatCard = usePendingChatCardStore((s) => s.consumeFor);
  const consumePickedLocation = useChatLocationPickerStore(
    (state) => state.consumePickedLocation,
  );
  const clearPickedLocation = useChatLocationPickerStore(
    (state) => state.clearPickedLocation,
  );
  // 待发送的圈子帖子卡片（报名→聊天自动挂上，贴在输入框上方，可撤掉）。
  const [pendingCard, setPendingCard] = useState<PlazaPostCardData | null>(null);
  const setActiveCall = useCallStore((state) => state.setActiveCall);
  const voiceRecorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
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
  // 视频可能接近 100MB。上传成功但 socket ack 失败时，重发只应复用已上传的 key，
  // 不能再传一遍并制造孤儿对象；成功发送或卸载后释放这份内存索引。
  const uploadedVideoKeysRef = useRef(new Map<string, string>());
  // 录音状态的纯 JS 快照：卸载 cleanup 里不能调 recorder 的 native getStatus()，
  // 此时 expo-audio 可能已释放其 native shared object（会抛 NativeSharedObjectNotFoundException）。
  const isRecordingRef = useRef(false);
  const recordingAudioModeEnabledRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = voiceRecordingStartedAt != null;
  }, [voiceRecordingStartedAt]);
  useEffect(() => {
    const uploadedVideoKeys = uploadedVideoKeysRef.current;
    return () => {
      mountedRef.current = false;
      uploadedVideoKeys.clear();
      latestMessageScrollTaskRef.current?.cancel();
      latestMessageScrollTaskRef.current = null;
      if (scrollRetryTimerRef.current) {
        clearTimeout(scrollRetryTimerRef.current);
        scrollRetryTimerRef.current = null;
      }
    };
  }, []);
  const restoreRecordingAudioMode = useCallback(() => {
    if (recordingAudioModeEnabledRef.current) {
      recordingAudioModeEnabledRef.current = false;
      recordingAudioModeSessionRef.current = 0;
      setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }, []);

  // 迁移窗口的旧 OpenIM 推送(si_/sg_ 会话 id)会被路由原样带进来,直接拿去
  // 订阅只会得到一个空会话 —— 归一规则连同理由都在 resolveChatDetailIdentity。
  const { conversationID: paramConversationID, sourceID } = useMemo(
    () =>
      resolveChatDetailIdentity({
        conversationID: params.conversationID,
        sourceID: params.sourceID,
        currentUserID,
      }),
    [params.conversationID, params.sourceID, currentUserID],
  );
  // 有些入口（联系人/群聊列表/报名管理等）只传了 sourceID 没传 conversationID，
  // 这里就地解析会话，避免聊天页停在预览占位。IM 未接通时解析失败 → 保持预览。
  const [resolvedConversationID, setResolvedConversationID] =
    useState(paramConversationID);
  const conversationID = paramConversationID || resolvedConversationID;
  const storedConversationType = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationID)?.type,
  );
  const isTempChat =
    params.conversationKind === 'temp' || storedConversationType === 'TEMP';
  // 独立群聊(微信群):GROUP 会话但不挂圈子。circleId 从会话缓存读 ——
  // 从消息列表进来时缓存必有;推送冷启动短暂未知时按圈子群处理,
  // 缓存到位后本判定即时翻转。
  const storedCircleId = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationID)
      ?.circleId,
  );
  const isStandaloneGroup =
    storedConversationType === 'GROUP' && storedCircleId === null;
  const selfDestructEnabled = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    return (
      state.viewerSelfDestructDays > 0 ||
      (conversation?.burnDurationSec ?? 0) > 0
    );
  });
  const selfDestructCacheKey = useChatStore(
    (state) => `${state.currentUserId ?? ''}:${state.selfDestructPolicyEpoch}`,
  );
  // 只订阅当前会话的消息切片，而非整个 messagesByConversation map。
  // 其他会话来消息时 ingestMessages 会新建顶层对象，但本会话的数组引用不变，
  // zustand 的 Object.is 相等判断因此不会触发本页重渲染——这是聊天页最大的流畅提升。
  const conversationMessages = useChatStore(
    (state) => state.messagesByConversation[conversationID],
  );
  // 对端已读水位(单聊「已读」标记):服务端 chat:read 广播驱动。
  const peerReadHeight = useChatStore((state) =>
    params.conversationType !== 'group' && sourceID
      ? (state.readWatermarks[conversationID]?.[sourceID] ?? 0)
      : 0,
  );
  // 对端送达水位(单聊「已送达」标记,G-07):chat:delivered 广播驱动。
  const peerDeliveredHeight = useChatStore((state) =>
    params.conversationType !== 'group' && sourceID
      ? (state.deliveredWatermarks[conversationID]?.[sourceID] ?? 0)
      : 0,
  );
  const paramTitle =
    typeof params.title === 'string'
      ? params.title
      : t('chat.detail.title', { defaultValue: '聊天详情' });
  const conversationType =
    params.conversationType === 'group' ? 'group' : 'single';
  const isGroupChat = conversationType === 'group';

  const {
    canViewMembers: canViewCircleMembers,
    revalidate: revalidateCircleMemberAccess,
  } = useGroupMemberViewAccess({
      // 独立群聊的 sourceID 是会话 id 而非圈子 id,绝不能拿去请求 /circle/:id。
      enabled: isGroupChat && !isTempChat && !isStandaloneGroup,
      groupID: sourceID,
      currentUserID,
    });
  // TEMP 不是圈子，不得拿 tmp... groupId 请求 /circle/:uuid。临时房成员目录本身
  // 由 /chat/conversations/:id/members 的座位校验保护，房内成员可直接使用。
  // 独立群聊同理:目录全员可见,座位校验在服务端。
  const canViewGroupMemberProfiles =
    isTempChat || isStandaloneGroup || canViewCircleMembers;
  const revalidateMemberViewAccess = useCallback(
    () =>
      isTempChat || isStandaloneGroup
        ? Promise.resolve(true)
        : revalidateCircleMemberAccess(),
    [isTempChat, isStandaloneGroup, revalidateCircleMemberAccess],
  );

  // review R2：失去目录权限的瞬间清空已选 @ 目标与候选缓存——否则降权后
  // handleSend 仍会把滞留的 mention（含 @所有人）当作有效目标发出去。
  useEffect(() => {
    if (!isGroupChat || canViewGroupMemberProfiles) return;
    setMentionTargets([]);
    setMentionCandidates([]);
    setMentionQuery(null);
    setMentionPickerVisible(false);
    mentionCandidatesCacheRef.current.clear();
  }, [canViewGroupMemberProfiles, isGroupChat]);
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
  const allMentionTarget = useMemo<MentionTarget>(
    () => ({ userID: AT_ALL_USER_ID, nickname: '所有人', isAll: true }),
    [],
  );

  // 入口只给了 sourceID 时，就地把会话解析出来（单聊按对端 userID、群聊按圈子 id）。
  // 独立群聊的 sourceID 就是会话 id,没有「按圈子 get-or-create」一说 —— 它的
  // 入口(消息列表/推送)都带 conversationID,走不到这里。
  useEffect(() => {
    if (paramConversationID || !sourceID || isTempChat || isStandaloneGroup)
      return;
    let cancelled = false;
    (async () => {
      try {
        const conv = isGroupChat
          ? await ensureCircleConversation(sourceID)
          : await ensureDirectConversation(sourceID);
        if (!cancelled) setResolvedConversationID(conv.conversationID);
      } catch (error) {
        // 未连通等：保持预览模式，不阻断页面。
        if (__DEV__) {
          console.warn('[ChatDetailScreen] resolve conversation failed', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramConversationID, sourceID, isGroupChat, isTempChat, isStandaloneGroup]);

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
        ...(isTempChat ? { conversationKind: 'temp' } : {}),
        originScope: scope,
      }),
    );
  }, [scope, conversationID, sourceID, conversationTitle, isTempChat]);

  const handleOpenMessageSender = useCallback(
    async (msg: ChatMessage) => {
      if (isGroupChat) {
        // 群聊：跳该消息发送者本人的资料（senderID 已还原成 UUID 形式）。
        if (!msg.senderID) return;
        // review P1：点击瞬间 fail-closed 重查角色，不信挂载期的旧快照。
        if (
          msg.senderID !== currentUserID &&
          !(await revalidateMemberViewAccess())
        ) {
          Alert.alert(t('chat.groupMembersRestricted'));
          return;
        }
        router.push(getUserProfileHref(scope, msg.senderID, msg.senderName));
        return;
      }
      // 单聊：对方即会话 sourceID。
      router.push(getUserProfileHref(scope, sourceID, conversationTitle));
    },
    [conversationTitle, currentUserID, sourceID, isGroupChat, revalidateMemberViewAccess, scope, t],
  );

  const handleOpenUserCard = useCallback(
    async (userID: string, nickname?: string) => {
      if (isGroupChat && userID !== currentUserID) {
        const allowed = await revalidateMemberViewAccess();
        if (!allowed) {
          // review P2：名片可能是分享进群的外部用户——确认不是本群成员才放行。
          // review R2：身份查不清（查询失败）时 fail-closed 拦截，否则断网就
          // 成了绕过成员目录限制的口子；只有明确查到"不在群里"才按分享意图放行。
          let blockTarget = true;
          try {
            const members = await fetchChatMembers(conversationID);
            blockTarget = members.some((member) => member.userId === userID);
          } catch {
            blockTarget = true;
          }
          if (blockTarget) {
            Alert.alert(t('chat.groupMembersRestricted'));
            return;
          }
        }
      }
      router.push(getUserProfileHref(scope, userID, nickname));
    },
    [conversationID, currentUserID, isGroupChat, revalidateMemberViewAccess, scope, t],
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
      conversationType === 'single' && sourceID ? sourceID : null,
    [conversationType, sourceID],
  );
  // 输入状态开关(设置页早就有这两项,这里真正接上:关掉就不向对方上报)。
  const typingSingle = useAppSettingsStore((state) => state.settings.singleTyping);
  const typingGroup = useAppSettingsStore((state) => state.settings.groupTyping);
  // 对端「正在输入」有效期;到期自动回落在线状态。
  const typingUntil = useChatStore(
    (state) => state.typingUntilByConversation[conversationID] ?? 0,
  );
  const [typingVisible, setTypingVisible] = useState(false);
  useEffect(() => {
    const remaining = typingUntil - Date.now();
    if (remaining <= 0) {
      setTypingVisible(false);
      return;
    }
    setTypingVisible(true);
    const timer = setTimeout(() => setTypingVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [typingUntil]);

  // 只订阅对方这一个用户的在线状态切片(chat-core presence),
  // 其他用户上下线不触发本页重渲染。
  const peerOnlineStatus = useChatStore((state) =>
    peerImId != null ? state.onlineByUser[peerImId] : undefined,
  );
  const peerOnline = peerOnlineStatus === true;
  const statusColor =
    conversationType !== 'single' || authUser?.accountId === sourceID
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
    targetMessageHighlight: { backgroundColor: colors.primaryLight },
  }), [backgroundStyle.backgroundColor, colors, statusColor]);
  // 录音状态完全由 JS 侧的 voiceRecordingStartedAt 决定：录音是纯按住/松手驱动的
  // （没有配 maxDuration，不存在原生自动停止），所以不需要轮询 native 来发现状态变化。
  const isVoiceRecording = voiceRecordingStartedAt != null;
  const voiceElapsedSeconds = useElapsedSeconds(voiceRecordingStartedAt);

  /**
   * 活跃会话标记按「焦点」而不是「挂载」来管。
   *
   * 推开聊天信息 / 聊天记录 / 选择器等页面时 React Navigation 会把本屏留在
   * 栈里继续挂载着,靠 useEffect cleanup 的话标记不会撤 —— 于是用户人在别的
   * 页面,新到的消息仍被算作「正在看」:不计未读、还顺手把已读水位推上去。
   * 消息实际上没被看到,红点却已经消了。
   */
  useFocusEffect(
    useCallback(() => {
      if (!conversationID || !sourceID) return;
      setActiveConversationId(conversationID);
      return () => {
        setActiveConversationId(null);
      };
    }, [conversationID, setActiveConversationId, sourceID]),
  );

  useEffect(() => {
    if (!conversationID || !sourceID) {
      return;
    }

    loadConversationMessages(conversationID)
      .then(() => {
        // 历史落库后按最新水位上报已读(拉取前上报会拿到 0 水位白跑一趟)。
        markConversationAsRead(conversationID);
      })
      .catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] load conversation messages failed', err);
        }
      });

    return () => {
      // 离开会话丢掉翻页游标:下次进入重新从最新一页开始。
      resetHistoryCursor(conversationID);
    };
  }, [conversationID, sourceID]);

  // inverted 列表触底 = 时间上更早:继续向前翻页。没有它的话超过一页的
  // 会话根本滚不到更早的消息,搜索也跳不到首页之外的目标。
  const handleLoadOlder = useCallback(() => {
    if (!conversationID) return;
    void loadOlderConversationMessages(conversationID).catch((err) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat] load older messages failed', err);
      }
    });
  }, [conversationID]);

  useEffect(() => {
    if (!conversationID && !sourceID) return;
    void markMatchingTargetNotificationsRead({
      conversationID,
      sourceID,
      messageID: searchedMsgID,
    });
  }, [conversationID, searchedMsgID, sourceID]);

  // 进页查询一次初始在线状态;后续变化由服务端上下线广播直接驱动 store。
  useEffect(() => {
    if (!peerImId) return;
    queryChatPresence([peerImId]);
  }, [peerImId]);

  // FlatList 用 inverted 渲染：index 0 = 最新消息，自然停在底部。
  // 因此把按 height 升序的 messages 反转一次，新到旧排列。
  // 按 DTO 引用缓存映射结果：未变化的消息保持同一 ChatMessage 引用，
  // FlatList 的 CellRenderer 因此跳过未变行的重渲染（无需给气泡加 memo）。
  // 乐观消息确认/失败时对象被替换 → 缓存未命中 → 只有那一行重渲染。
  const messageMapCacheRef = useRef<ReturnType<
    typeof createChatMessageMapCache
  > | null>(null);

  const messages = useMemo(() => {
    const box =
      messageMapCacheRef.current ?? createChatMessageMapCache(currentUserID);
    messageMapCacheRef.current = box;
    const mapped = mapChatMessageDtosToUI(
      conversationMessages ?? [],
      currentUserID,
      peerReadHeight,
      box,
      peerDeliveredHeight,
    );
    return mapped;
  }, [currentUserID, conversationMessages, peerReadHeight, peerDeliveredHeight]);
  messagesLengthRef.current = messages.length;

  // 在此会话页时来新消息 → 即时推进已读水位(socket pending 队列自带去重合并)。
  // 必须带 isFocused:本屏被压在聊天信息/记录页下面时仍然挂载着、store 订阅
  // 照常触发,不挡的话「人没在看」的消息会被直接标成已读。
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused || !conversationID || !conversationMessages?.length) return;
    markConversationAsRead(conversationID);
  }, [conversationID, conversationMessages, isFocused]);

  // 异步分页回来时闭包里的 messages 已经过期,滚动要按最新那份算 index。
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleMessageListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      isNearLatestMessageRef.current =
        event.nativeEvent.contentOffset.y <= LATEST_MESSAGE_SCROLL_THRESHOLD;
    },
    [],
  );

  // FlatList 不会保证插入 index 0 后仍回到 offset 0，尤其是从笔记选择页返回时，
  // 新卡片常在导航 pop 动画中到达。自己发送的消息始终带回最新位置；收到消息
  // 只在用户原本就在底部附近时跟随，避免翻看历史时被强制拉回。
  useEffect(() => {
    const latestMessage = messages[0];
    if (!latestMessage || !conversationID || !isFocused) return;

    const previous = latestMessageIdentityRef.current;
    latestMessageIdentityRef.current = {
      conversationID,
      messageID: latestMessage.id,
    };
    if (
      !previous ||
      previous.conversationID !== conversationID ||
      previous.messageID === latestMessage.id
    ) {
      return;
    }
    if (!latestMessage.outgoing && !isNearLatestMessageRef.current) return;

    latestMessageScrollTaskRef.current?.cancel();
    latestMessageScrollTaskRef.current = InteractionManager.runAfterInteractions(() => {
      latestMessageScrollTaskRef.current = null;
      if (!mountedRef.current) return;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      isNearLatestMessageRef.current = true;
    });
  }, [conversationID, isFocused, messages]);

  // 搜索定位：在 inverted 列表里 scrollToIndex 仍然按 index 计数，找到就跳。
  useEffect(() => {
    if (messages.length === 0 || !searchedMsgID || scrolledToSearchRef.current) {
      return;
    }

    const idx = messages.findIndex((m) => m.id === searchedMsgID);
    if (idx !== -1) {
      scrolledToSearchRef.current = true;
      // 每次新的定位都是一轮全新的重试预算，否则上一次搜索用尽后，后续定位会
      // 一次重试都不做。
      scrollRetryCountRef.current = 0;
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.3,
      });
      setHighlightedMessageID(searchedMsgID);
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          setHighlightedMessageID(null);
        }
      }, 2200);
      return () => clearTimeout(timer);
    }

    // 目标不在当前窗口里:从全局搜索或一条陈旧通知跳进来时,目标往往比最新一页
    // 更早。原来只在已加载的 messages 里找,找不到就什么都不做 —— 用户落在最新
    // 一条上,除非自己手动往回翻够远。这里继续向前翻页,直到找到或到头。
    if (!conversationID || searchPagingRef.current) return;
    if (!hasMoreHistory(conversationID)) return;
    searchPagingRef.current = true;
    void loadOlderConversationMessages(conversationID)
      .catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] paging to searched message failed', err);
        }
      })
      .finally(() => {
        searchPagingRef.current = false;
      });
  }, [messages, searchedMsgID, conversationID]);

  const selfAvatarUri = authUser?.avatarUrl ?? undefined;
  const selfName = authUser?.nickname ?? authUser?.accountId;

  const handleCollectMessage = useCallback(
    async (message: ChatMessage) => {
      if (!conversationID) return;

      // 笔记卡片：不进「收藏」列表，直接快照复制进「我的笔记」，
      // 并带上来源名片（群/用户）+ 消息定位信息，详情页可一键跳回聊天。
      if (message.type === 'note-card') {
        const source = buildNoteCollectSource(message, {
          conversationID,
          conversationTitle,
          sourceID,
          conversationType: isGroupChat ? 'group' : 'private',
          conversationAvatarUrl: avatarUrl,
          currentUser: {
            id: currentUserID ?? undefined,
            name: selfName,
            faceURL: selfAvatarUri,
          },
        });
        if (!source || !message.noteCard) return;

        try {
          const result = await collectNote(message.noteCard.noteId, source);
          // 复制出来的是「我的」那条笔记（id 与原笔记不同），「查看」跳它。
          const copiedNoteId = result.note?.id;
          Alert.alert(
            result.alreadyCollected
              ? t('chat.messageActions.noteAlreadyCollected', {
                  defaultValue: '已在我的笔记中',
                })
              : t('chat.messageActions.noteCollected', {
                  defaultValue: '已添加到我的笔记',
                }),
            t('chat.messageActions.noteCollectedHint', {
              defaultValue: '可在「我的笔记」中查看',
            }),
            copiedNoteId
              ? [
                  {
                    text: t('common.view', { defaultValue: '查看' }),
                    // 跳「我的笔记」列表并定位到刚添加的这条（不是直接开详情）：
                    // 用户要看的是它在自己列表里的位置。
                    onPress: () =>
                      router.push({
                        pathname: '/(tabs)/profile/notes',
                        params: { highlightNoteId: copiedNoteId },
                      } as never),
                  },
                  { text: t('common.confirm', { defaultValue: '确认' }) },
                ]
              : undefined,
          );
        } catch (error) {
          if (__DEV__) {
            console.warn('[ChatDetail] collect note failed', error);
          }
          Alert.alert(
            t('chat.messageActions.collectFailed'),
            getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
          );
        }
        return;
      }

      // 语音要把源 DTO 的 object key 一起收下来:UI 层的 voiceUrl 是服务端
      // 现签的临时地址,过期即失效,推不回 key —— 不存 key 的话这条收藏
      // 以后永远重发不出去(旧收藏正是卡在这里)。
      //
      // 但只收**自己发的**:key 是发送方的对象路径(chat/{senderId}/…),
      // 后端发送校验按 chat/{当前用户}/ 收口。把对端的 key 也存下来的话,
      // 收藏页会把它显示成「可重发」,而每一次重发都必然被后端拒掉 ——
      // 一个点了就报错的按钮比一个不出现的按钮更糟。收到的语音要做成可重发,
      // 得先把音频复制/重传到自己名下,那是另一件事。
      const sourceMessage =
        message.type === 'voice'
          ? useChatStore
              .getState()
              .messagesByConversation[conversationID]?.find(
                (item) => item.id === message.id,
              )
          : undefined;
      const sourceKey = sourceMessage?.content?.['key'];
      const voiceKey =
        sourceMessage?.sender?.id === currentUserID &&
        typeof sourceKey === 'string'
          ? sourceKey
          : undefined;

      const input = buildCollectionInputFromMessage(message, {
        conversationID,
        conversationTitle,
        sourceID,
        conversationType: isGroupChat ? 'group' : 'private',
        voiceKey,
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
    [
      avatarUrl,
      conversationID,
      conversationTitle,
      currentUserID,
      isGroupChat,
      selfAvatarUri,
      selfName,
      sourceID,
      t,
    ],
  );

  const [actionMenu, setActionMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<ChatMessage | null>(null);
  // G-07 编辑态:非空时发送按钮改走 chat:edit,输入框上方出现编辑横条。
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [highlightedMessageID, setHighlightedMessageID] = useState<string | null>(
    null,
  );

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
      // 带上源消息 DTO:content 里有媒体 object key / 卡片 payload,
      // 选择器可原样重发;找不到(极端竞态)则退化为文本转发。
      const dto = useChatStore
        .getState()
        .messagesByConversation[conversationID]?.find(
          (item) => item.id === message.id,
        );
      setPendingForward({ message, dto });
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
              // 本端视图删除(服务端保留;跨端删除随后续批次)。
              // store 会同时落一条本地墓碑 —— 只摘数组的话重进会话再拉一次
              // 历史就把它接回来了,「删除」等于刷新一次就撤销。
              useChatStore.getState().removeMessage(conversationID, message.id);
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

  const handleMessageLongPress = useCallback(
    (message: ChatMessage, event: GestureResponderEvent) => {
      if (message.type === 'date') return;
      const { pageX, pageY } = event.nativeEvent;
      setActionMenu({ message, x: pageX, y: pageY });
    },
    [],
  );

  // Build the floating menu's items for the currently long-pressed message.
  // G-02 撤回:自己已送达的消息,2 分钟窗口内可撤(圈主/管理员由服务端另行放行,
  // 菜单端先只做本人入口,权限判定始终以服务端 ack 为准)。
  const canRevokeMessage = useCallback(
    (message: ChatMessage) => {
      if (!message.outgoing || message.sendStatus !== 2) return false;
      const dto = useChatStore
        .getState()
        .messagesByConversation[conversationID]?.find(
          (m) => m.id === message.id,
        );
      if (!dto || dto.height <= 0 || dto.revokedAt) return false;
      return Date.now() - Date.parse(dto.createdAt) <= 2 * 60_000;
    },
    [conversationID],
  );

  const handleRevokeMessage = useCallback(
    (message: ChatMessage) => {
      void revokeChatMessage(conversationID, message.id)
        .then(() => {
          // 本端乐观翻灰条;广播回来会再走一次 applyRevoke,幂等。
          const state = useChatStore.getState();
          state.applyRevoke(
            conversationID,
            message.id,
            state.currentUserId ?? '',
          );
        })
        .catch((error: unknown) => {
          // 撤回失败抛的是 ChatSendError(ack 通道),不是 ApiError ——
          // getApiErrorMessage 对它只会原样返回 error.message,也就是服务端
          // 的中文文案或者裸的 CHAT_REVOKE_WINDOW_EXPIRED 字符串。
          Alert.alert(
            t('chat.messageActions.revokeFailed', { defaultValue: '撤回失败' }),
            getChatSendErrorMessage(
              error,
              t('chat.messageActions.revokeFailed', {
                defaultValue: '撤回失败',
              }),
            ),
          );
        });
    },
    [conversationID, t],
  );

  // G-07 表情回应:mine 则 remove,否则 add;失败静默(下一次点按可重试)。
  const handleToggleReaction = useCallback(
    (message: ChatMessage, emoji: string) => {
      const mine = message.reactions?.some(
        (r) => r.emoji === emoji && r.mine,
      );
      void sendChatReaction(
        conversationID,
        message.id,
        emoji,
        mine ? 'remove' : 'add',
      ).catch(() => undefined);
    },
    [conversationID],
  );

  // 六个表情 + 取消 = 7 个按钮,而 Android 的 Alert 最多渲染 3 个 ——
  // 安卓用户看不到后面几个表情,也就永远选不到。改用应用内选项面板。
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const reactionOptions = useMemo(
    () => CHAT_REACTION_EMOJIS.map((emoji) => ({ value: emoji, label: emoji })),
    [],
  );

  const handleOpenReactionPicker = useCallback((message: ChatMessage) => {
    setReactionTarget(message);
  }, []);

  const handlePickReaction = useCallback(
    (emoji: string) => {
      const target = reactionTarget;
      setReactionTarget(null);
      if (target) handleToggleReaction(target, emoji);
    },
    [handleToggleReaction, reactionTarget],
  );

  // G-07 编辑入口:自己已送达的 text/quote,2 分钟内。
  const canEditMessage = useCallback(
    (message: ChatMessage) => {
      if (!message.outgoing || message.sendStatus !== 2) return false;
      const dto = useChatStore
        .getState()
        .messagesByConversation[conversationID]?.find(
          (m) => m.id === message.id,
        );
      if (!dto || dto.height <= 0 || dto.revokedAt) return false;
      if (dto.type !== 'text' && dto.type !== 'quote') return false;
      return Date.now() - Date.parse(dto.createdAt) <= 2 * 60_000;
    },
    [conversationID],
  );

  const handleStartEditMessage = useCallback(
    (message: ChatMessage) => {
      const dto = useChatStore
        .getState()
        .messagesByConversation[conversationID]?.find(
          (m) => m.id === message.id,
        );
      const text =
        typeof dto?.content['text'] === 'string'
          ? (dto.content['text'] as string)
          : '';
      setEditingMessageId(message.id);
      setQuoteTarget(null);
      setDraft(text);
    },
    [conversationID],
  );

  // G-07 逐条已读(群聊自己的消息):读者列表来自已读水位,无回执表。
  const handleShowReaders = useCallback(
    (message: ChatMessage) => {
      const requestedFor = conversationID;
      void fetchMessageReaders(conversationID, message.id)
        .then((result) => {
          // 响应回来时可能已经退出这个会话、甚至换了账号 —— 那时候弹一个装着
          // 上一个会话成员名字的全局 Alert,是弹在一个毫不相干的页面上。
          if (!mountedRef.current) return;
          if (useChatStore.getState().activeConversationId !== requestedFor) {
            return;
          }
          const names = result.readers
            .map((reader) => reader.nickname)
            .filter(Boolean);
          // total 可能大于这一页(服务端上限 200)。只渲染 readers 的话,
          // 3000 人的群里会显示成「正好这 200 个人读了」,看不出还有更多。
          const hidden = Math.max(0, (result.total ?? names.length) - names.length);
          const body =
            names.length > 0
              ? hidden > 0
                ? t('chat.messageActions.readersMore', {
                    names: names.join('、'),
                    count: hidden,
                    defaultValue: '{{names}} 等 {{count}} 人以上',
                  })
                : names.join('、')
              : t('chat.messageActions.readersNone', {
                  defaultValue: '还没有人读到这条消息',
                });
          Alert.alert(
            t('chat.messageActions.readers', { defaultValue: '已读成员' }),
            body,
          );
        })
        .catch(() => undefined);
    },
    [conversationID, t],
  );

  const messageActions = useMemo<MessageAction[]>(() => {
    const message = actionMenu?.message;
    if (!message) return [];
    const actions: MessageAction[] = [];
    if (message.sendStatus === 3 && message.deliveryId) {
      actions.push({
        key: 'resend',
        icon: 'refresh-outline',
        label: t('chat.messageActions.resend', { defaultValue: '重发' }),
        onPress: () => {
          void retryFailedChatMessage(
            conversationID,
            message.deliveryId as string,
          ).catch((error: unknown) => {
            setSendError(
              getChatSendErrorMessage(
                error,
                t('chat.detail.sendFailedText', { defaultValue: '发送失败' }),
              ),
            );
          });
        },
      });
    }
    // 回应只给能渲染回应条的气泡开放。图片/语音/位置/各类卡片走的是自己的组件,
    // 里面没有回应行 —— 点了之后服务端确实记下了,时间线上却什么都看不到,
    // 连自己刚点的那个都消失。
    if (
      (message.sendStatus === undefined || message.sendStatus === 2) &&
      (message.type === 'sent' || message.type === 'received')
    ) {
      actions.push({
        key: 'react',
        icon: 'happy-outline',
        label: t('chat.messageActions.react', { defaultValue: '回应' }),
        onPress: () => handleOpenReactionPicker(message),
      });
    }
    if (canEditMessage(message)) {
      actions.push({
        key: 'edit',
        icon: 'create-outline',
        label: t('chat.messageActions.edit', { defaultValue: '编辑' }),
        onPress: () => handleStartEditMessage(message),
      });
    }
    if (isGroupChat && message.outgoing && message.sendStatus === 2) {
      actions.push({
        key: 'readers',
        icon: 'checkmark-done-outline',
        label: t('chat.messageActions.readers', { defaultValue: '已读成员' }),
        onPress: () => handleShowReaders(message),
      });
    }
    if (canRevokeMessage(message)) {
      actions.push({
        key: 'revoke',
        icon: 'arrow-undo-outline',
        label: t('chat.messageActions.revoke', { defaultValue: '撤回' }),
        onPress: () => handleRevokeMessage(message),
      });
    }
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
    // 只在真能转发时给入口:通话记录走到转发页只会抛「不支持」,
    // 而 catch 提示的是「请重试」—— 一个永远不会成功的重试。
    if (canForwardMessage(message)) {
      actions.push({
        key: 'forward',
        icon: 'arrow-redo-outline',
        label: t('chat.messageActions.forward'),
        onPress: () => handleForwardMessage(message),
      });
    }
    // 笔记卡片走的是 collectNote（快照复制进「我的笔记」），不是进收藏列表 ——
    // 标签跟着实际行为叫「添加」，别让同一个「收藏」在两种消息上意思不同。
    actions.push(
      message.type === 'note-card'
        ? {
            key: 'collect',
            icon: 'add-circle-outline',
            label: t('chat.messageActions.addToNotes', {
              defaultValue: '添加',
            }),
            onPress: () => void handleCollectMessage(message),
          }
        : {
            key: 'collect',
            icon: 'star-outline',
            label: t('chat.messageActions.collect'),
            onPress: () => void handleCollectMessage(message),
          },
    );
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
    return actions;
  }, [
    actionMenu,
    canEditMessage,
    canRevokeMessage,
    conversationID,
    handleOpenReactionPicker,
    handleShowReaders,
    handleStartEditMessage,
    isGroupChat,
    handleCollectMessage,
    handleCopyMessage,
    handleDeleteMessage,
    handleForwardMessage,
    handleQuoteMessage,
    handleReportMessage,
    handleRevokeMessage,
    t,
  ]);

  const getMessageLongPressHandler = useCallback(
    (message: ChatMessage) => (event: GestureResponderEvent) => {
      handleMessageLongPress(message, event);
    },
    [handleMessageLongPress],
  );

  // 群聊接收消息的显示名：本地备注覆盖 > 群成员权威昵称 > 消息自带昵称 > 会话标题。
  // 群成员昵称排在消息自带 senderNickname 之前——后者可能为空而回落成原始 hex id，
  // 成员表里的昵称才是能稳定显示的「对方名字」。
  const allRemarkOverrides = useFriendRemarkStore((state) => state.remarks);
  const receivedDisplayName = useCallback(
    (msg: ChatMessage) => {
      const override = msg.senderID
        ? allRemarkOverrides[msg.senderID]
        : undefined;
      const memberName = msg.senderID
        ? groupMemberNames[msg.senderID]
        : undefined;
      return (
        override?.remark || memberName || msg.senderName || conversationTitle
      );
    },
    [allRemarkOverrides, groupMemberNames, conversationTitle],
  );

  // 群聊头像用发送者本人的（新消息自带最新头像）；单聊沿用会话头像参数。
  const receivedAvatarUri = useCallback(
    (msg: ChatMessage) =>
      isGroupChat ? msg.senderAvatarUrl : (avatarUrl ?? msg.senderAvatarUrl),
    [isGroupChat, avatarUrl],
  );

  // 群聊在接收气泡上方显示发送者名字（微信样式）。senderID 仅接收消息携带。
  const withGroupSenderLabel = useCallback(
    (message: ChatMessage, node: ReactElement): ReactElement => {
      if (!isGroupChat || !message.senderID) {
        return node;
      }
      return (
        <View>
          <MemberName
            name={receivedDisplayName(message)}
            userId={message.senderID}
            style={[s.senderLabel, { color: colors.textSecondary }]}
          />
          {node}
        </View>
      );
    },
    [isGroupChat, receivedDisplayName, colors.textSecondary],
  );

  const withMessageActions = useCallback(
    (message: ChatMessage, node: ReactElement) => (
      <Pressable
        style={
          message.id === highlightedMessageID
            ? [s.targetMessageHighlight, d.targetMessageHighlight]
            : undefined
        }
        onLongPress={getMessageLongPressHandler(message)}
        delayLongPress={350}
      >
        {withGroupSenderLabel(message, node)}
      </Pressable>
    ),
    [
      d.targetMessageHighlight,
      getMessageLongPressHandler,
      highlightedMessageID,
      withGroupSenderLabel,
    ],
  );

  const startCallWithType = useCallback(async (callType: CallType) => {
    if (callStartingRef.current) return;

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
      // 1:1（circle_be#113）：正常入口 sourceID 即对方 UUID。推送路由的
      // 兜底是 sourceID || conversationID —— 可能拿到 'direct:a:b' 会话 id，
      // 直接当 calleeID 必失败。统一走 resolveDirectCalleeID：从会话 id 里
      // 剔除自己解出对端，解不出来给可控提示。
      if (!isGroupChat) {
        const calleeID = resolveDirectCalleeID(sourceID, authUser.id);
        if (!calleeID) {
          Alert.alert(t('chat.call.title'), t('chat.call.initiateFailed'));
          return;
        }
        const response = await createDirectCall({
          calleeID,
          callType,
        });
        // round 3 review：呼叫已在服务端创建、对端在响铃 —— 即使本页已
        // unmount（用户先行离开）也要落全局通话态并进通话页（store/router
        // 都是全局对象，unmount 后调用安全），与主页拨打路径一致。
        setActiveCall(response.call, response.livekit);
        router.push('/(chat)/group-call' as never);
        return;
      }

      // review P1：发起群呼要拉全量成员表，执行前 fail-closed 重查角色。
      if (!(await revalidateMemberViewAccess())) {
        Alert.alert(t('chat.call.title'), t('chat.groupMembersRestricted'));
        return;
      }

      const members = await fetchChatMembers(conversationID);
      const inviteeIDs = Array.from(
        new Set(
          members
            .map((member) => member.userId)
            .filter((userID) => userID && userID !== authUser.id),
        ),
      );

      if (inviteeIDs.length === 0) {
        Alert.alert(t('chat.call.title'), t('chat.call.noOtherMembers'));
        return;
      }

      const response = await createGroupCall({
        conversationID,
        callType,
        inviteeIDs,
      });
      // 同上：成功创建的群呼即使页面已 unmount 也要进入通话 UI
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
        console.warn('[chat] start call failed', error);
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
    revalidateMemberViewAccess,
    setActiveCall,
    sourceID,
    t,
  ]);

  // #119：通话入口先选类型（语音 / 视频），再走原发起流程。
  // review P2：选择器打开期间快速连点会叠开多个原生对话框，滞留的选项在首次
  // 呼叫完成后还能再发一次非幂等 POST —— 弹出前置 ref 门，选择/取消时解除。
  const callChooserOpenRef = useRef(false);
  const handleStartCall = useCallback(() => {
    if (callStartingRef.current || callChooserOpenRef.current) return;
    callChooserOpenRef.current = true;
    const choose = (callType: CallType) => {
      callChooserOpenRef.current = false;
      void startCallWithType(callType);
    };
    const dismiss = () => {
      callChooserOpenRef.current = false;
    };
    Alert.alert(
      t('call.chooseType', { defaultValue: '发起通话' }),
      undefined,
      [
        {
          text: t('call.typeVoice', { defaultValue: '语音通话' }),
          onPress: () => choose('AUDIO'),
        },
        {
          text: t('call.typeVideo', { defaultValue: '视频通话' }),
          onPress: () => choose('VIDEO'),
        },
        {
          text: t('common.cancel', { defaultValue: '取消' }),
          style: 'cancel',
          onPress: dismiss,
        },
      ],
      { cancelable: true, onDismiss: dismiss },
    );
  }, [startCallWithType, t]);

  // 真引用点击定位:原消息还在内存窗口就滚过去;不在窗口(更早的历史)先不跳,
  // 批 1 本地库落地后升级成「按 height 拉一页再滚」。
  /**
   * 引用块跳转:目标不在内存窗口里时,按 quoteHeight 往回翻到它出现为止。
   * 有界(QUOTE_PAGING_MAX 页),到头或翻满就放弃 —— 宁可不动,也不能一直翻。
   */
  const quotePagingRef = useRef(false);

  const loadUntilQuoteVisible = useCallback(
    async (item: ChatMessage) => {
      if (!conversationID || quotePagingRef.current) return;
      const targetId = item.quoteMessageId;
      if (!targetId) return;
      quotePagingRef.current = true;
      try {
        for (let page = 0; page < QUOTE_PAGING_MAX; page += 1) {
          if (!mountedRef.current) return;
          if (!hasMoreHistory(conversationID)) return;
          await loadOlderConversationMessages(conversationID);
          if (!mountedRef.current) return;
          const timeline =
            useChatStore.getState().messagesByConversation[conversationID] ?? [];
          if (timeline.some((m) => m.id === targetId)) {
            // 命中之后交给 searchedMsgID 那条既有的滚动路径:它已经处理好了
            // 「列表还没重新布局完」的重试与高亮。
            setHighlightedMessageID(targetId);
            const index = messagesRef.current.findIndex(
              (m) => m.id === targetId,
            );
            if (index >= 0) {
              flatListRef.current?.scrollToIndex({
                index,
                viewPosition: 0.5,
                animated: true,
              });
            }
            return;
          }
        }
      } catch (err) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat] paging to quoted message failed', err);
        }
      } finally {
        quotePagingRef.current = false;
      }
    },
    [conversationID],
  );

  const handleQuotePress = useCallback(
    (item: ChatMessage) => {
      if (!item.quoteMessageId) return;
      const index = messages.findIndex((m) => m.id === item.quoteMessageId);
      if (index >= 0) {
        flatListRef.current?.scrollToIndex({
          index,
          viewPosition: 0.5,
          animated: true,
        });
        return;
      }
      // 原消息比当前内存窗口更早。原来直接 return —— 引用块照样是可点的,
      // 点下去却什么都不发生,而会话稍微长一点这就是常态。按 quoteHeight
      // 往回翻,翻到目标进窗口为止(有界),然后再滚过去。
      void loadUntilQuoteVisible(item);
    },
    [loadUntilQuoteVisible, messages],
  );

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'system-notice': return <SystemNoticePill text={item.text ?? ''} />;
      case 'received':
        return withMessageActions(item, (
          <ReceivedBubble
            message={item}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            onAvatarPress={() => handleOpenMessageSender(item)}
            onQuotePress={
              item.quoteMessageId && !item.quoteRevoked
                ? () => handleQuotePress(item)
                : undefined
            }
            onReactionPress={(emoji) => handleToggleReaction(item, emoji)}
          />
        ));
      case 'sent':
        return withMessageActions(item, (
          <SentBubble
            message={item}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            hideStatus={isGroupChat}
            onQuotePress={
              item.quoteMessageId && !item.quoteRevoked
                ? () => handleQuotePress(item)
                : undefined
            }
            onReactionPress={(emoji) => handleToggleReaction(item, emoji)}
          />
        ));
      case 'location':
        return withMessageActions(item, (
          <LocationCard
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
          />
        ));
      case 'image':
        return withMessageActions(item, (
          <ImageBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
            selfDestructEnabled={selfDestructEnabled}
            selfDestructCacheKey={selfDestructCacheKey}
          />
        ));
      case 'video':
        return withMessageActions(item, (
          <VideoBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'voice':
        return withMessageActions(item, (
          <VoiceBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'note-card':
        return withMessageActions(item, (
          <NoteCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
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
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) => handleOpenUserCard(card.userID, card.nickname)}
            hideStatus={isGroupChat}
          />
        ));
      case 'circle-card':
        return withMessageActions(item, (
          <CircleCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) =>
              // 在当前栈内打开圈子详情（从哪进从哪出），不跨 tab 压栈。
              router.push(
                getCircleDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.circleId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'qr-card':
        return withMessageActions(item, (
          <QrCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            // 点卡片 = 扫这张码:走扫码同一条落地页,由 /qr 按令牌自己判类型与有效性。
            onPress={(card) =>
              router.push({ pathname: '/qr', params: { t: card.token } })
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'plaza-post-card':
        return withMessageActions(item, (
          <PlazaPostCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) =>
              router.push(
                getPlazaPostDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.postId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'verification-card':
        return withGroupSenderLabel(item,
          <VerificationCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(card) =>
              router.push(
                getVerificationDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.invitationId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        );
      case 'transfer-card':
        return withMessageActions(item, (
          <TransferCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'call-record':
        return (
          <CallRecordBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            // 1:1 里点通话记录 = 回拨；群聊回拨走标题栏通话入口，避免误触发全群振铃。
            onCallBack={isGroupChat ? undefined : handleStartCall}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        );
      default: return null;
    }
  }, [
    receivedAvatarUri,
    receivedDisplayName,
    withGroupSenderLabel,
    handleOpenMessageSender,
    handleOpenUserCard,
    handleQuotePress,
    handleToggleReaction,
    isGroupChat,
    selfDestructCacheKey,
    selfDestructEnabled,
    selfAvatarUri,
    selfName,
    scope,
    getMessageLongPressHandler,
    withMessageActions,
    handleStartCall,
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
      if (isGroupChat && canViewGroupMemberProfiles) {
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
    [canViewGroupMemberProfiles, draft, isGroupChat],
  );

  const loadMentionCandidates = useCallback(async () => {
    if (!isGroupChat || !sourceID || !canViewGroupMemberProfiles) return;
    const cached = mentionCandidatesCacheRef.current.get(sourceID);
    if (cached) {
      setMentionCandidates([allMentionTarget, ...cached]);
      return;
    }

    let request = mentionCandidatesInflightRef.current.get(sourceID);
    if (!request) {
      request = fetchChatMembers(conversationID)
        .then((members) =>
          members
            .filter((member) => member.userId !== currentUserID)
            .slice(0, MENTION_CANDIDATE_LIMIT)
            .map((member) => ({
              userID: member.userId,
              nickname: member.nickname || member.userId,
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
      setMentionCandidates([allMentionTarget, ...candidates]);
    } catch (error) {
      if (__DEV__) {
        console.warn('[chat] load mention candidates failed', error);
      }
      if (mountedRef.current) setMentionCandidates([]);
    }
  }, [allMentionTarget, canViewGroupMemberProfiles, conversationID, currentUserID, isGroupChat, sourceID]);

  // 群聊打开时拉一次成员表，建 senderID→昵称映射给发送者名字标签兜底。
  // 单聊不需要（气泡不显示发送者名字）。
  useEffect(() => {
    if (!isGroupChat || !sourceID || !canViewGroupMemberProfiles) {
      setGroupMemberNames({});
      return;
    }
    let cancelled = false;
    fetchChatMembers(conversationID)
      .then((members) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const member of members) {
          const nickname = member.nickname?.trim();
          if (nickname) map[member.userId] = nickname;
        }
        setGroupMemberNames(map);
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn('[chat] load group member names failed', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewGroupMemberProfiles, conversationID, isGroupChat, sourceID]);

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      // 「正在输入」上报:按设置开关门禁,只在有内容时发(清空不算输入);
      // 节流(2s)在 socket-manager 里做。
      if (next.length > 0 && (isGroupChat ? typingGroup : typingSingle)) {
        sendChatTyping(conversationID);
      }
      setMentionTargets((current) => getMentionsPresentInText(next, current));
      if (!isGroupChat || !canViewGroupMemberProfiles) {
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
    [
      canViewGroupMemberProfiles,
      conversationID,
      draft,
      isGroupChat,
      loadMentionCandidates,
      typingGroup,
      typingSingle,
    ],
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
      // 乐观发送在 chat-core 内完成:创建即上屏(height=0 发送中态),
      // ack 后同 d 替换,失败自动标失败态 —— 屏幕只负责错误展示。
      try {
        await sendTextMessage({ conversationId: conversationID, text });
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
      }
    },
    [
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
  /**
   * 录音文件的「上传 + 发送」。首发和长按重发共用 —— 重发必须带上同一个
   * deliveryId,否则会在时间线里多出一条,而不是把那个红气泡换掉。
   */
  const uploadAndSendVoice = useCallback(
    async (soundPath: string, duration: number, deliveryId: string) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        // 自研栈:录音文件先经 presign 上传,消息体只带 object key(读时签 URL)。
        const voiceFilename = soundPath.split('/').pop() || 'voice.m4a';
        const voiceContentType =
          resolveUploadContentType({ fileName: voiceFilename }) ?? 'audio/mp4';
        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(voiceFilename),
          contentType: voiceContentType,
          folder: 'chat',
          fileUri: soundPath,
        });
        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          voiceContentType,
          soundPath,
          presign.requiredHeaders,
        );
        await sendVoiceMessage({
          conversationId: conversationID,
          key: presign.key,
          duration,
          localUri: soundPath,
          deliveryId,
        });
        finishMediaSend(deliveryId);
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[chat] voice send failed',
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          );
        }
        // 气泡标红留在原地(长按可重发),而不是让那段录音凭空消失。
        failMediaSend(conversationID, deliveryId);
        if (mountedRef.current) {
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
    },
    [conversationID, isTempChat, t],
  );

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

        // 先上屏(sendStatus=1)、再后台上传:上传最长 60s,期间既不能让屏幕上
        // 什么都没有,也不能把输入栏锁死 —— 那就是「录完就消失、再按没反应」。
        const deliveryId = startMediaSend({
          conversationId: conversationID,
          type: 'voice',
          localContent: { duration, localUri: soundPath },
          retry: (id) => uploadAndSendVoice(soundPath, duration, id),
        });
        void uploadAndSendVoice(soundPath, duration, deliveryId);
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
      conversationID,
      restoreRecordingAudioMode,
      t,
      uploadAndSendVoice,
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

  const handleSendPickedLocation = useCallback(async (
    picked: {
      title: string;
      address: string;
      latitude: number;
      longitude: number;
    },
  ) => {
    if (!sourceID || !conversationID || isPreviewMode) return;
    // 位置已经从 store 里消费掉了：这里直接 return 等于把用户选的点悄悄丢掉，
    // 既不发也不报错。等当前这一发结束再补上；真等不到就明确报错。
    if (inFlightRef.current) {
      const slotFree = await waitForSendSlot({
        isBusy: () => inFlightRef.current,
        isMounted: () => mountedRef.current,
      });
      if (!slotFree) {
        if (mountedRef.current) {
          setSendError(
            t('chat.detail.locationSendFailed', {
              defaultValue: '位置发送失败，请重试',
            }),
          );
        }
        return;
      }
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await sendLocationMessage({
        conversationId: conversationID,
        longitude: picked.longitude,
        latitude: picked.latitude,
        title: picked.title,
        address: picked.address,
      });
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
  }, [conversationID, isPreviewMode, sourceID, t]);

  const handleOpenLocationPicker = useCallback(async () => {
    if (!sourceID || !conversationID || isPreviewMode) return;
    // 在申请精确定位权限前先走本地发送门禁；注定不能发时不读取隐私数据。
    const creditDenied = getLocalLowCreditDecision();
    if (creditDenied) {
      setSendError(getCreditPolicyMessage(creditDenied));
      return;
    }
    // 选点页自己支持搜索和手动拖动，定位权限只是用来把地图中心预置到「我的
    // 位置」。拒权就直接开图（用页面自带的默认中心），不能因此把分享公共地点
    // 这件事整个堵死。
    const openPickerAt = (params?: Record<string, string>) => {
      clearPickedLocation();
      router.push({
        pathname: '/(chat)/location-picker',
        // conversationID 一路带过去：确认的结果只有回到这个会话才会被消费。
        params: { ...params, conversationID },
      } as never);
    };
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      openPickerAt();
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const coordinateText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      let title = t('chat.locationPicker.currentLocation', {
        defaultValue: '我的位置',
      });
      let address = coordinateText;
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = places[0];
        if (place) {
          title = place.name || place.street || title;
          const parts = [
            place.city ?? place.region,
            place.district ?? place.subregion,
            place.street,
            place.name,
          ].filter((part): part is string => Boolean(part));
          if (parts.length) address = parts.join(' ');
        }
      } catch {
        // 地址解析失败不阻塞选点，地图仍以真实坐标为中心。
      }
      openPickerAt({
        latitude: String(latitude),
        longitude: String(longitude),
        title,
        address,
      });
    } catch {
      // 取当前位置失败同样只影响初始中心：照常开图，让用户自己搜或拖。
      openPickerAt();
    }
  }, [clearPickedLocation, conversationID, isPreviewMode, sourceID, t]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationID) return;
      const picked = consumePickedLocation(conversationID);
      if (!picked) return;
      void handleSendPickedLocation(picked);
    }, [consumePickedLocation, conversationID, handleSendPickedLocation]),
  );

  /**
   * 图片的「上传 + 发送」。首发与长按重发共用 —— 重发必须带同一个 deliveryId,
   * 否则时间线里会多出一条,而不是把那个红气泡换掉。
   */
  const uploadAndSendImage = useCallback(
    async (
      asset: ImagePicker.ImagePickerAsset,
      filename: string,
      contentType: string,
      deliveryId: string,
    ) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        // 不日志 presign 返回的 fileUrl / uploadUrl —— 这是带签名的临时写凭证，
        // 任何能捕获 console 输出的渠道（adb logcat、屏幕录制、第三方 SDK 的
        // breadcrumb）拿到 uploadUrl 就能在过期前向同一对象写入任意内容。
        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(filename),
          contentType,
          folder: 'chat',
          fileUri: asset.uri,
        });
        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          contentType,
          asset.uri,
          presign.requiredHeaders,
        );

        // 生成并上传一张缩略图供列表气泡显示；失败 / 原图已够小时退化为原图（thumb* 留空）。
        const thumbnail = await uploadChatImageThumbnail(
          asset.uri,
          asset.width ?? undefined,
          filename,
        );

        await sendImageMessage({
          conversationId: conversationID,
          key: presign.key,
          localUri: asset.uri,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          thumbKey: thumbnail?.key,
          deliveryId,
        });
        finishMediaSend(deliveryId);
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[chat] image send failed',
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          );
        }
        // 气泡标红留在原地(长按可重发),而不是让这张图凭空消失。
        failMediaSend(conversationID, deliveryId);
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
      }
    },
    [conversationID, isTempChat, t],
  );
  // 相册选择与拍照共用同一套「上传→发送」流程，只有获取 asset 的来源不同。
  const uploadAndSendImageAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      // 体积 gate 与下面的 assertLocalCanSendMessage 同理：在 presign+上传之前拦掉。
      // 否则一张几十 MB 的原图会整份传完、用户干等之后才发现发不出去。上限与头像 /
      // 圈子封面 / 好友照片一致（10MB），此前只有聊天发图这条路径漏了 gate。
      if (isChatImageTooLarge(asset.fileSize)) {
        Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
        return false;
      }

      // 用 || 而非 ??：URI 以 '/' 结尾时 pop() 返回空字符串，?? 不会触发 fallback。
      const filename = asset.uri.split('/').pop() || 'image.jpg';
      const contentType =
        resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName: filename,
        }) ?? 'image/jpeg';

      // 提前拦一次：文本等廉价路径靠 reportSend 统一 gate 即可，但图片要先
      // presign+上传（有成本，且会发一个带签名的临时写凭证给可能被拦的用户）。
      // 在动手上传前就挡掉，避免无谓开销与凭证外泄面。发送本身仍会在 reportSend
      // 再兜一层，两处同源（assertLocalCanSendMessage），不会产生口径分叉。
      try {
        assertLocalCanSendMessage();
      } catch (error) {
        if (mountedRef.current) {
          const message = getChatSendErrorMessage(
            error,
            t('chat.detail.imageSendFailed', {
              defaultValue: '图片发送失败，请重试',
            }),
          );
          setSendError(message);
          // 照片编辑器是全屏 Modal，输入栏上的 sendError 此时不可见；同步弹出
          // 可操作的错误提示，同时保留编辑器，用户可以继续调整或取消。
          Alert.alert(
            t('common.errorOccurred', { defaultValue: '操作失败' }),
            message,
          );
        }
        return false;
      }

      // 先上屏、后台上传:和语音同一套 —— 上传期间气泡是「发送中」,
      // 输入栏不锁,失败标红可长按重发。
      const deliveryId = startMediaSend({
        conversationId: conversationID,
        type: 'image',
        localContent: {
          localUri: asset.uri,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
        },
        retry: (id) => uploadAndSendImage(asset, filename, contentType, id),
      });
      void uploadAndSendImage(asset, filename, contentType, deliveryId);
      return true;
    },
    [conversationID, t, uploadAndSendImage],
  );

  const uploadAndSendVideo = useCallback(
    async (
      asset: ImagePicker.ImagePickerAsset,
      filename: string,
      contentType: string,
      deliveryId: string,
    ) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        let key = uploadedVideoKeysRef.current.get(deliveryId);
        if (!key) {
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(filename),
            contentType,
            folder: 'chat',
            fileUri: asset.uri,
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            asset.uri,
            presign.requiredHeaders,
            VIDEO_UPLOAD_TIMEOUT_MS,
          );
          key = presign.key;
          uploadedVideoKeysRef.current.set(deliveryId, key);
        }
        await sendVideoMessage({
          conversationId: conversationID,
          key,
          localUri: asset.uri,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          duration:
            typeof asset.duration === 'number'
              ? Math.max(1, Math.ceil(asset.duration / 1000))
              : undefined,
          size: asset.fileSize ?? undefined,
          deliveryId,
        });
        uploadedVideoKeysRef.current.delete(deliveryId);
        finishMediaSend(deliveryId);
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[chat] video send failed',
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          );
        }
        failMediaSend(conversationID, deliveryId);
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.videoSendFailed', {
                defaultValue: '视频发送失败，请重试',
              }),
            ),
          );
        }
      }
    },
    [conversationID, isTempChat, t],
  );

  const uploadAndSendVideoAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (isChatVideoTooLarge(asset.fileSize)) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoTooLarge', { defaultValue: '请选择 100MB 以内的视频' }),
        );
        return;
      }
      if (isChatVideoTooLong(asset.duration)) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoTooLong', { defaultValue: '请选择 10 分钟以内的视频' }),
        );
        return;
      }

      const filename = asset.fileName || asset.uri.split('/').pop() || 'video.mp4';
      const contentType = resolveUploadContentType({
        mimeType: asset.mimeType,
        fileName: filename,
      });
      if (!contentType?.startsWith('video/')) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoUnsupported', {
            defaultValue: '仅支持 MP4、MOV、M4V 视频',
          }),
        );
        return;
      }

      try {
        assertLocalCanSendMessage();
      } catch (error) {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.videoSendFailed', {
                defaultValue: '视频发送失败，请重试',
              }),
            ),
          );
        }
        return;
      }

      const deliveryId = startMediaSend({
        conversationId: conversationID,
        type: 'video',
        localContent: {
          localUri: asset.uri,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
          ...(typeof asset.duration === 'number'
            ? { duration: Math.max(1, Math.ceil(asset.duration / 1000)) }
            : {}),
          ...(asset.fileSize ? { size: asset.fileSize } : {}),
        },
        retry: (id) => uploadAndSendVideo(asset, filename, contentType, id),
      });
      void uploadAndSendVideo(asset, filename, contentType, deliveryId);
    },
    [conversationID, t, uploadAndSendVideo],
  );

  const handlePickLibraryMedia = useCallback(
    async (kind: 'photo' | 'video') => {
      if (!sourceID || isPreviewMode) return;
      if (inFlightRef.current) return;
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.photoLibrary'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'photo' ? ['images'] : ['videos'],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const pickedAsset = result.assets[0];
      if (kind === 'photo') {
        setPhotoEditorAsset(pickedAsset);
        return;
      }
      await uploadAndSendVideoAsset(pickedAsset);
    },
    [isPreviewMode, sourceID, t, uploadAndSendVideoAsset],
  );

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
    setPhotoEditorAsset(result.assets[0]);
  }, [isPreviewMode, sourceID, t]);

  const handleSendEditedPhoto = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const accepted = await uploadAndSendImageAsset(asset);
      if (accepted && mountedRef.current) {
        setPhotoEditorAsset(null);
      }
      return accepted;
    },
    [uploadAndSendImageAsset],
  );

  const handleMediaSourceSelect = useCallback(
    (action: MediaSourceAction) => {
      setMediaSourceSheetVisible(false);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        if (action === 'photo') {
          void handlePickLibraryMedia('photo');
        } else if (action === 'video') {
          void handlePickLibraryMedia('video');
        } else {
          void handleTakePhoto();
        }
      });
    },
    [handlePickLibraryMedia, handleTakePhoto],
  );

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
      LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
      setAttachmentOpen(false);
      switch (id) {
        case 'media':
          setMediaSourceSheetVisible(true);
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
          void handleOpenLocationPicker();
          return;
        case 'voice-call':
          void handleStartCall();
          return;
        case 'transfer':
          if (conversationType !== 'single') {
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
      handleOpenLocationPicker,
      handleStartCall,
      openSharePicker,
      sourceID,
      t,
    ],
  );

  /**
   * 批量发笔记(SharePicker 多选 + 发送选项 sheet 的执行端)。
   *
   * 每条笔记按 卡片 → 图片·视频/展示 → 地址 的顺序展开;媒体必须先经
   * POST /note/:id/chat-media 由服务端拷进自己的 chat/ 命名空间(发送校验
   * 只认发送者自己的 key)。地址只在笔记详情里,摘要拿不到坐标时按需拉详情。
   *
   * 不整批持有 inFlightRef:大批次能发几分钟,不该锁死输入栏;重复消费由
   * share-picker store 的 consume() 一次性语义兜底,批与批之间由
   * noteBatchQueueRef 串行(两次突发不能叠进同一个服务端限流桶)。
   * 离开会话(卸载)即停发剩余任务 —— 发错聊天时用户退出就是止损。
   * 单条失败不中断整批,发完汇总一次错误提示;首个错误保留语义映射
   * (敏感词/被拉黑等确定性拒绝要说清原因,不能伪装成可重试的网络问题)。
   */
  const runNoteBatchSend = useCallback(
    async (notes: NoteSummary[], options: NoteSendOptions) => {
      const sections = sectionsToImport(options);
      let failures = 0;
      let firstError: unknown = null;

      const perNote: NoteSendTask[][] = [];
      for (const note of notes) {
        if (!mountedRef.current) return;
        let imported: ImportedNoteChatMedia[] = [];
        // mediaCount=0 的笔记没有任何可拷对象,别浪费服务端 20 次/分钟的拷贝配额。
        if (sections.length > 0 && note.mediaCount > 0) {
          try {
            const importedResult = await importNoteChatMedia(note.id, sections);
            failures += importedResult.failedCount;
            imported = importedResult.items;
          } catch (error) {
            failures += 1;
            firstError ??= error;
            if (__DEV__) {
              console.warn('[ChatDetail] import note media failed', error);
            }
          }
        }
        let location = note.sections?.location ?? null;
        if (
          options.location &&
          !resolveSendableNoteLocation(location) &&
          // 摘要只带 hasLocation 布尔;明确没有地址的笔记不值得为它拉详情。
          note.hasLocation !== false
        ) {
          try {
            location = (await fetchNoteDetail(note.id)).sections?.location ?? null;
          } catch (error) {
            // 拉不到详情=这条的地址发不出去。必须计入失败,否则「只勾了地址,
            // 网络一抖」会变成什么都没发还零提示的静默丢失。
            failures += 1;
            firstError ??= error;
            location = null;
            if (__DEV__) {
              console.warn('[ChatDetail] fetch note location failed', error);
            }
          }
        }
        perNote.push(buildNoteSendTasks(note, options, imported, location));
      }

      const tasks = perNote.flat();
      for (let i = 0; i < tasks.length; i += 1) {
        if (!mountedRef.current) return;
        while (mountedRef.current) {
          const now = Date.now();
          const delay = noteSendWindowDelayMs(noteSendTimestampsRef.current, now);
          if (delay <= 0) {
            noteSendTimestampsRef.current = recordNoteSendAttempt(
              noteSendTimestampsRef.current,
              now,
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (!mountedRef.current) return;
        const task = tasks[i];
        try {
          switch (task.kind) {
            case 'note-card':
              await sendCardMessage({
                conversationId: conversationID,
                type: 'note-card',
                payload: {
                  ...buildNoteCardPayloadFromSummary(
                    task.note,
                    authUser?.id ?? null,
                  ),
                  ownerId: authUser?.id ?? null,
                },
              });
              break;
            case 'image':
              await sendImageMessage({
                conversationId: conversationID,
                key: task.key,
                width: task.width,
                height: task.height,
              });
              break;
            case 'video':
              await sendVideoMessage({
                conversationId: conversationID,
                key: task.key,
                width: task.width,
                height: task.height,
                duration: task.duration,
                size: task.size,
              });
              break;
            case 'location':
              await sendLocationMessage({
                conversationId: conversationID,
                latitude: task.latitude,
                longitude: task.longitude,
                title: task.title,
                address: task.address,
              });
              break;
          }
        } catch (error) {
          failures += 1;
          firstError ??= error;
          reportChatSendFailure(task.kind, error);
          if (__DEV__) {
            console.warn('[ChatDetail] note batch send failed', error);
          }
        }
      }

      if (failures > 0 && mountedRef.current) {
        const countMessage = t('chat.detail.noteBatchPartialFailed', {
          defaultValue: '{{count}} 条内容发送失败',
          count: failures,
        });
        // 首个错误若映射得出确切原因(敏感词/被拉黑/限流),优先展示它 ——
        // 这些是重试一万次也不会成功的确定性拒绝,笼统计数只会诱导人狂点重试。
        setSendError(
          firstError
            ? getChatSendErrorMessage(firstError, countMessage)
            : countMessage,
        );
      }
    },
    [authUser?.id, conversationID, t],
  );

  const handlePickNoteBatch = useCallback(
    (notes: NoteSummary[], options: NoteSendOptions) => {
      if (!sourceID || isPreviewMode || notes.length === 0) {
        return Promise.resolve();
      }
      const previous = noteBatchQueueRef.current;
      const run = previous
        .catch(() => undefined)
        .then(() => runNoteBatchSend(notes, options));
      // 队列尾永不 reject,后续批次才接得上。
      noteBatchQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [isPreviewMode, runNoteBatchSend, sourceID],
  );

  const handlePickFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!conversationID) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await sendCardMessage({
          conversationId: conversationID,
          type: 'friend-card',
          payload: {
            userID: friend.id,
            nickname: friend.nickname,
            faceURL: friend.avatarUrl ?? '',
          },
        });
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
    [conversationID, t],
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

      // 旧语音收藏(只存了会过期的播放地址、推不回 object key)是永久不可发的。
      // 这里必须在进入发送流程之前就拦下:抛异常的话会被下面的 catch 统一
      // 渲染成「发送失败,请重试」—— 而重试多少次都不可能成功。
      // 选择器那侧同样按 canResendCollection 把这类行禁用掉,双保险。
      if (plan.kind === 'unsupported') {
        if (mountedRef.current) {
          setSendError(
            t('chat.detail.favoriteLegacyVoiceUnsupported', {
              defaultValue: '这条旧版语音收藏无法重新发送',
            }),
          );
        }
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        switch (plan.kind) {
          case 'voice':
            // 收藏时存下的 object key 直接重发,不重新上传音频。
            await sendVoiceMessage({
              conversationId: conversationID,
              key: plan.key,
              duration: plan.duration,
              ...(plan.dataSize ? { size: plan.dataSize } : {}),
            });
            break;
          case 'note':
            await sendCardMessage({
              conversationId: conversationID,
              type: 'note-card',
              payload: plan.noteCard,
            });
            break;
          case 'friend':
            await sendCardMessage({
              conversationId: conversationID,
              type: 'friend-card',
              payload: {
                userID: plan.friendCard.userID,
                nickname: plan.friendCard.nickname,
                faceURL: plan.friendCard.faceURL,
                persona: plan.friendCard.persona,
                displayIcons: plan.friendCard.displayIcons,
              },
            });
            break;
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
    [conversationID, isPreviewMode, sendDraftAsText, sourceID, t],
  );

  const handlePickQuickReply = useCallback(
    async (phrase: string) => {
      await sendDraftAsText(phrase);
    },
    [sendDraftAsText],
  );

  // 转账卡片不在这里发。它断言的是「钱已经划走」这个服务端事实,客户端能发
  // 就等于能凭空捏造它 —— 后端已把该类型收进 SERVER_MESSAGE_TYPES,
  // 由 CoinService.sendGift 在结算提交后就地签发,走 chat:msg 广播下来。
  //
  // 这里曾经有一个对应的发送 handler,而它 100% 被 validateSendPayload 拒。
  // #156 已经把症状压住(SERVER_COMPENSATED_TYPES:不入 outbox、失败不留气泡),
  // 这次是拆掉病根 —— 发送本身没了,连带那条永远走不到的回执挂账。

  // 从 SharePickerScreen 返回时消费 pending 项并触发对应发送动作。
  useFocusEffect(
    useCallback(() => {
      // 报名→聊天：把预挂的帖子卡片显示为待发送引用，并预填开场白（不覆盖非空草稿）。
      const cardPending = sourceID ? consumePendingChatCard(sourceID) : null;
      if (cardPending) {
        setPendingCard(cardPending.card);
        setDraft((prev) => prev || cardPending.draftText);
      }
      const item = consumePendingShare();
      if (!item) return;
      switch (item.kind) {
        case 'note-batch':
          void handlePickNoteBatch(item.notes, item.options);
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
      consumePendingChatCard,
      sourceID,
      handlePickFavorite,
      handlePickFriend,
      handlePickNoteBatch,
      handlePickQuickReply,
    ]),
  );

  const handleSend = useCallback(async () => {
    const nextText = draft.trim();

    // G-07 编辑态:改走 chat:edit,不新建消息。
    if (editingMessageId) {
      if (!nextText || sending) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSending(true);
      try {
        setSendError(null);
        await sendChatEditMessage(conversationID, editingMessageId, nextText);
        useChatStore
          .getState()
          .applyEdit(
            conversationID,
            editingMessageId,
            { text: nextText },
            new Date().toISOString(),
          );
        setEditingMessageId(null);
        setDraft('');
      } catch (error) {
        setSendError(
          getChatSendErrorMessage(
            error,
            t('chat.detail.sendFailedText', { defaultValue: '发送失败' }),
          ),
        );
      } finally {
        inFlightRef.current = false;
        setSending(false);
      }
      return;
    }

    // 有待发送卡片时，即使文字为空也允许发送（只发卡片）。
    if ((!nextText && !pendingCard) || sending || !sourceID || isPreviewMode) {
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);

    try {
      setSendError(null);
      // 1) 先发帖子卡片（报名→聊天带上下文）。成功后清空待发卡片。
      if (pendingCard) {
        await sendCardMessage({
          conversationId: conversationID,
          type: 'plaza-post-card',
          payload: pendingCard as unknown as Record<string, unknown>,
        });
        if (mountedRef.current) setPendingCard(null);
      }
      // 2) 再发文字（非空才发）。引用 > @提及 > 普通文本。
      if (nextText) {
        const activeMentionTargets = getMentionsPresentInText(nextText, mentionTargets);
        if (quoteTarget) {
          await sendQuoteMessage({
            conversationId: conversationID,
            text: nextText,
            quotedText: buildQuotePreviewText(quoteTarget, t),
            replyToId: quoteTarget.id.startsWith('local:')
              ? undefined
              : quoteTarget.id,
          });
        } else if (isGroupChat && activeMentionTargets.length > 0) {
          await sendTextMessage({
            conversationId: conversationID,
            text: nextText,
            mentions: activeMentionTargets
              .filter((m) => !m.isAll)
              .map((m) => ({ userId: m.userID, nickname: m.nickname })),
            atAll: activeMentionTargets.some((m) => m.isAll),
          });
        } else {
          await sendTextMessage({ conversationId: conversationID, text: nextText });
        }
      }
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
    conversationID,
    conversationType,
    draft,
    editingMessageId,
    isGroupChat,
    isPreviewMode,
    mentionTargets,
    quoteTarget,
    sending,
    sourceID,
    pendingCard,
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
          {isGroupChat ? (
            <GroupChatAvatar
              size={36}
              name={conversationTitle}
              uri={avatarUrl}
              temporary={isTempChat}
              badgeBorderColor={colors.background}
            />
          ) : (
            <Avatar size={36} name={conversationTitle} uri={avatarUrl} />
          )}
        </Pressable>
        <View style={s.headerInfo}>
          <View style={s.headerMeta}>
            <Text style={[s.headerName, d.headerName]}>{conversationTitle}</Text>
            <View style={s.onlineRow}>
              <View style={[s.onlineDot, d.onlineDot]} />
              <Text style={[s.headerStatusText, d.headerStatusText]}>
                {authUser?.accountId === sourceID
                  ? t('chat.detail.statusSelf', { defaultValue: '自己' })
                  : // 群聊分支原来直接落「群聊」二字,typingVisible 根本没机会
                    // 参与判断 —— 群成员照常上报 typing,却没有任何人看得见。
                    typingVisible
                    ? conversationType !== 'single'
                      ? t('chat.detail.statusTypingGroup', {
                          defaultValue: '有人正在输入…',
                        })
                      : t('chat.detail.statusTyping', {
                          defaultValue: '对方正在输入…',
                        })
                    : conversationType !== 'single'
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
          // inverted:列表"末端"是最旧的一头,触底即向前翻页。
          onEndReached={handleLoadOlder}
          onEndReachedThreshold={0.4}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={[s.messageList, s.messageListContent, s.messageListInset]}
          showsVerticalScrollIndicator={false}
          // 下拉/滚动消息列表即收起底部面板与键盘（微信式）。on-drag 让键盘跟手滑落。
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScroll={handleMessageListScroll}
          scrollEventThrottle={32}
          onScrollBeginDrag={closeInputPanels}
          // scrollToIndex 在 inverted + 没设 getItemLayout 时，目标 index 超出已渲染窗口
          // 就会抛 "scrollToIndex out of range"。fallback：先滚到能测到的最远 index，
          // 等下一帧布局完再精确跳到目标位置，避免搜索定位时整页崩。
          //
          // 重试必须有上限：每次重试都可能再次失败并再排一次重试，构成自维持的循环。
          // 消息高度可变（无法提供 getItemLayout）、虚拟化又会回收已测量的行，所以
          // "多试几次总能测到" 并不成立。试满 MAX 次就退化为滚到能测到的最远处收手 ——
          // 定位不到最多是位置不准，而卡住数秒是功能故障。
          onScrollToIndexFailed={(info) => {
            const fallbackIndex = Math.max(
              0,
              Math.min(info.highestMeasuredFrameIndex ?? info.index, info.index),
            );
            flatListRef.current?.scrollToIndex({
              index: fallbackIndex,
              animated: false,
            });

            // 目标已经不在当前列表里（消息被 200 条上限截掉、或会话已切换）：
            // 再重试也只会反复失败。
            if (info.index >= messages.length) {
              scrollRetryCountRef.current = 0;
              return;
            }
            if (scrollRetryCountRef.current >= MAX_SCROLL_TO_INDEX_RETRIES) {
              scrollRetryCountRef.current = 0;
              return;
            }

            scrollRetryCountRef.current += 1;
            if (scrollRetryTimerRef.current) {
              clearTimeout(scrollRetryTimerRef.current);
            }
            scrollRetryTimerRef.current = setTimeout(() => {
              scrollRetryTimerRef.current = null;
              if (!mountedRef.current) return;
              // 必须在开火时重新校验边界，而不是只在排定时校验：这 250ms 里列表可能
              // 缩短（删除消息、清空聊天记录、切换会话）。scrollToIndex 对越界是
              // 同步抛 invariant、不会走 onScrollToIndexFailed —— 在 setTimeout 里
              // 抛出去就是 release 包的崩溃。读 ref 而非闭包里的 messages，
              // 闭包捕获的是排定那一刻的旧数组。
              const currentLength = messagesLengthRef.current;
              if (currentLength === 0 || info.index >= currentLength) return;
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
              defaultValue: '连接尚未完成，请稍后重试',
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
      {editingMessageId ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {t('chat.messageActions.editing', { defaultValue: '编辑消息' })}
          </Text>
          <Pressable
            onPress={() => {
              setEditingMessageId(null);
              setDraft('');
            }}
            hitSlop={8}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
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
      {pendingCard ? (
        <View style={[s.quoteComposerBar, d.composerShell]}>
          <Text
            style={[s.quoteComposerText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {t('chat.plazaPostCard.pendingPreview', {
              title: pendingCard.title,
              defaultValue: '[活动] {{title}}',
            })}
          </Text>
          <Pressable onPress={() => setPendingCard(null)} hitSlop={8}>
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
                      defaultValue: '连接尚未完成',
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
          onPress={draft.trim() || pendingCard ? handleSend : handleAttachmentToggle}
          disabled={sending || isPreviewMode || isVoiceRecording}
        >
          <Ionicons
            name={draft.trim() || pendingCard ? 'send' : 'add'}
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

      <MediaSourceSheet
        visible={mediaSourceSheetVisible}
        onSelect={handleMediaSourceSelect}
        onClose={() => setMediaSourceSheetVisible(false)}
      />

      <OptionPickerSheet
        visible={reactionTarget !== null}
        title={t('chat.messageActions.react', { defaultValue: '回应' })}
        options={reactionOptions}
        selectedValue=""
        onSelect={handlePickReaction}
        onClose={() => setReactionTarget(null)}
      />

      <PhotoEditorModal
        asset={photoEditorAsset}
        onCancel={() => setPhotoEditorAsset(null)}
        onSend={handleSendEditedPhoto}
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
