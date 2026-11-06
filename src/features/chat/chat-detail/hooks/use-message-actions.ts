import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ChatMessage } from '@/types';
import { useChatStore, type StoredChatMessage } from '@/chat-core/store';
import { isGroupManager } from '@/features/chat/group-admin-permissions';
import { useAuthStore } from '@/stores/authStore';
import { useChatRouter } from '@/features/chat/chat-detail/hooks/use-chat-router';
import { Alert, Keyboard, Platform, type GestureResponderEvent } from 'react-native';
import { revokeChatMessage, sendChatReaction } from '@/chat-core/socket-manager';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { type MessageAction } from '@/features/chat/components/MessageActionMenu';
import { type PendingMediaUpload, retryFailedChatMessage } from '@/chat-core/client';
import { canForwardMessage } from '@/features/chat/screens/ForwardPickerScreen';
import { isEphemeralMessage, isEphemeralPeerMessage } from '@/features/chat/utils/ephemeral-message';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import { setChatPinnedMessage } from '@/chat-core/api';
import { canManageChatPins } from '@/features/chat/utils/chat-pins';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { saveMediaToLibrary } from '@/utils/save-image';
import { getMessageReadersHref, type UserProfileScope } from '@/features/user/utils/routes';
import { useStickerStore } from '@/features/chat/store/use-sticker-store';
import { getStickerErrorMessage } from '@/features/chat/utils/sticker-error';
import { type TFunction } from 'i18next';
import type { CollectMessageResult } from './use-collect-message';

export type MessageSelectionProgress = { action: 'save' | 'collect'; current: number; total: number };

export interface MessageActionsParams {
  messages: ChatMessage[];
  t: TFunction<"translation", undefined>;
  setDraft: Dispatch<SetStateAction<string>>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  reuploadPendingMediaRef: RefObject<((upload: PendingMediaUpload) => Promise<void>) | null>;
  sourceID: string;
  conversationID: string;
  conversationBurnEnabled: boolean;
  isGroupChat: boolean;
  conversationTitle: string;
  /** 聊天页所在的 tab 栈:子页面(已读成员)要压在同一个栈里。 */
  scope: UserProfileScope;
  setQuoteTarget: Dispatch<SetStateAction<ChatMessage | null>>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  handleCollectMessage: (message: ChatMessage, options?: { silent?: boolean }) => Promise<CollectMessageResult>;
}

/**
 * 消息长按菜单:按消息状态与会话策略组装菜单项(重发/回应/编辑/已读成员/撤回/复制/引用/
 * 转发/收藏/删除/举报)并执行对应动作;表情回应选择面板的状态也在这里。
 */
