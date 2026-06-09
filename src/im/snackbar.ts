/**
 * im/snackbar.ts — pure helpers for turning an inbound OpenIM message into a
 * chat-snackbar payload. Kept free of React / SDK-runtime imports so it can be
 * unit-tested directly.
 */
import type { ConversationItem, MessageItem } from '@openim/rn-client-sdk';
import { fromImUserId } from '@/im/client';
import type { ChatSnackbarItem } from '@/features/notifications/store/use-notification-snackbar-store';

export type ChatSnackbarFallbacks = {
  /** Title to use when neither the conversation nor the message names the peer. */
  title: string;
  /** Preview to use for non-text messages (images, files, …). */
  preview: string;
};

export type ChatSnackbarPayload = Omit<ChatSnackbarItem, 'kind'>;

/**
 * Build the snackbar payload for an inbound message, or `null` when it should
 * not be shown (own message, group without a synced conversation, missing
 * routing target).
 *
 * Group banners deliberately require a synced conversation: without it we have
 * no reliable group name, and falling back to the sender's nickname would
 * mislead the user into thinking it is a 1:1 chat. Single chats can safely fall
 * back to the sender's own fields, which is the important case (the first
 * message from a brand-new contact).
 */
export function buildChatSnackbar(
  message: MessageItem,
  conversations: ConversationItem[],
  currentUserID: string | null,
  isGroup: boolean,
  fallbacks: ChatSnackbarFallbacks,
): ChatSnackbarPayload | null {
  if (message.sendID === currentUserID) {
    return null;
  }

  const conversation = conversations.find((item) =>
    isGroup
      ? item.groupID === message.groupID
      : // sendID is guaranteed not to be the current user (early-returned
        // above), so the peer is always the sender for inbound single chats.
        item.userID === message.sendID,
  );

  if (isGroup && !conversation?.conversationID) {
    return null;
  }

  // sourceID is what ChatDetailScreen uses to resolve/open the chat.
  const sourceID = isGroup ? message.groupID : fromImUserId(message.sendID);
  if (!sourceID) {
    return null;
  }

  const hasTextContent =
    typeof message.content === 'string' && message.content.trim().length > 0;

  return {
    id: message.clientMsgID,
    title:
      conversation?.showName || message.senderNickname || fallbacks.title,
    summary: hasTextContent ? message.content : fallbacks.preview,
    avatarUrl: conversation?.faceURL || message.senderFaceUrl || null,
    // Empty when the conversation isn't synced yet; ChatDetailScreen resolves
    // it from sourceID on open.
    conversationID: conversation?.conversationID ?? '',
    sourceID,
    conversationType: isGroup ? 'group' : 'private',
  };
}
