import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useState,
} from 'react';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import {
  usePendingChatCardStore,
} from '@/features/chat/store/use-pending-chat-card-store';
import { type ChatMessage, type PlazaPostCardData } from '@/types';
import { useFocusEffect } from 'expo-router';
import { sendChatEditMessage } from '@/chat-core/socket-manager';
import { useChatStore } from '@/chat-core/store';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { sendCardMessage, sendQuoteMessage, sendTextMessage } from '@/chat-core/client';
import { type ChatSendHandle, startChatSend } from '@/chat-core/send-handle';
import {
  buildQuotePreviewText,
  getMentionsPresentInText,
  type MentionTarget,
} from '@/features/chat/utils/chat-send-payloads';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { type TFunction } from 'i18next';
import { type NoteSummary } from '@/features/notes/types';
import { type NoteSendOptions } from '@/features/chat/utils/note-batch-send';
import { type FriendProfile } from '@/services/api/friends';
import { type UserCollection } from '@/services/api/collections';

export interface ComposerSendParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setMentionPickerVisible: Dispatch<SetStateAction<boolean>>;
  setMentionQuery: Dispatch<SetStateAction<string | null>>;
  mentionTargets: MentionTarget[];
  setMentionTargets: Dispatch<SetStateAction<MentionTarget[]>>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  conversationType: "group" | "single";
  isGroupChat: boolean;
  isPreviewMode: boolean;
  quoteTarget: ChatMessage | null;
  setQuoteTarget: Dispatch<SetStateAction<ChatMessage | null>>;
  editingMessageId: string | null;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  clearPersistedDraft: () => void;
  handlePickNoteBatch: (notes: NoteSummary[], options: NoteSendOptions) => Promise<void>;
  handlePickFriend: (friend: FriendProfile) => Promise<void>;
  handlePickFavorite: (item: UserCollection) => Promise<void>;
  handlePickQuickReply: (phrase: string) => Promise<void>;
}

/**
 * 输入栏的发送:发送按钮(编辑态走 chat:edit;待发卡片 → 引用 / @ / 普通文本),
 * 以及从分享选择页、报名页回来时消费待发的笔记、名片、收藏与帖子卡片。
 */
export function useComposerSend({
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
}: ComposerSendParams) {
  const [sending, setSending] = useState(false);
  const consumePendingShare = useSharePickerStore((s) => s.consume);
  const consumePendingChatCard = usePendingChatCardStore((s) => s.consumeFor);
  // 待发送的圈子帖子卡片（报名→聊天自动挂上，贴在输入框上方，可撤掉）。
  const [pendingCard, setPendingCard] = useState<PlazaPostCardData | null>(null);
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
      setDraft,
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

    const reportSendFailure = (error: unknown) => {
      logChatSendFailure(error, {
        kind: 'text',
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
    };
    // 上屏、进了发送队列就算发出:清输入框、放开输入栏,不等服务端确认 —— 断线时队列
    // 会等重连(最长一分钟),等确认的话输入框就被锁那么久。之后真发不出去,气泡自己
    // 标红,这里只补一句提示。本地门禁拦下(没上屏)的才留着草稿、立刻报错。
    //
    // 进队这条路径上不能有 await:清草稿要和点击在同一个事件里提交,连点第二下时
    // 拿到的才是清空后的草稿,不会把同一段话再发一遍。
    const track = (handle: ChatSendHandle<unknown>) => {
      if (handle.queued) void handle.delivered.catch(reportSendFailure);
      return handle;
    };

    try {
      setSendError(null);
      // 1) 先发帖子卡片（报名→聊天带上下文）。发送队列按点击顺序发,文字一定排在它后面。
      if (pendingCard) {
        const card = track(
          startChatSend((onCreate) =>
            sendCardMessage({
              conversationId: conversationID,
              type: 'plaza-post-card',
              payload: pendingCard as unknown as Record<string, unknown>,
              onCreate,
            }),
          ),
        );
        if (!card.queued) await card.delivered;
        if (mountedRef.current) setPendingCard(null);
      }
      // 2) 再发文字（非空才发）。引用 > @提及 > 普通文本。
      if (nextText) {
        const activeMentionTargets = getMentionsPresentInText(nextText, mentionTargets);
        const message = track(
          startChatSend((onCreate) => {
            if (quoteTarget) {
              return sendQuoteMessage({
                conversationId: conversationID,
                text: nextText,
                quotedText: buildQuotePreviewText(quoteTarget, t),
                replyToId: isLocalMessageId(quoteTarget.id)
                  ? undefined
                  : quoteTarget.id,
                onCreate,
              });
            }
            if (isGroupChat && activeMentionTargets.length > 0) {
              return sendTextMessage({
                conversationId: conversationID,
                text: nextText,
                mentions: activeMentionTargets
                  .filter((m) => !m.isAll)
                  .map((m) => ({ userId: m.userID, nickname: m.nickname })),
                atAll: activeMentionTargets.some((m) => m.isAll),
                onCreate,
              });
            }
            return sendTextMessage({
              conversationId: conversationID,
              text: nextText,
              onCreate,
            });
          }),
        );
        if (!message.queued) await message.delivered;
      }
      clearPersistedDraft();
      if (mountedRef.current) setDraft('');
      if (mountedRef.current) setQuoteTarget(null);
      if (mountedRef.current) setMentionTargets([]);
      if (mountedRef.current) setMentionQuery(null);
      if (mountedRef.current) setMentionPickerVisible(false);
    } catch (error) {
      reportSendFailure(error);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  }, [
    clearPersistedDraft,
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
    inFlightRef,
    mountedRef,
    setDraft,
    setEditingMessageId,
    setMentionPickerVisible,
    setMentionQuery,
    setMentionTargets,
    setQuoteTarget,
    setSendError,
  ]);

  return {
    sending,
    pendingCard,
    setPendingCard,
    handleSend,
  };
}
