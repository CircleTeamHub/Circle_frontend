import { fetchChatHistoryPage, loadChatConversations } from '@/chat-core/api';
import { isMessageDeletedLocally } from '@/chat-core/deleted-messages';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { mapChatMessageDtoToUI } from '@/chat-core/message-mappers';
import { useChatStore } from '@/chat-core/store';
import { isEphemeralPeerMessage } from '@/features/chat/utils/ephemeral-message';
import { buildNoteCollectSource } from '@/features/chat/utils/message-collection';
import type { CollectNoteSource } from '@/features/notes/types';
import { useAuthStore } from '@/stores/authStore';

/** 路由只携带定位信息，来源名片从当前账号的聊天数据读取。 */
export async function resolveNoteCollectSource(
  noteId: string,
  conversationId?: string,
  messageId?: string,
  messageHeight?: string,
): Promise<CollectNoteSource | null> {
  const { user, sessionEpoch } = useAuthStore.getState();
  if (!user || !conversationId || !messageId || isLocalMessageId(messageId)) return null;
  const sameSession = () => useAuthStore.getState().sessionEpoch === sessionEpoch &&
    useChatStore.getState().currentUserId === user.id;
  if (!sameSession()) return null;

  let message = useChatStore.getState().messagesByConversation[conversationId]
    ?.find((item) => item.id === messageId);
  // 恢复路由后原消息可能不在内存窗口，用 height 精确取回，不灌入聊天时间线。
  const height = Number(messageHeight);
  const needsConversation = !useChatStore.getState().conversations.some((item) => item.id === conversationId);
  const needsMessage = !message && Number.isInteger(height) && height > 0 && height < 2_147_483_647;
  if (needsConversation || needsMessage) {
    // 两个受服务端鉴权保护的读取彼此独立，恢复来源时只等一次网络往返。
    const [, page] = await Promise.all([
      needsConversation ? loadChatConversations() : undefined,
      needsMessage ? fetchChatHistoryPage(conversationId, { beforeHeight: height + 1, limit: 1 }) : undefined,
    ]);
    if (!sameSession()) return null;
    message = useChatStore.getState().messagesByConversation[conversationId]?.find((item) => item.id === messageId)
      ?? page?.messages.find((item) => item.id === messageId)
      ?? message;
  }
  const conversation = useChatStore.getState().conversations
    .find((item) => item.id === conversationId);
  if (!conversation || !message || !message.sender || message.deleted || message.revokedAt ||
      message.conversationId !== conversationId || isMessageDeletedLocally(message.id, message.d)) return null;
  const uiMessage = mapChatMessageDtoToUI(message, user.id, 0);
  if (uiMessage.noteCard?.noteId !== noteId ||
      isEphemeralPeerMessage(uiMessage, (conversation.burnDurationSec ?? 0) > 0)) return null;
  const uiConversation = mapChatConversationToUI(conversation);
  return buildNoteCollectSource(uiMessage, {
    conversationID: conversationId,
    conversationTitle: uiConversation.name,
    sourceID: uiConversation.sourceID,
    conversationType: uiConversation.conversationType,
    conversationAvatarUrl: uiConversation.avatarUrl,
    currentUser: { id: user.id, name: user.nickname, faceURL: user.avatarUrl ?? undefined },
  });
}
