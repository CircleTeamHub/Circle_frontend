import { toImUserId } from '@/im/client';
import type { FriendProfile } from '@/services/api/friends';

export type CircleInviteSelection = Record<string, true>;

export function buildExistingCircleMemberIds(
  members: readonly { userID?: string | null }[],
) {
  return new Set(
    members
      .map((member) => member.userID)
      .filter((userID): userID is string => Boolean(userID))
      .map(toImUserId),
  );
}

export function filterInvitableCircleFriends(
  friends: readonly FriendProfile[],
  existingMemberIDs: ReadonlySet<string>,
) {
  if (existingMemberIDs.size < 1) {
    return [...friends];
  }

  return friends.filter((friend) => !existingMemberIDs.has(toImUserId(friend.id)));
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
    if (existingMemberIDs.has(toImUserId(friendId))) {
      changed = true;
      continue;
    }
    if (value) {
      nextSelected[friendId] = true;
    }
  }

  return changed ? nextSelected : selected;
}
