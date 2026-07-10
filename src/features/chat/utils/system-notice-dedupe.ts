import type { ChatMessage } from '@/types';

export function collapseDuplicateFriendAddedNotices(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  let seenFriendAdded = false;

  return messages.filter((message) => {
    if (message.systemNoticeKind !== 'friend-added') return true;
    if (seenFriendAdded) return false;
    seenFriendAdded = true;
    return true;
  });
}
