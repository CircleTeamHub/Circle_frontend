import type { ChatConversationDto } from '@/chat-core/protocol';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import type { FriendProfile } from '@/services/api/friends';

/**
 * 「选择一个聊天」里的一个发送对象。通讯录里还没聊过天的好友没有会话 id,
 * 真正发送前用 resolveChatTargetConversationId 取或建单聊。
 */
export interface ChatTarget {
  /** 去重用:有会话的按会话 id,通讯录好友按 user:<id>。 */
  key: string;
  conversationId: string | null;
  userId: string | null;
  name: string;
  avatarUrl?: string;
  kind: 'direct' | 'group' | 'temp';
}

export function targetFromConversation(dto: ChatConversationDto): ChatTarget {
  const ui = mapChatConversationToUI(dto);
  return {
    key: dto.id,
    conversationId: dto.id,
    userId: dto.type === 'DIRECT' ? dto.peer?.id ?? null : null,
    name: ui.name,
    avatarUrl: ui.avatarUrl,
    kind: dto.type === 'GROUP' ? 'group' : dto.type === 'TEMP' ? 'temp' : 'direct',
  };
}

export function targetFromFriend(
  friend: FriendProfile,
  directConversationId: string | null,
): ChatTarget {
  return {
    key: directConversationId ?? `user:${friend.id}`,
    conversationId: directConversationId,
    userId: friend.id,
    name: friend.remark?.trim() || friend.nickname,
    avatarUrl: friend.avatarUrl ?? undefined,
    kind: 'direct',
  };
}

/** 能当发送对象的会话:私聊、群聊、临时会话;AI 小助手等系统会话不算。 */
export function isSendableConversation(dto: ChatConversationDto): boolean {
  return dto.type === 'DIRECT' || dto.type === 'GROUP' || dto.type === 'TEMP';
}
