import type { FriendProfile } from '@/services/api/friends';

export type CircleInviteSelection = Record<string, true>;

// chat-core 成员 userId 与好友 id 同为 UUID 形式,集合可直接比较,
// 不再需要 OpenIM 的去连字符转换。
export function buildExistingCircleMemberIds(
  members: readonly { userId?: string | null }[],
) {
  return new Set(
    members
      .map((member) => member.userId)
      .filter((userId): userId is string => Boolean(userId)),
  );
}

export function filterInvitableCircleFriends(
  friends: readonly FriendProfile[],
  existingMemberIDs: ReadonlySet<string>,
) {
  if (existingMemberIDs.size < 1) {
    return [...friends];
  }

  return friends.filter((friend) => !existingMemberIDs.has(friend.id));
}

export function pruneSelectedCircleInvitees(
  selected: CircleInviteSelection,
  existingMemberIDs: ReadonlySet<string>,
): CircleInviteSelection {
  if (existingMemberIDs.size < 1) {
    return selected;
  }

  let changed = false;
  const nextSelected: CircleInviteSelection = {};

  for (const [friendId, value] of Object.entries(selected)) {
    if (existingMemberIDs.has(friendId)) {
      changed = true;
      continue;
    }
    if (value) {
      nextSelected[friendId] = true;
    }
  }

  return changed ? nextSelected : selected;
}
