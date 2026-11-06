import { ensureDirectConversation } from '@/chat-core/client';
import type { ChatTarget } from './types';

/** 发送前把对象落到会话 id:通讯录里还没聊过天的好友先取或建单聊。 */
export async function resolveChatTargetConversationId(target: ChatTarget): Promise<string> {
  if (target.conversationId) return target.conversationId;
  if (!target.userId) throw new Error('Chat target has neither a conversation nor a user');
  const { conversationID } = await ensureDirectConversation(target.userId);
  return conversationID;
}
