import type { ChatMessage } from '@/types';

// Native delivery can lag the local best-effort insert. Five minutes covers
// normal SDK/network delay without collapsing a later unfriend/re-add event.
export const FRIEND_ADDED_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export function collapseDuplicateFriendAddedNotices(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const unmatched = {
    native: [] as number[],
    local: [] as number[],
  };

  return messages.filter((message) => {
    const source = message.systemNoticeSource;
    const timestamp = message.systemNoticeTimestamp;
    if (
      message.systemNoticeKind !== 'friend-added' ||
      (source !== 'native' && source !== 'local') ||
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp)
    ) {
      return true;
    }

    const opposite = source === 'native' ? 'local' : 'native';
    const matchIndex = unmatched[opposite].findIndex(
      (candidateTimestamp) =>
        Math.abs(candidateTimestamp - timestamp) <=
        FRIEND_ADDED_DEDUPE_WINDOW_MS,
    );
    if (matchIndex !== -1) {
      unmatched[opposite].splice(matchIndex, 1);
      return false;
    }

    unmatched[source].push(timestamp);
    return true;
  });
}
