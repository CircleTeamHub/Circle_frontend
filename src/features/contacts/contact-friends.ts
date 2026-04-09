import type { FriendProfile, FriendTag } from '@/services/api/friends';

export type ContactFriendSection = {
  title: string;
  data: FriendProfile[];
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function getFriendDisplayName(friend: Pick<FriendProfile, 'nickname' | 'accountId'>) {
  const nickname = friend.nickname?.trim();
  return nickname || friend.accountId;
}

function getAlphaInitial(value: string) {
  const initial = value.trim().charAt(0).toUpperCase();
  return LETTERS.includes(initial) ? initial : null;
}

export function getFriendSortKey(friend: Pick<FriendProfile, 'nickname' | 'accountId'>) {
  const displayName = getFriendDisplayName(friend);
  return getAlphaInitial(displayName) ? displayName : friend.accountId;
}

export function getFriendSectionTitle(friend: Pick<FriendProfile, 'nickname' | 'accountId'>) {
  return getAlphaInitial(getFriendSortKey(friend)) ?? '#';
}

function compareFriends(left: FriendProfile, right: FriendProfile) {
  return getFriendSortKey(left)
    .localeCompare(getFriendSortKey(right), 'en', { sensitivity: 'base' });
}

export function buildRecentFriends(friends: FriendProfile[]) {
  return [...friends].sort(
    (left, right) =>
      new Date(right.friendsSince).getTime() - new Date(left.friendsSince).getTime(),
  );
}

export function buildContactSections(friends: FriendProfile[]): ContactFriendSection[] {
  const grouped = new Map<string, FriendProfile[]>();

  for (const friend of [...friends].sort(compareFriends)) {
    const title = getFriendSectionTitle(friend);
    const bucket = grouped.get(title);

    if (bucket) {
      bucket.push(friend);
      continue;
    }

    grouped.set(title, [friend]);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      if (left === '#') {
        return 1;
      }

      if (right === '#') {
        return -1;
      }

      return left.localeCompare(right, 'en', { sensitivity: 'base' });
    })
    .map(([title, data]) => ({ title, data }));
}

export function sortFriendTags(tags: FriendTag[]) {
  return [...tags].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }),
  );
}
