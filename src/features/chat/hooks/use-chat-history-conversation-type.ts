import { useChatStore } from '@/chat-core/store';

/**
 * 从聊天记录各页回到聊天页时的会话类型。
 *
 * 这些页面的路由参数里没有会话类型,getChatDetailHref 默认按单聊打开:群聊的搜索
 * 结果点进去就成了单聊界面(没有发送者名字、没有 @,已读回执拿群 id 当对端去查)。
 * 按会话缓存判断 —— 能打开聊天记录的会话一定在缓存里;群聊、临时群都按群打开。
 */
export function useChatHistoryConversationType(
  conversationID: string,
): 'private' | 'group' {
  return useChatStore((state) => {
    const type = state.conversations.find((conversation) => conversation.id === conversationID)?.type;
    return type === 'GROUP' || type === 'TEMP' ? 'group' : 'private';
  });
}
