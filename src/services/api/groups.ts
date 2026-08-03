import { apiClient } from './client';
import type { FriendReportCategory } from './friends';

export type GroupMemberSyncResult = {
  handled: boolean;
};

export type GroupMemberRole = 'ADMIN' | 'MEMBER';

export type GroupMemberRoleResult = {
  handled: true;
  role: GroupMemberRole;
};

export async function leaveGroup(groupID: string) {
  return apiClient<void>(`/group/${groupID}/leave`, {
    method: 'DELETE',
  });
}

export async function inviteGroupMembers(groupID: string, userIDs: string[]) {
  return apiClient<GroupMemberSyncResult>(`/group/${groupID}/members/invite`, {
    method: 'POST',
    body: { userIDs },
  });
}

export async function removeGroupMember(groupID: string, userID: string) {
  return apiClient<GroupMemberSyncResult>(`/group/${groupID}/members/${userID}`, {
    method: 'DELETE',
  });
}

export async function updateGroupMemberRole(groupID: string, userID: string, role: GroupMemberRole) {
  return apiClient<GroupMemberRoleResult>(`/group/${groupID}/members/${userID}/role`, {
    method: 'PATCH',
    body: { role },
  });
}

export async function reportGroup(
  groupID: string,
  payload: {
    category: FriendReportCategory;
    description: string;
    evidence?: string[];
  },
) {
  return apiClient<void>(`/group/${groupID}/report`, {
    method: 'POST',
    body: payload,
  });
}
