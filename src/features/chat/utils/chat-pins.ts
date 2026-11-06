import type { ChatConversationDto } from '@/chat-core/protocol';

/** 谁能置顶 / 取消置顶:私聊双方都能;群里只有群主和管理员。服务端同一口径。 */
export function canManageChatPins(
  conversation: Pick<ChatConversationDto, 'type' | 'myRole'>,
): boolean {
  if (conversation.type === 'DIRECT') return true;
  if (conversation.type !== 'GROUP') return false;
  return conversation.myRole === 'OWNER' || conversation.myRole === 'ADMIN';
}
