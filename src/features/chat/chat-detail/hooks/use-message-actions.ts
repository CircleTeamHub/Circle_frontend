import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { type ChatMessage } from '@/types';
import { useChatStore } from '@/chat-core/store';
import { router } from 'expo-router';
import { Alert, type GestureResponderEvent } from 'react-native';
import { revokeChatMessage, sendChatReaction } from '@/chat-core/socket-manager';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { CHAT_REACTION_EMOJIS } from '@/chat-core/protocol';
import { fetchMessageReaders } from '@/chat-core/api';
import { type MessageAction } from '@/features/chat/components/MessageActionMenu';
import { type PendingMediaUpload, retryFailedChatMessage } from '@/chat-core/client';
import { canForwardMessage } from '@/features/chat/screens/ForwardPickerScreen';
import { isEphemeralPeerMessage } from '@/features/chat/utils/ephemeral-message';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import { type TFunction } from 'i18next';

export interface MessageActionsParams {
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
  setQuoteTarget: Dispatch<SetStateAction<ChatMessage | null>>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  handleCollectMessage: (message: ChatMessage) => Promise<void>;
}

/**
 * 消息长按菜单:按消息状态与会话策略组装菜单项(重发/回应/编辑/已读成员/撤回/复制/引用/
 * 转发/收藏/删除/举报)并执行对应动作;表情回应选择面板的状态也在这里。
 */
export function useMessageActions({
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
}: MessageActionsParams) {
  const setPendingForward = useMessageForwardStore((s) => s.setPending);
  const [actionMenu, setActionMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);

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
    [conversationID, setDraft, setEditingMessageId, setQuoteTarget],
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
    [conversationID, t, mountedRef],
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
    if (message.sendStatus === 3 && message.deliveryId) {
      actions.push({
        key: 'resend',
        icon: 'refresh-outline',
        label: t('chat.messageActions.resend', { defaultValue: '重发' }),
        onPress: () => {
          void retryFailedChatMessage(
            conversationID,
            message.deliveryId as string,
            { reuploadMedia: reuploadPendingMediaRef.current ?? undefined },
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
    canEditMessage,
    canRevokeMessage,
    conversationBurnEnabled,
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
    reuploadPendingMediaRef,
    setSendError,
  ]);

  const getMessageLongPressHandler = useCallback(
    (message: ChatMessage) => (event: GestureResponderEvent) => {
      handleMessageLongPress(message, event);
    },
    [handleMessageLongPress],
  );

  return {
    actionMenu,
    setActionMenu,
    handleToggleReaction,
    reactionTarget,
    setReactionTarget,
    reactionOptions,
    handlePickReaction,
    messageActions,
    getMessageLongPressHandler,
  };
}
