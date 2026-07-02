import type { Conversation } from '@/types';

export type LocalUnreadOverrides = Record<string, boolean>;

export type ConversationWithLocalUnread = Conversation & {
  localUnread?: boolean;
};

export function setLocalUnreadOverride(
  overrides: LocalUnreadOverrides,
  conversationID: string,
): LocalUnreadOverrides {
  if (!conversationID) return overrides;
  return { ...overrides, [conversationID]: true };
}

export function clearLocalUnreadOverride(
  overrides: LocalUnreadOverrides,
  conversationID: string,
): LocalUnreadOverrides {
  if (!conversationID || !overrides[conversationID]) return overrides;
  const next = { ...overrides };
  delete next[conversationID];
  return next;
}

export function applyLocalUnreadOverrides<T extends Conversation>(
  conversations: T[],
  overrides: LocalUnreadOverrides,
): (T & ConversationWithLocalUnread)[] {
  return conversations.map((conversation) => {
    const localUnread = overrides[conversation.id] === true;
    if (!localUnread) return conversation;
    return {
      ...conversation,
      localUnread,
      unreadCount:
        conversation.unreadCount > 0 ? conversation.unreadCount : 1,
    };
  });
}

export function countLocalUnreadOverrides(
  conversations: Pick<Conversation, 'id' | 'unreadCount'>[],
  overrides: LocalUnreadOverrides,
) {
  const byID = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  let count = 0;
  for (const [conversationID, active] of Object.entries(overrides)) {
    if (!active) continue;
    const conversation = byID.get(conversationID);
    if (conversation && conversation.unreadCount <= 0) {
      count += 1;
    }
  }
  return count;
}