export function useMessageActions({
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
}: MessageActionsParams) {
  const chatRouter = useChatRouter();
  const setPendingForward = useMessageForwardStore((s) => s.setPending);
  const setPendingForwardBatch = useMessageForwardStore((s) => s.setPendingBatch);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string> | null>(null);
  const [selectionProgress, setSelectionProgress] = useState<MessageSelectionProgress | null>(null);
  const selectionOperationRef = useRef<symbol | null>(null);
  const selectionContextRef = useRef({ conversationID, messages });
  selectionContextRef.current = { conversationID, messages };
  useEffect(() => {
    setSelectedMessageIds(null);
    setSelectionProgress(null);
    selectionOperationRef.current = null;
    return () => { selectionOperationRef.current = null; };
  }, [conversationID]);
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIds?.has(message.id)),
    [messages, selectedMessageIds],
  );
  const handleCancelMessageSelection = useCallback(() => {
    if (!selectionOperationRef.current) setSelectedMessageIds(null);
  }, []);
  const handleStartMessageSelection = useCallback((message: ChatMessage) => {
    if (selectionOperationRef.current) return;
    Keyboard.dismiss();
    setSelectedMessageIds(new Set([message.id]));
  }, []);
  const handleToggleSelectedMessage = useCallback((id: string) => {
    if (selectionOperationRef.current) return;
    setSelectedMessageIds((previous) => {
      if (!previous) return previous;
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const canSaveSelectionMessage = useCallback((message: ChatMessage) =>
    !isLocalMessageId(message.id) && !isEphemeralMessage(message, conversationBurnEnabled) &&
    ((message.type === 'image' && Boolean(message.imageUrl)) || (message.type === 'video' && Boolean(message.videoUrl))),
  [conversationBurnEnabled]);
  const canCollectSelectionMessage = useCallback((message: ChatMessage) =>
    !isLocalMessageId(message.id) && !isEphemeralPeerMessage(message, conversationBurnEnabled) &&
    !['date', 'system-notice', 'call-record', 'verification-card'].includes(message.type),
  [conversationBurnEnabled]);
  const canSaveSelectedMessages = selectedMessages.some(canSaveSelectionMessage);
  const canCollectSelectedMessages = selectedMessages.some(canCollectSelectionMessage);

  const handleSelectedMessageBatch = useCallback(async (action: 'save' | 'collect') => {
    if (selectionOperationRef.current || selectedMessages.length === 0 || useChatStore.getState().activeConversationId !== conversationID) return;
    const operation = Symbol(action);
    const epoch = useAuthStore.getState().sessionEpoch;
    const pending = selectedMessages.slice().reverse();
    const remaining = new Set(pending.map((message) => message.id));
    const ownsOperation = () => mountedRef.current && selectionOperationRef.current === operation &&
      selectionContextRef.current.conversationID === conversationID && useAuthStore.getState().sessionEpoch === epoch;
    const isCurrent = () => ownsOperation() && useChatStore.getState().activeConversationId === conversationID;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let permissionDenied = false;
    let cancelled = false;
    selectionOperationRef.current = operation;
    setSelectionProgress({ action, current: 0, total: pending.length });
    try {
      for (let index = 0; index < pending.length; index++) {
        if (!isCurrent()) return;
        const message = selectionContextRef.current.messages.find((item) => item.id === pending[index].id);
        const eligible = message && (action === 'save' ? canSaveSelectionMessage(message) : canCollectSelectionMessage(message));
        if (!eligible || !message) {
          skipped++;
          remaining.delete(pending[index].id);
          continue;
        }
        setSelectionProgress({ action, current: index + 1, total: pending.length });
        const outcome = action === 'save'
          ? await saveMediaToLibrary(message.type === 'video' ? message.videoUrl! : message.imageUrl!, message.type === 'video' ? { mimeType: 'video/mp4' } : undefined)
          : await handleCollectMessage(message, { silent: true });
        if (!ownsOperation()) return;
        if (outcome === 'denied') { permissionDenied = true; break; }
        if (outcome === 'cancelled' || outcome === 'pending') { cancelled = true; break; }
        if (outcome === 'saved' || outcome === 'collected') { success++; remaining.delete(message.id); }
        else if (outcome === 'skipped') { skipped++; remaining.delete(message.id); }
        else failed++;
      }
      if (!isCurrent()) return;
      if (cancelled) return;
      if (permissionDenied) Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
      else {
        const title = success > 0
          ? action === 'save' ? 'media.savedTitle' : 'chat.messageActions.collected'
          : failed > 0
            ? action === 'save' ? 'media.saveFailedTitle' : 'chat.messageActions.collectFailed'
            : 'chat.selection.noEligible';
        Alert.alert(t(title), t(`chat.selection.${action}Result`, { success, failed, skipped,
          defaultValue: action === 'save' ? '已保存 {{success}} 项，{{failed}} 项失败，{{skipped}} 项不支持保存' : '已收藏 {{success}} 项，{{failed}} 项失败，{{skipped}} 项已跳过',
        }));
      }
    } finally {
      if (selectionOperationRef.current === operation) {
        selectionOperationRef.current = null;
        if (mountedRef.current && selectionContextRef.current.conversationID === conversationID) {
          setSelectionProgress(null);
          setSelectedMessageIds(useAuthStore.getState().sessionEpoch !== epoch || remaining.size === 0 ? null : remaining);
        }
      }
    }
  }, [canCollectSelectionMessage, canSaveSelectionMessage, conversationID, handleCollectMessage, mountedRef, selectedMessages, t]);
  const handleSaveSelectedMessages = useCallback(() => handleSelectedMessageBatch('save'), [handleSelectedMessageBatch]);
  const handleCollectSelectedMessages = useCallback(() => handleSelectedMessageBatch('collect'), [handleSelectedMessageBatch]);
  const canForwardSelectedMessages = selectedMessages.length > 0 && selectedMessages.every((message) =>
    canForwardMessage(message, useChatStore.getState().messagesByConversation[conversationID]?.find((item) => item.id === message.id), conversationBurnEnabled),
  );
  const handleForwardSelectedMessages = useCallback(() => {
    if (!canForwardSelectedMessages || selectionOperationRef.current) return;
    const dtos = useChatStore.getState().messagesByConversation[conversationID];
    setPendingForwardBatch(selectedMessages.slice().reverse().map((message) => ({
      message,
      dto: dtos?.find((item) => item.id === message.id),
    })));
    setSelectedMessageIds(null);
    chatRouter.push({ pathname: '/(tabs)/messages/forward-picker' });
  }, [chatRouter, canForwardSelectedMessages, conversationID, selectedMessages, setPendingForwardBatch]);
  const handleDeleteSelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0 || selectionOperationRef.current) return;
    const epoch = useAuthStore.getState().sessionEpoch;
    Alert.alert(t('chat.messageActions.delete'), t('chat.messageActions.deleteSelectedConfirm', {
      count: selectedMessages.length,
      defaultValue: '删除所选 {{count}} 条本地消息？',
    }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => {
        if (!mountedRef.current || useAuthStore.getState().sessionEpoch !== epoch || selectionContextRef.current.conversationID !== conversationID) return;
        for (const message of selectedMessages) useChatStore.getState().removeMessage(conversationID, message.id);
        setSelectedMessageIds(null);
      } },
    ]);
  }, [conversationID, mountedRef, selectedMessages, t]);
  const [actionMenu, setActionMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const savingMediaRef = useRef(false);
  const savingStickerRef = useRef(false);
  const handleSaveSticker = useCallback(async (message: ChatMessage) => {
    if (savingStickerRef.current || message.type !== 'image' || isLocalMessageId(message.id) || isEphemeralMessage(message, conversationBurnEnabled)) return;
    const epoch = useAuthStore.getState().sessionEpoch;
    savingStickerRef.current = true;
    try {
      await useStickerStore.getState().save({ messageId: message.id });
      if (mountedRef.current && useAuthStore.getState().sessionEpoch === epoch) Alert.alert(t('chat.stickers.saved'));
    } catch (error) {
      if (mountedRef.current && useAuthStore.getState().sessionEpoch === epoch) Alert.alert(getStickerErrorMessage(error, t, t('chat.stickers.saveFailed')));
    } finally {
      savingStickerRef.current = false;
    }
  }, [conversationBurnEnabled, mountedRef, t]);
  const handleSaveMedia = useCallback(async (message: ChatMessage) => {
    const url = message.type === 'video' ? message.videoUrl : message.imageUrl;
    if (!url || savingMediaRef.current || selectionOperationRef.current) return;
    savingMediaRef.current = true;
    const epoch = useAuthStore.getState().sessionEpoch;
    try {
      const outcome = await saveMediaToLibrary(
        url,
        message.type === 'video' ? { mimeType: 'video/mp4' } : undefined,
      );
      if (!mountedRef.current || useAuthStore.getState().sessionEpoch !== epoch) return;
      if (outcome === 'denied') {
        Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
      } else if (outcome === 'failed') {
        Alert.alert(t('media.saveFailedTitle'), t('media.saveFailedMessage'));
      } else if (Platform.OS !== 'web') {
        Alert.alert(t('media.savedTitle'));
      }
    } finally {
      savingMediaRef.current = false;
    }
  }, [mountedRef, t]);

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
      chatRouter.push({ pathname: '/(tabs)/messages/forward-picker' });
    },
    [chatRouter, conversationID, setPendingForward],
  );

  const handleQuoteMessage = useCallback((message: ChatMessage) => {
    setQuoteTarget(message);
  }, [setQuoteTarget]);

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
      chatRouter.push({
        pathname: '/(tabs)/messages/report-friend',
        params: {
          targetType: 'group',
          groupID: sourceID,
          groupName: conversationTitle,
        },
      });
      return;
    }
    chatRouter.push({
      pathname: '/(tabs)/messages/report-friend',
      params: {
        targetType: 'friend',
        friendUserId: sourceID,
        friendName: conversationTitle,
      },
    });
  }, [chatRouter, conversationTitle, isGroupChat, sourceID]);

  const handleMessageLongPress = useCallback(
    (message: ChatMessage, event: GestureResponderEvent) => {
      if (message.type === 'date') return;
      const { pageX, pageY } = event.nativeEvent;
      setActionMenu({ message, x: pageX, y: pageY });
    },
    [],
  );

  // Build the floating menu's items for the currently long-pressed message.
  // G-02 撤回:自己已送达的消息,2 分钟窗口内可撤;群聊里群主/管理员可撤任何人的
  // 消息、不受窗口限制。系统提示没有作者,谁都撤不了。角色取会话 DTO 的快照,
  // 权限判定始终以服务端 ack 为准(被撤权后点了会收到 CHAT_REVOKE_FORBIDDEN)。
  const canRevokeMessage = useCallback(
    (message: ChatMessage) => {
      const state = useChatStore.getState();
      const dto = state.messagesByConversation[conversationID]?.find(
        (m) => m.id === message.id,
      );
      if (!dto || dto.height <= 0 || dto.revokedAt || !dto.sender) return false;
      const myRole = state.conversations.find((c) => c.id === conversationID)?.myRole;
      if (isGroupChat && isGroupManager(myRole)) return true;
      if (!message.outgoing || message.sendStatus !== 2) return false;
      return Date.now() - Date.parse(dto.createdAt) <= 2 * 60_000;
    },
    [conversationID, isGroupChat],
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

  // 回应使用与聊天输入共用的完整表情面板。
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);

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
    [conversationID, setDraft, setEditingMessageId, setQuoteTarget],
  );

  /** 置顶 / 取消置顶:会话里所有人顶部都会出现横幅。 */
  const handleTogglePin = useCallback(
    async (message: ChatMessage, pinned: boolean) => {
      try {
        await setChatPinnedMessage(conversationID, pinned ? null : message.id);
      } catch (error) {
        reportHandledFailure('chatDetail', 'togglePinMessage', error);
        if (!mountedRef.current) return;
        Alert.alert(
          t('chat.pin.failed', { defaultValue: '操作失败' }),
          getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
      }
    },
    [conversationID, mountedRef, t],
  );

  // G-07 逐条已读(群聊自己的消息):读者列表来自已读水位,无回执表。
  // 人多时弹窗放不下,整页列表展示。
  const handleShowReaders = useCallback(
    (message: ChatMessage) => {
      chatRouter.push(
        getMessageReadersHref(scope, { conversationId: conversationID, messageId: message.id }),
      );
    },
    [chatRouter, conversationID, scope],
  );

  const resendMessage = useCallback(
    (message: ChatMessage) => {
      const epoch = useAuthStore.getState().sessionEpoch;
      const isCurrent = () =>
        mountedRef.current &&
        useAuthStore.getState().sessionEpoch === epoch &&
        useChatStore.getState().activeConversationId === conversationID;
      const isFailed = () => {
        const dto = useChatStore
          .getState()
          .messagesByConversation[conversationID]?.find(
            (item) => item.id === message.id && item.d === message.deliveryId,
          ) as StoredChatMessage | undefined;
        return dto?.height === 0 && dto.failed === true;
      };
      if (!message.deliveryId || !isCurrent() || !isFailed()) return;
      setSendError(null);
      void retryFailedChatMessage(conversationID, message.deliveryId, {
        reuploadMedia: reuploadPendingMediaRef.current ?? undefined,
      }).catch((error: unknown) => {
        if (!isCurrent()) return;
        setSendError(
          getChatSendErrorMessage(
            error,
            t('chat.detail.sendFailedText', { defaultValue: '发送失败' }),
          ),
        );
      });
    },
    [conversationID, mountedRef, reuploadPendingMediaRef, setSendError, t],
  );

  const handleRetryMessage = useCallback(
    (message: ChatMessage) => {
      if (message.sendStatus !== 3 || !message.deliveryId) return;
      const epoch = useAuthStore.getState().sessionEpoch;
      Alert.alert(
        t('chat.messageActions.resend'),
        t('chat.messageActions.resendConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('chat.messageActions.resend'),
            onPress: () => {
              if (useAuthStore.getState().sessionEpoch !== epoch) return;
              resendMessage(message);
            },
          },
        ],
      );
    },
    [resendMessage, t],
  );

  const messageActions = useMemo<MessageAction[]>(() => {
    const message = actionMenu?.message;
    if (!message) return [];
    const dto = useChatStore
      .getState()
      .messagesByConversation[conversationID]?.find(
        (item) => item.id === message.id,
      );
    const actions: MessageAction[] = [];
    actions.push({
      key: 'multi-select',
      icon: 'checkbox-outline',
      label: t('notes.actions.multiSelect'),
      onPress: () => handleStartMessageSelection(message),
    });
    if (
      ((message.type === 'image' && message.imageUrl) ||
        (message.type === 'video' && message.videoUrl)) &&
      !isEphemeralMessage(message, conversationBurnEnabled) &&
      !isLocalMessageId(message.id)
    ) {
      actions.push({
        key: 'save',
        icon: 'download-outline',
        label: t(message.type === 'image' ? 'media.saveImage' : 'common.save'),
        onPress: () => void handleSaveMedia(message),
      });
    }
    if (message.type === 'image' && message.imageUrl && !isEphemeralMessage(message, conversationBurnEnabled) && !isLocalMessageId(message.id)) {
      actions.push({ key: 'save-sticker', icon: 'happy-outline', label: t('chat.stickers.save'), onPress: () => void handleSaveSticker(message) });
    }
    if (message.sendStatus === 3 && message.deliveryId) {
      actions.push({
        key: 'resend',
        icon: 'refresh-outline',
        label: t('chat.messageActions.resend', { defaultValue: '重发' }),
        onPress: () => resendMessage(message),
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
      label: t('chat.messageActions.quote', { defaultValue: '回复' }),
      onPress: () => handleQuoteMessage(message),
    });
    // 置顶:任何类型的消息都能置顶(图片、笔记卡片也行),系统提示、通话记录、
    // 还没 ack 的乐观气泡除外;群里只有群主/管理员,私聊双方都能。
    const pinConversation = useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationID);
    if (
      pinConversation &&
      canManageChatPins(pinConversation) &&
      !isLocalMessageId(message.id) &&
      // 阅后即焚的不能置顶:横幅上的预览会比消息本身活得久。服务端同样拒绝。
      !isEphemeralMessage(message, conversationBurnEnabled) &&
      message.type !== 'system-notice' &&
      message.type !== 'call-record' &&
      message.type !== 'date' &&
      (message.sendStatus === undefined || message.sendStatus === 2)
    ) {
      const pinned = pinConversation.pinnedMessage?.messageId === message.id;
      actions.push({
        key: pinned ? 'unpin' : 'pin',
        icon: pinned ? 'pin' : 'pin-outline',
        label: pinned
          ? t('chat.pin.unpin', { defaultValue: '取消置顶' })
          : t('chat.pin.pin', { defaultValue: '置顶' }),
        onPress: () => void handleTogglePin(message, pinned),
      });
    }
    // 只在真能转发时给入口:通话记录走到转发页只会抛「不支持」,
    // 而 catch 提示的是「请重试」—— 一个永远不会成功的重试。
    if (canForwardMessage(message, dto, conversationBurnEnabled)) {
      actions.push({
        key: 'forward',
        icon: 'arrow-redo-outline',
        label: t('chat.messageActions.forward'),
        onPress: () => handleForwardMessage(message),
      });
    }
    // 「收藏」走的是另一扇门：它把客户端拼出来的快照写进用户自己的收藏列表，
    // 服务端从头到尾没看过这条消息，所以转发那条 CHAT_FORWARD_FORBIDDEN 管不到
    // 它 —— 对端在焚毁会话里发的图，收藏一下就永久留在了本机账号下。同一份承诺，
    // 同一道闸；自己发的照旧可收。
    // 收藏把 message.id 交给服务端当引用:还是 local:<d> 的乐观气泡在服务端没有
    // 对应的行,点下去只会吃一个 400,而提示的是「请重试」—— 重试到 ack 回来之前
    // 都不会成功。与隔壁转发对未确认媒体的处理同一条理由:不提供入口。
    if (
      !isEphemeralPeerMessage(message, conversationBurnEnabled) &&
      !isLocalMessageId(message.id)
    ) {
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
    }
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
    handleTogglePin,
    canEditMessage,
    canRevokeMessage,
    conversationBurnEnabled,
    conversationID,
    handleOpenReactionPicker,
    handleShowReaders,
    handleSaveMedia,
    handleSaveSticker,
    handleStartMessageSelection,
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
    resendMessage,
  ]);

  const getMessageLongPressHandler = useCallback(
    (message: ChatMessage) => (event: GestureResponderEvent) => {
      handleMessageLongPress(message, event);
    },
    [handleMessageLongPress],
  );

  return {
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
  };
}
