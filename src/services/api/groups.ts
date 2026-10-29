import { apiClient } from './client';
import { expectShape, isPlainObject } from '@/utils/validate';
import type { FriendReportCategory } from './friends';

export type GroupMemberSyncResult = {
  handled: boolean;
};

export type GroupMemberRole = 'ADMIN' | 'MEMBER';

export type GroupMemberRoleResult = {
  handled: true;
  role: GroupMemberRole;
};

function isGroupMemberSyncResult(value: unknown): value is GroupMemberSyncResult {
  return isPlainObject(value) && typeof value.handled === 'boolean';
}

function isGroupMemberRoleResult(value: unknown): value is GroupMemberRoleResult {
  return (
    isPlainObject(value) &&
    value.handled === true &&
    (value.role === 'ADMIN' || value.role === 'MEMBER')
  );
}

export async function leaveGroup(groupID: string) {
  return apiClient<void>(`/group/${groupID}/leave`, {
    method: 'DELETE',
  });
}

export async function inviteGroupMembers(groupID: string, userIDs: string[]) {
  const raw = await apiClient<unknown>(`/group/${groupID}/members/invite`, {
    method: 'POST',
    body: { userIDs },
  });
  return expectShape(raw, isGroupMemberSyncResult, '群成员操作结果格式异常');
}

export async function removeGroupMember(groupID: string, userID: string) {
  const raw = await apiClient<unknown>(`/group/${groupID}/members/${userID}`, {
    method: 'DELETE',
  });
  return expectShape(raw, isGroupMemberSyncResult, '群成员操作结果格式异常');
}

export async function updateGroupMemberRole(groupID: string, userID: string, role: GroupMemberRole) {
  const raw = await apiClient<unknown>(`/group/${groupID}/members/${userID}/role`, {
    method: 'PATCH',
    body: { role },
  });
  return expectShape(raw, isGroupMemberRoleResult, '群成员角色结果格式异常');
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
