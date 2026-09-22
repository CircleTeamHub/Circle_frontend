import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { Divider } from '@/components/ui/divider';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { VoiceRecordingOverlay } from '@/features/chat/components/voice-recording-overlay';
import { PhotoEditorModal } from '@/features/chat/components/photo-editor-modal';
import { MediaSourceSheet } from '@/features/chat/components/media-source-sheet';
import { MessageActionMenu } from '@/features/chat/components/MessageActionMenu';
import { getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { type PendingMediaUpload } from '@/chat-core/client';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { useComposerDraftPersistence } from '@/features/chat/hooks/use-composer-draft';
import { useChatStore } from '@/chat-core/store';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/types';
import { type MentionTarget } from '@/features/chat/utils/chat-send-payloads';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import type { EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { useVoiceRecording } from '@/features/chat/chat-detail/hooks/use-voice-recording';
import { useMediaSend } from '@/features/chat/chat-detail/hooks/use-media-send';
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
import { useChatConversation } from '@/features/chat/chat-detail/hooks/use-chat-conversation';
import { useKeyboardVisible } from '@/features/chat/chat-detail/hooks/use-keyboard-visible';
import { useChatBackground } from '@/features/chat/chat-detail/hooks/use-chat-background';
import { useChatHeader } from '@/features/chat/chat-detail/hooks/use-chat-header';
import { useBurnNotice } from '@/features/chat/chat-detail/hooks/use-burn-notice';
import { ChatDetailHeader } from '@/features/chat/chat-detail/components/ChatDetailHeader';
import { ChatMessageArea } from '@/features/chat/chat-detail/components/ChatMessageArea';
import { MentionPickerPanel } from '@/features/chat/chat-detail/components/MentionPickerPanel';
import { ComposerBanners } from '@/features/chat/chat-detail/components/ComposerBanners';
import { ChatComposerBar } from '@/features/chat/chat-detail/components/ChatComposerBar';
import { AttachmentPanel } from '@/features/chat/chat-detail/components/AttachmentPanel';

export type { EmbeddedChatParams } from '@/features/chat/chat-detail/types';

interface ChatDetailScreenProps {
  /**
   * 桌面网页版分栏模式：MessagesScreen 把本屏当组件内嵌进右栏并直接喂参数，
   * 不经过路由。置此项时隐藏返回键（左栏列表本身就是"返回"）；切换会话由
   * 父级用 key={conversationID} 整树重挂，保证各会话内部状态互不串扰。
   */
  embedded?: EmbeddedChatParams;
}

export default function ChatDetailScreen({ embedded }: ChatDetailScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const routeParams = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    conversationType?: 'private' | 'group';
    conversationKind?: 'direct' | 'group' | 'temp' | 'support';
    avatarUrl?: string;
    searchedMsgID?: string;
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
    canViewGroupMemberProfiles,
    canViewMemberProfilesByPolicy,
    revalidateMemberViewAccess,
    conversationTitle,
    avatarUrl,
    searchedMsgID,
    isPreviewMode,
  } = useChatConversation({
    t,
    params,
    currentUserID,
  });

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
    statusColor,
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
    highlightedMessageID,
    handleQuotePress,
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
    searchedMsgID,
    mergeAvatar,
  });

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
    actionMenu,
    setActionMenu,
    handleToggleReaction,
    reactionTarget,
    setReactionTarget,
    reactionOptions,
    handlePickReaction,
    messageActions,
    getMessageLongPressHandler,
  } = useMessageActions({
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
    renderItem,
    keyExtractor,
  } = useMessageRenderer({
    colors,
    scope,
    groupMemberNames,
    selfDestructEnabled,
    selfDestructCacheKey,
    isGroupChat,
    conversationTitle,
    avatarUrl,
    handleOpenMessageSender,
    handleOpenUserCard,
    hideChatAvatar,
    d,
    highlightedMessageID,
    handleQuotePress,
    selfAvatarUri,
    selfName,
    handleToggleReaction,
    getMessageLongPressHandler,
    handleStartCall,
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
    setMentionPickerVisible,
  });

  const {
    selection,
    visibleMentionCandidates,
    handleInsertEmoji,
    handleSelectionChange,
    handleDraftChange,
    handlePickMention,
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
    photoEditorAsset,
    setPhotoEditorAsset,
    handleSendEditedPhoto,
    handleMediaSourceSelect,
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

  const {
    handlePickNoteBatch,
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
    handleAttachmentAction,
    handlePickFriend,
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
    handlePickFavorite,
    handlePickQuickReply,
  });

  return (
    <KeyboardAvoidingContainer
      testID={E2E_TEST_IDS.chatScreen}
      style={[d.container, { paddingTop: insets.top }]}
      // 共享容器统一处理键盘避让，两端都把输入栏顶到键盘上方。
    >
      <ChatDetailHeader
        embedded={embedded}
        colors={colors}
        scope={scope}
        sourceID={sourceID}
        conversationID={conversationID}
        isTempChat={isTempChat}
        isGroupChat={isGroupChat}
        conversationTitle={conversationTitle}
        avatarUrl={avatarUrl}
        handleBack={handleBack}
        handleOpenHeaderTarget={handleOpenHeaderTarget}
        headerStatusText={headerStatusText}
        d={d}
      />
      <Divider />
      {conversationBurnNoticeText ? (
        <View
          testID="chat-disappearing-message-notice"
          style={[s.disappearingMessageNotice, d.disappearingMessageNotice]}
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
        </View>
      ) : null}
      <ChatMessageArea
        colors={colors}
        t={t}
        sendError={sendError}
        mountedRef={mountedRef}
        isPreviewMode={isPreviewMode}
        backgroundImageUri={backgroundImageUri}
        d={d}
        flatListRef={flatListRef}
        scrollRetryCountRef={scrollRetryCountRef}
        scrollRetryTimerRef={scrollRetryTimerRef}
        messagesLengthRef={messagesLengthRef}
        handleLoadOlder={handleLoadOlder}
        historyWindowFull={historyWindowFull}
        messages={messages}
        displayMessages={displayMessages}
        handleMessageListScroll={handleMessageListScroll}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        closeInputPanels={closeInputPanels}
        isVoiceRecording={isVoiceRecording}
        voiceElapsedSeconds={voiceElapsedSeconds}
      />
      <Divider />
      <MentionPickerPanel
        colors={colors}
        t={t}
        mentionPickerVisible={mentionPickerVisible}
        d={d}
        visibleMentionCandidates={visibleMentionCandidates}
        handlePickMention={handlePickMention}
      />
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
      <AttachmentPanel
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
      />
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
    </KeyboardAvoidingContainer>
  );
}
