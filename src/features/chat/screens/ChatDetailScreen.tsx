import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  type TextInput,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Radius, Spacing, Typography } from '@/theme';
import { GlassSurface } from '@/components/ui/glass-surface';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { BlurTargetView } from 'expo-blur';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { VoiceRecordingOverlay } from '@/features/chat/components/voice-recording-overlay';
import { PhotoEditorModal } from '@/features/chat/components/photo-editor-modal';
import { MediaSourceSheet } from '@/features/chat/components/media-source-sheet';
import { ClearHistoryDialog } from '@/features/chat/components/ClearHistoryDialog';
import { clearDirectChatHistory, confirmClearChatHistory } from '@/features/chat/utils/clear-chat-history';
import { PinnedMessageBanner } from '@/features/chat/components/PinnedMessageBanner';
import { MediaGalleryPicker } from '@/features/chat/components/media-gallery-picker';
import { MessageActionMenu } from '@/features/chat/components/MessageActionMenu';
import { getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { type PendingMediaUpload } from '@/chat-core/client';
import { ReactionPickerSheet } from '@/features/chat/components/reaction-picker-sheet';
import { useComposerDraftPersistence } from '@/features/chat/hooks/use-composer-draft';
import { useChatStore } from '@/chat-core/store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/types';
import { type MentionTarget } from '@/features/chat/utils/chat-send-payloads';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import type { ChatSheetActions, EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { useVoiceRecording } from '@/features/chat/chat-detail/hooks/use-voice-recording';
import { useMediaSend } from '@/features/chat/chat-detail/hooks/use-media-send';
import { useStickerSend } from '@/features/chat/chat-detail/hooks/use-sticker-send';
import { useLocationSend } from '@/features/chat/chat-detail/hooks/use-location-send';
import { useChatCall } from '@/features/chat/chat-detail/hooks/use-chat-call';
import { useNoteBatchSend } from '@/features/chat/chat-detail/hooks/use-note-batch-send';
import { useAttachmentActions } from '@/features/chat/chat-detail/hooks/use-attachment-actions';
import { useComposerSend } from '@/features/chat/chat-detail/hooks/use-composer-send';
import { useComposerPanels } from '@/features/chat/chat-detail/hooks/use-composer-panels';
import { useComposerInput } from '@/features/chat/chat-detail/hooks/use-composer-input';
import { useQuickTextSend } from '@/features/chat/chat-detail/hooks/use-quick-text-send';
import { useChatDetailThemedStyles } from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { useMessageRenderer } from '@/features/chat/chat-detail/hooks/use-message-renderer';
import { useCollectMessage } from '@/features/chat/chat-detail/hooks/use-collect-message';
import { useMessageActions } from '@/features/chat/chat-detail/hooks/use-message-actions';
import { useChatTimeline } from '@/features/chat/chat-detail/hooks/use-chat-timeline';
import { useNoteCardStatusSync } from '@/features/chat/chat-detail/hooks/use-note-card-status-sync';
import { useChatConversation } from '@/features/chat/chat-detail/hooks/use-chat-conversation';
import { useKeyboardVisible } from '@/features/chat/chat-detail/hooks/use-keyboard-visible';
import { useChatBackground } from '@/features/chat/chat-detail/hooks/use-chat-background';
import { useChatHeader } from '@/features/chat/chat-detail/hooks/use-chat-header';
import { useBurnNotice } from '@/features/chat/chat-detail/hooks/use-burn-notice';
import { GroupNoticeBanner } from '@/features/chat/components/GroupNoticeBanner';
import { ChatDetailHeader } from '@/features/chat/chat-detail/components/ChatDetailHeader';
import { ChatMessageArea } from '@/features/chat/chat-detail/components/ChatMessageArea';
import { ChatConnectionBanner } from '@/features/chat/components/ChatConnectionBanner';
import { MentionPickerPanel } from '@/features/chat/chat-detail/components/MentionPickerPanel';
import { ComposerBanners } from '@/features/chat/chat-detail/components/ComposerBanners';
import { ChatComposerBar } from '@/features/chat/chat-detail/components/ChatComposerBar';
import { MessageSelectionToolbar } from '@/features/chat/chat-detail/components/MessageSelectionToolbar';
import { AttachmentPanel } from '@/features/chat/chat-detail/components/AttachmentPanel';

export type { EmbeddedChatParams } from '@/features/chat/chat-detail/types';
export type { ChatSheetActions } from '@/features/chat/chat-detail/types';

interface ChatDetailScreenProps {
  /**
   * 桌面网页版分栏模式：MessagesScreen 把本屏当组件内嵌进右栏并直接喂参数，
   * 不经过路由。置此项时隐藏返回键（左栏列表本身就是"返回"）；切换会话由
   * 父级用 key={conversationID} 整树重挂，保证各会话内部状态互不串扰。
   */
  embedded?: EmbeddedChatParams;
  /**
   * 半屏快捷聊天(收到消息点横幅弹出):页头换成「关闭 / 展开」,顶部安全区和
   * 键盘避让交给外层的半屏容器(它从屏幕顶端铺开,遮挡量算得准)。
   */
  sheet?: ChatSheetActions;
}

export default function ChatDetailScreen({ embedded, sheet }: ChatDetailScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const messageBlurTarget = useRef<View>(null);
  // 首帧估值（输入行 + 快捷键行），挂载后由 onLayout 量准。
  const [composerDockHeight, setComposerDockHeight] = useState(110 + Math.max(insets.bottom, 12));
  // 悬浮顶栏 + 横幅的高度,首帧估值(状态栏 + 44 的控件 + 上下留白),挂载后由 onLayout 量准。
  const [topDockHeight, setTopDockHeight] = useState(insets.top + 56);
  // 私聊清空确认框（和聊天信息页同一个，可勾「双向清空」）。
  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const routeParams = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    conversationType?: 'private' | 'group';
    conversationKind?: 'direct' | 'group' | 'temp' | 'support';
    assistantKey?: string;
    avatarUrl?: string;
    searchedMsgID?: string;
    initialUnreadCount?: string;
    initialReadHeight?: string;
  }>();
  const params = embedded ?? routeParams;
  // 聊天页在哪个 tab 栈打开（messages/discover/...），决定返回兜底与子页面跳转的 scope。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const currentUserID = useChatStore((state) => state.currentUserId);
  const setActiveConversationId = useChatStore(
    (state) => state.setActiveConversationId,
  );
  const authUser = useAuthStore((state) => state.user);
  // Pattern D 双层防抖：disabled={sending} 在 fast double-tap 下可能晚一帧才生效；
  // inFlightRef 在 hook 入口处再判断一次，保证同一时刻只有一条消息在飞。文本 / 图片 /
  // 位置 / 笔记 / 名片 / 转账 6 条发送路径共享同一道闸。
  const inFlightRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [expandedComposer, setExpandedComposer] = useState(false);
  const composerInputRef = useRef<TextInput>(null);
  const [mentionFocusRequested, setMentionFocusRequested] = useState(false);
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
  const [sendError, setSendError] = useState<string | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const mountedRef = useRef(true);
  // 消息长按菜单在上传管线之前声明,拿不到后面才定义的 reuploadPendingMedia;
  // 点「重发」时从这里取最新的那个。
  const reuploadPendingMediaRef = useRef<
    ((upload: PendingMediaUpload) => Promise<void>) | null
  >(null);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const {
    sourceID,
    conversationID,
    isTempChat,
    selfSilencedUntil,
    selfSilenced,
    composerLocked,
    selfDestructEnabled,
    conversationBurnEnabled,
    conversationBurnDurationSec,
    selfDestructCacheKey,
    viewerSelfDestructSec,
    remoteBurnPolicy,
    setRemoteBurnPolicy,
    conversationMessages,
    peerReadHeight,
    peerDeliveredHeight,
    conversationType,
    isGroupChat,
    isAssistantConversation,
    canViewGroupMemberProfiles,
    canViewMemberProfilesByPolicy,
    revalidateMemberViewAccess,
    conversationTitle,
    avatarUrl,
    searchedMsgID,
    entryUnreadCount,
    entryReadHeight,
    isPreviewMode,
  } = useChatConversation({
    t,
    params,
    currentUserID,
  });

  const [assistantSpinning, setAssistantSpinning] = useState(false);
  const assistantLatestMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAssistantConversation) {
      assistantLatestMessageIdRef.current = null;
      setAssistantSpinning(false);
      return;
    }

    const latestMessage = (conversationMessages ?? []).reduce<
      (typeof conversationMessages)[number] | null
    >((latest, candidate) => {
      if (!latest || candidate.height > latest.height) return candidate;
      return latest;
    }, null);

    if (!latestMessage) return;
    if (assistantLatestMessageIdRef.current === null) {
      assistantLatestMessageIdRef.current = latestMessage.id;
      return;
    }
    if (assistantLatestMessageIdRef.current === latestMessage.id) return;

    assistantLatestMessageIdRef.current = latestMessage.id;
    if (latestMessage.sender?.id === currentUserID) return;

    setAssistantSpinning(true);
    const timer = setTimeout(() => setAssistantSpinning(false), 1400);
    return () => clearTimeout(timer);
  }, [conversationMessages, currentUserID, isAssistantConversation]);

  const assistantDisplayName = isAssistantConversation
    ? t('assistant.name', { defaultValue: 'AI小助手' })
    : conversationTitle;

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

  const {
    keyboardVisible,
  } = useKeyboardVisible();

  const {
    backgroundStyle,
    backgroundImageUri,
  } = useChatBackground({
    colors,
    conversationID,
  });

  const mergeAvatar = useAppSettingsStore((state) => state.settings.mergeAvatar);
  // 名字的缩进必须与真实的头像列一致（MessageAvatar 里同一条规则）。
  const hideChatAvatar = useAppSettingsStore(
    (state) => state.settings.hideChatAvatar,
  );

  const {
    handleBack,
    handleOpenMessageSender,
    handleOpenSelfProfile,
    handleOpenUserCard,
    handleOpenHeaderTarget,
    statusColor,
    headerStatusText,
  } = useChatHeader({
    colors,
    t,
    scope,
    currentUserID,
    authUser,
    sourceID,
    conversationID,
    isTempChat,
    isAssistantConversation,
    conversationType,
    isGroupChat,
    canViewMemberProfilesByPolicy,
    revalidateMemberViewAccess,
    conversationTitle,
  });

  const {
    d,
  } = useChatDetailThemedStyles({
    colors,
    backgroundStyle,
  });

  const {
    conversationBurnNoticeText,
  } = useBurnNotice({
    t,
    conversationBurnEnabled,
    conversationBurnDurationSec,
    viewerSelfDestructSec,
    remoteBurnPolicy,
    conversationType,
  });

  const {
    flatListRef,
    scrollRetryCountRef,
    scrollRetryTimerRef,
    messagesLengthRef,
    handleLoadOlder,
    historyWindowFull,
    messages,
    displayMessages,
    handleMessageListScroll,
    handleImageViewed,
    handleJumpToUnread,
    handleUnreadStartVisibilityChange,
    showUnreadJump,
    showLatestJump,
    handleJumpToLatest,
    unreadStartMessageID,
    highlightedMessageID,
    handleQuotePress,
    jumpToMessage,
  } = useChatTimeline({
    currentUserID,
    setActiveConversationId,
    mountedRef,
    sourceID,
    conversationID,
    setRemoteBurnPolicy,
    conversationMessages,
    peerReadHeight,
    peerDeliveredHeight,
    entryUnreadCount,
    entryReadHeight,
    searchedMsgID,
    mergeAvatar,
  });

  useNoteCardStatusSync(conversationID, conversationMessages);

  const selfAvatarUri = authUser?.avatarUrl ?? undefined;
  const selfName = authUser?.nickname ?? authUser?.accountId;

  const [quoteTarget, setQuoteTarget] = useState<ChatMessage | null>(null);
  // G-07 编辑态:非空时发送按钮改走 chat:edit,输入框上方出现编辑横条。
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const { clearPersistedDraft } = useComposerDraftPersistence({
    userId: currentUserID,
    conversationId: conversationID,
    draft,
    setDraft,
    mentionTargets,
    setMentionTargets,
    quoteTarget,
    setQuoteTarget,
    messages,
    paused: editingMessageId !== null,
  });

  const {
    handleCollectMessage,
    noteCollectSheet,
    noteCollectVisible,
  } = useCollectMessage({
    t,
    currentUserID,
    sourceID,
    conversationID,
    isGroupChat,
    conversationTitle,
    avatarUrl,
    selfAvatarUri,
    selfName,
  });

  const {
    selectedMessageIds,
    selectedMessages,
    selectionProgress,
    canSaveSelectedMessages,
    canCollectSelectedMessages,
    handleSaveSelectedMessages,
    handleCollectSelectedMessages,
    handleCancelMessageSelection,
    handleToggleSelectedMessage,
    handleDeleteSelectedMessages,
    handleForwardSelectedMessages,
    canForwardSelectedMessages,
    actionMenu,
    setActionMenu,
    handleToggleReaction,
    reactionTarget,
    setReactionTarget,
    handlePickReaction,
    messageActions,
    handleRetryMessage,
    getMessageLongPressHandler,
  } = useMessageActions({
    messages,
    t,
    setDraft,
    setSendError,
    mountedRef,
    reuploadPendingMediaRef,
    sourceID,
    conversationID,
    conversationBurnEnabled,
    isGroupChat,
    conversationTitle,
    scope,
    setQuoteTarget,
    setEditingMessageId,
    handleCollectMessage,
  });

  const {
    callStarting,
    handleStartCall,
  } = useChatCall({
    t,
    authUser,
    mountedRef,
    sourceID,
    conversationID,
    isGroupChat,
    revalidateMemberViewAccess,
    isPreviewMode,
  });


  const {
    attachmentOpen,
    setAttachmentOpen,
    attachmentPage,
    setAttachmentPage,
    attachmentPagerWidth,
    setAttachmentPagerWidth,
    emojiOpen,
    setEmojiOpen,
    handleAttachmentToggle,
    handleEmojiToggle,
    closeInputPanels,
    attachmentPanResponder,
  } = useComposerPanels({
    mentionPickerVisible,
    setMentionPickerVisible,
    onPanelOpenChange: sheet?.onPanelOpenChange,
  });

  const {
    selection,
    visibleMentionCandidates,
    handleInsertEmoji,
    handleSelectionChange,
    handleDraftChange,
    handlePickMention,
    handleInsertMention,
  } = useComposerInput({
    currentUserID,
    draft,
    setDraft,
    setMentionPickerVisible,
    mentionQuery,
    setMentionQuery,
    mentionCandidates,
    setMentionCandidates,
    mentionCandidatesCacheRef,
    mentionCandidatesInflightRef,
    setMentionTargets,
    setGroupMemberNames,
    mountedRef,
    sourceID,
    conversationID,
    isGroupChat,
    canViewGroupMemberProfiles,
  });

  const {
    sendDraftAsText,
  } = useQuickTextSend({
    t,
    inFlightRef,
    setSendError,
    mountedRef,
    sourceID,
    conversationID,
    conversationType,
    isGroupChat,
    isPreviewMode,
  });

  const {
    voiceInputMode,
    cancelArmed,
    isVoiceRecording,
    voiceElapsedSeconds,
    toggleVoiceInputMode,
    uploadAndSendVoice,
    voicePanResponder,
  } = useVoiceRecording({
    t,
    inFlightRef,
    setSendError,
    setAttachmentOpen,
    setEmojiOpen,
    windowWidth,
    mountedRef,
    sourceID,
    conversationID,
    isTempChat,
    composerLocked,
    conversationType,
    isGroupChat,
    isPreviewMode,
  });

  const handleMentionSender = useCallback((message: ChatMessage) => {
    if (!message.senderID || message.outgoing) return;
    handleInsertMention({
      userID: message.senderID,
      nickname: groupMemberNames[message.senderID]?.trim() || message.senderName?.trim() || message.senderID,
    });
    closeInputPanels(false);
    if (voiceInputMode) toggleVoiceInputMode();
    setMentionFocusRequested(true);
  }, [closeInputPanels, groupMemberNames, handleInsertMention, toggleVoiceInputMode, voiceInputMode]);

  useEffect(() => {
    if (!mentionFocusRequested || voiceInputMode) return;
    setMentionFocusRequested(false);
    composerInputRef.current?.focus();
  }, [mentionFocusRequested, voiceInputMode]);

  const {
    handlePickNoteBatch,
    handleSendNoteSection,
  } = useNoteBatchSend({
    t,
    authUser,
    setSendError,
    mountedRef,
    sourceID,
    conversationID,
    isPreviewMode,
  });

  const {
    renderItem,
    keyExtractor,
    imageViewer,
  } = useMessageRenderer({
    isAssistantConversation,
    messages,
    handleImageViewed,
    selectedMessageIds,
    handleToggleSelectedMessage,
    colors,
    scope,
    conversationID,
    groupMemberNames,
    selfDestructEnabled,
    selfDestructCacheKey,
    isGroupChat,
    conversationTitle,
    avatarUrl,
    handleOpenMessageSender,
    onMentionSender: isGroupChat && canViewGroupMemberProfiles && !composerLocked && !isPreviewMode && !isVoiceRecording
      ? handleMentionSender : undefined,
    handleOpenSelfProfile,
    handleOpenUserCard,
    hideChatAvatar,
    d,
    highlightedMessageID,
    handleQuotePress,
    selfAvatarUri,
    selfName,
    handleToggleReaction,
    handleRetryMessage,
    getMessageLongPressHandler,
    handleStartCall,
    handleSendNoteSection,
  });

  const {
    handleOpenLocationPicker,
  } = useLocationSend({
    t,
    inFlightRef,
    setSendError,
    mountedRef,
    sourceID,
    conversationID,
    isPreviewMode,
  });

  const {
    mediaSourceSheetVisible,
    setMediaSourceSheetVisible,
    handleMediaSourceSelect,
    handleMediaSourceSheetDismiss,
    galleryMode,
    setGalleryMode,
    handleGalleryConfirm,
    handleGalleryDismiss,
    handlePickFromSystem,
    photoEditorAsset,
    setPhotoEditorAsset,
    handleSendEditedPhoto,
  } = useMediaSend({
    t,
    inFlightRef,
    setSendError,
    mountedRef,
    reuploadPendingMediaRef,
    sourceID,
    conversationID,
    isTempChat,
    conversationType,
    isGroupChat,
    isPreviewMode,
    uploadAndSendVoice,
  });

  const { handleSendSticker } = useStickerSend({ t, inFlightRef, setSendError, mountedRef, sourceID, conversationID, isTempChat, composerLocked, isPreviewMode });

  // 输入栏的「清除聊天记录」：和聊天信息页同一套确认流程。群主判据与会话列表左滑删除
  // 一致（服务端实时算的 myRole，ownerId 兜底旧 DTO），点的时候才读 store。
  const handleClearHistory = useCallback(() => {
    if (!conversationID) return;
    const raw = useChatStore.getState().conversations.find((item) => item.id === conversationID);
    confirmClearChatHistory({
      conversationId: conversationID,
      isGroupConversation: isGroupChat,
      canClearGroupForEveryone: raw?.myRole === 'OWNER' || raw?.ownerId === currentUserID,
      t,
      openDirectDialog: () => setClearDialogVisible(true),
    });
  }, [conversationID, currentUserID, isGroupChat, t]);

  const {
    handleAttachmentAction,
    handlePickFriend,
    handlePickGroupCard,
    handlePickFavorite,
    handlePickQuickReply,
  } = useAttachmentActions({
    t,
    inFlightRef,
    setSendError,
    setAttachmentOpen,
    mountedRef,
    sourceID,
    conversationID,
    conversationType,
    isGroupChat,
    conversationTitle,
    avatarUrl,
    isPreviewMode,
    handleStartCall,
    sendDraftAsText,
    handleOpenLocationPicker,
    setMediaSourceSheetVisible,
  });

  const {
    sending,
    pendingCard,
    setPendingCard,
    handleSend,
  } = useComposerSend({
    t,
    inFlightRef,
    draft,
    setDraft,
    setMentionPickerVisible,
    setMentionQuery,
    mentionTargets,
    setMentionTargets,
    setSendError,
    mountedRef,
    sourceID,
    conversationID,
    conversationType,
    isGroupChat,
    isPreviewMode,
    quoteTarget,
    setQuoteTarget,
    editingMessageId,
    setEditingMessageId,
    clearPersistedDraft,
    handlePickNoteBatch,
    handlePickFriend,
    handlePickGroupCard,
    handlePickFavorite,
    handlePickQuickReply,
  });

  const mentionPicker = (
    <MentionPickerPanel
      colors={colors}
      t={t}
      mentionPickerVisible={mentionPickerVisible}
      d={d}
      visibleMentionCandidates={visibleMentionCandidates}
      handlePickMention={handlePickMention}
    />
  );

  const header = (
    <ChatDetailHeader
      embedded={embedded}
      sheet={sheet}
      colors={colors}
      scope={scope}
      sourceID={sourceID}
      conversationID={conversationID}
      isTempChat={isTempChat}
      isAssistant={isAssistantConversation}
      isGroupChat={isGroupChat}
      conversationTitle={assistantDisplayName}
      avatarUrl={avatarUrl}
      handleBack={handleBack}
      handleOpenHeaderTarget={handleOpenHeaderTarget}
      headerStatusText={headerStatusText}
      statusColor={statusColor}
      fadeColor={backgroundStyle.backgroundColor}
      blurTarget={messageBlurTarget}
      assistantSpinning={assistantSpinning}
    />
  );
  const topBanners = (
    <>
      {isGroupChat ? <GroupNoticeBanner conversationID={conversationID} scope={scope} /> : null}
      <PinnedMessageBanner conversationID={conversationID} onJump={jumpToMessage} />
      {/* 嵌在桌面分栏里时左侧消息列表已经挂着同一条提示。 */}
      {embedded ? null : <ChatConnectionBanner style={s.connectionBanner} />}
      {conversationBurnNoticeText ? (
        <View testID="chat-disappearing-message-notice" style={s.disappearingMessageNotice}>
          {/* 浮在消息上,得是玻璃而不是半透明紫,否则字和后面的消息叠在一起。 */}
          <GlassSurface
            material="banner"
            radius={Radius.lg}
            blurTarget={messageBlurTarget}
            style={s.disappearingMessageNoticePill}
          >
            <Ionicons name="flame-outline" size={16} color={colors.iconAccent} />
            <Text
              style={[
                s.disappearingMessageNoticeText,
                d.disappearingMessageNoticeText,
              ]}
            >
              {conversationBurnNoticeText}
            </Text>
          </GlassSurface>
        </View>
      ) : null}
    </>
  );

  return (
    <KeyboardAvoidingContainer
      testID={E2E_TEST_IDS.chatScreen}
      // 普通会话的顶栏悬浮在消息上、自己让开状态栏;小助手的角色头部仍按老布局排在上面。
      style={[s.composerPanelStack, d.container, { paddingTop: sheet || !isAssistantConversation ? 0 : insets.top }]}
      // The note-collection sheet is a separate full-screen modal. Keeping the
      // chat page's keyboard padding while that modal is mounted leaves the
      // modal content anchored above the composer on iOS.
      // Composer panels replace the keyboard and must not stack on its closing inset.
      enabled={!sheet && !noteCollectVisible && !attachmentOpen && !emojiOpen && !expandedComposer}
      // 共享容器统一处理键盘避让，两端都把输入栏顶到键盘上方。
    >
      {isAssistantConversation ? header : null}
      {isAssistantConversation ? topBanners : null}
      <View style={s.chatBody}>
        <BlurTargetView ref={messageBlurTarget} style={s.messageArea}>
          <ChatMessageArea
            headerInset={isAssistantConversation ? 0 : topDockHeight}
            composerInset={composerDockHeight}
            colors={colors}
            t={t}
            mountedRef={mountedRef}
            backgroundImageUri={backgroundImageUri}
            d={d}
            flatListRef={flatListRef}
            scrollRetryCountRef={scrollRetryCountRef}
            scrollRetryTimerRef={scrollRetryTimerRef}
            messagesLengthRef={messagesLengthRef}
            handleLoadOlder={handleLoadOlder}
            historyWindowFull={historyWindowFull}
            unreadCount={entryUnreadCount}
            showUnreadJump={showUnreadJump}
            showLatestJump={showLatestJump}
            handleJumpToLatest={handleJumpToLatest}
            unreadStartMessageID={unreadStartMessageID}
            messages={messages}
            displayMessages={displayMessages}
            handleMessageListScroll={handleMessageListScroll}
            handleJumpToUnread={handleJumpToUnread}
            handleUnreadStartVisibilityChange={handleUnreadStartVisibilityChange}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            closeInputPanels={closeInputPanels}
          />
        </BlurTargetView>
        {isAssistantConversation ? null : (
          <View
            testID="chat-top-dock"
            pointerEvents="box-none"
            style={s.topDock}
            onLayout={(event) => setTopDockHeight(event.nativeEvent.layout.height)}
          >
            {header}
            {topBanners}
          </View>
        )}
        <View
          testID="chat-composer-dock"
          pointerEvents="box-none"
          style={s.composerDock}
          onLayout={(event) => setComposerDockHeight(event.nativeEvent.layout.height)}
        >
          {selectedMessageIds !== null ? (
            <MessageSelectionToolbar
              count={selectedMessages.length} bottomInset={insets.bottom}
              canSave={canSaveSelectedMessages} canForward={canForwardSelectedMessages} canCollect={canCollectSelectedMessages}
              progress={selectionProgress}
              onSave={() => void handleSaveSelectedMessages()} onForward={handleForwardSelectedMessages}
              onCollect={() => void handleCollectSelectedMessages()} onDelete={handleDeleteSelectedMessages}
              onCancel={handleCancelMessageSelection}
            />
          ) : <>
          {isPreviewMode ? (
            <Text style={[s.previewNotice, Typography.small, { color: colors.text }]}>
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
          {!expandedComposer ? mentionPicker : null}
          <ComposerBanners
            colors={colors}
            t={t}
            setDraft={setDraft}
            selfSilencedUntil={selfSilencedUntil}
            selfSilenced={selfSilenced}
            composerLocked={composerLocked}
            d={d}
            quoteTarget={quoteTarget}
            setQuoteTarget={setQuoteTarget}
            editingMessageId={editingMessageId}
            setEditingMessageId={setEditingMessageId}
            pendingCard={pendingCard}
            setPendingCard={setPendingCard}
          />
          <ChatComposerBar
            inputRef={composerInputRef}
            expanded={expandedComposer}
            setExpanded={setExpandedComposer}
            mentionPicker={mentionPicker}
            blurTarget={messageBlurTarget}
            insets={insets}
            colors={colors}
            t={t}
            draft={draft}
            setMentionPickerVisible={setMentionPickerVisible}
            selfSilenced={selfSilenced}
            composerLocked={composerLocked}
            isPreviewMode={isPreviewMode}
            keyboardVisible={keyboardVisible}
            d={d}
            attachmentOpen={attachmentOpen}
            setAttachmentOpen={setAttachmentOpen}
            emojiOpen={emojiOpen}
            setEmojiOpen={setEmojiOpen}
            handleAttachmentToggle={handleAttachmentToggle}
            handleEmojiToggle={handleEmojiToggle}
            handleAttachmentAction={handleAttachmentAction}
            onClearHistory={handleClearHistory}
            selection={selection}
            handleSelectionChange={handleSelectionChange}
            handleDraftChange={handleDraftChange}
            voiceInputMode={voiceInputMode}
            cancelArmed={cancelArmed}
            isVoiceRecording={isVoiceRecording}
            voiceElapsedSeconds={voiceElapsedSeconds}
            toggleVoiceInputMode={toggleVoiceInputMode}
            voicePanResponder={voicePanResponder}
            sending={sending}
            pendingCard={pendingCard}
            handleSend={handleSend}
          />
          </>}
        </View>
      </View>
      {imageViewer}
      {selectedMessageIds === null && emojiOpen ? (
        <View
          testID="chat-emoji-panel"
          style={[
            s.composerPanelLayer,
            d.attachmentPanel,
            { paddingBottom: insets.bottom || Spacing.md },
          ]}
        >
          <EmojiPicker onSelect={handleInsertEmoji} onSelectSticker={handleSendSticker} />
        </View>
      ) : null}
      {selectedMessageIds === null ? <AttachmentPanel
        insets={insets}
        colors={colors}
        t={t}
        windowWidth={windowWidth}
        d={d}
        callStarting={callStarting}
        attachmentOpen={attachmentOpen}
        attachmentPage={attachmentPage}
        setAttachmentPage={setAttachmentPage}
        attachmentPagerWidth={attachmentPagerWidth}
        setAttachmentPagerWidth={setAttachmentPagerWidth}
        attachmentPanResponder={attachmentPanResponder}
        handleAttachmentAction={handleAttachmentAction}
      /> : null}
      <MessageActionMenu
        anchor={actionMenu ? { x: actionMenu.x, y: actionMenu.y } : null}
        actions={messageActions}
        onDismiss={() => setActionMenu(null)}
      />

      <ClearHistoryDialog
        visible={clearDialogVisible}
        onCancel={() => setClearDialogVisible(false)}
        onConfirm={(bothSides) => {
          setClearDialogVisible(false);
          if (conversationID) void clearDirectChatHistory(conversationID, bothSides, t);
        }}
      />

      <MediaSourceSheet
        visible={mediaSourceSheetVisible}
        onSelect={handleMediaSourceSelect}
        onClose={() => setMediaSourceSheetVisible(false)}
        onDismiss={handleMediaSourceSheetDismiss}
      />

      <ReactionPickerSheet
        visible={reactionTarget !== null}
        onSelect={handlePickReaction}
        onClose={() => setReactionTarget(null)}
      />

      <PhotoEditorModal
        asset={photoEditorAsset}
        onCancel={() => setPhotoEditorAsset(null)}
        onSend={handleSendEditedPhoto}
      />

      <MediaGalleryPicker
        mode={galleryMode}
        onCancel={() => setGalleryMode(null)}
        onConfirm={handleGalleryConfirm}
        onPickFromSystem={(caption) => void handlePickFromSystem(caption)}
        onDismiss={handleGalleryDismiss}
      />

      {noteCollectSheet}

      {/* 微信式全屏录音浮层：录音时盖在最上层，纯展示（pointerEvents none）。 */}
      {isVoiceRecording ? (
        <VoiceRecordingOverlay
          cancelArmed={cancelArmed}
          elapsedSeconds={voiceElapsedSeconds}
        />
      ) : null}
    </KeyboardAvoidingContainer>
  );
}
