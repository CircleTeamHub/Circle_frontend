import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';

export type FriendProfile = {
  id: string;
  accountId: string;
  nickname: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
  gender: string;
  lastOnline: string | null;
  friendsSince: string;
};

export type FriendTag = {
  id: string;
  ownerID: string;
  name: string;
  color: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type FriendSettings = {
  remark: string | null;
  assignedTags: FriendTag[];
  availableTags: FriendTag[];
};

export type FriendStatus =
  | 'NONE'
  | 'PENDING_SENT'
  | 'PENDING_RECEIVED'
  | 'ACCEPTED'
  | 'BLOCKED';

export type FriendRequestState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type FriendActivityType =
  | 'REQUEST_RECEIVED'
  | 'REQUEST_SENT'
  | 'REQUEST_ACCEPTED_BY_OTHER'
  | 'REQUEST_REJECTED_BY_OTHER'
  | 'REQUEST_ACCEPTED_BY_ME'
  | 'REQUEST_REJECTED_BY_ME'
  | 'REQUEST_WITHDRAWN_BY_OTHER';

export type FriendActivityCounterparty = {
  id: string;
  accountId: string;
  nickname: string;
  avatarUrl: string | null;
};

export type FriendActivity = {
  id: string;
  type: FriendActivityType;
  requestId: string;
  requestState: FriendRequestState;
  messageSnapshot: string | null;
  readAt: string | null;
  createdAt: string;
  counterparty: FriendActivityCounterparty;
};

type FriendStatusResponse = {
  status: FriendStatus;
  requestId: string | null;
};

export type CreateFriendRequestInput = {
  targetId: string;
  message?: string;
  remark?: string;
  tagIds?: string[];
};

type CreateFriendRequestBody = {
  targetId: string;
  message?: string;
  remark?: string;
  tagIds?: string[];
};

function normalizeFriendProfile(friend: FriendProfile): FriendProfile {
  return {
    ...friend,
    avatarUrl: normalizeMediaUrl(friend.avatarUrl),
    avatarFrame: normalizeMediaUrl(friend.avatarFrame),
  };
}

function normalizeFriendActivity(activity: FriendActivity): FriendActivity {
  return {
    ...activity,
    counterparty: {
      ...activity.counterparty,
      avatarUrl: normalizeMediaUrl(activity.counterparty.avatarUrl),
    },
  };
}

function normalizeFriendRequestText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildCreateFriendRequestBody(
  input: CreateFriendRequestInput,
): CreateFriendRequestBody {
  const message = normalizeFriendRequestText(input.message);
  const remark = normalizeFriendRequestText(input.remark);
  const tagIds = input.tagIds?.map((tagId) => tagId.trim()).filter(Boolean);

  return {
    targetId: input.targetId,
    ...(message ? { message } : {}),
    ...(remark ? { remark } : {}),
    ...(tagIds && tagIds.length > 0 ? { tagIds } : {}),
  };
}

export async function fetchFriends() {
  const friends = await apiClient<FriendProfile[]>('/friend');
  return friends.map(normalizeFriendProfile);
}

export async function fetchFriendTags() {
  return apiClient<FriendTag[]>('/friend/tags');
}

export async function createFriendTag(name: string, color?: string | null) {
  return apiClient<FriendTag>('/friend/tags', {
    method: 'POST',
    body: {
      name: name.trim(),
      ...(color ? { color } : {}),
    },
  });
}

export async function fetchFriendsByTag(tagId: string) {
  const friends = await apiClient<FriendProfile[]>(`/friend/tags/${tagId}/friends`);
  return friends.map(normalizeFriendProfile);
}

export async function fetchFriendStatus(targetId: string) {
  return apiClient<FriendStatusResponse>(`/friend/status/${targetId}`);
}

export async function fetchFriendSettings(friendUserId: string) {
  return apiClient<FriendSettings>(`/friend/${friendUserId}/settings`);
}

export async function addFriendToBlacklist(friendUserId: string) {
  return apiClient<void>('/friend/block', {
    method: 'POST',
    body: { targetId: friendUserId },
  });
}

export async function removeFriendFromBlacklist(friendUserId: string) {
  return apiClient<void>(`/friend/block/${friendUserId}`, {
    method: 'DELETE',
  });
}

export async function deleteFriendRelationship(friendUserId: string) {
  return apiClient<void>(`/friend/${friendUserId}`, {
    method: 'DELETE',
  });
}

export async function setFriendRemark(
  friendUserId: string,
  remark: string | null,
) {
  return apiClient<void>(`/friend/${friendUserId}/remark`, {
    method: 'PATCH',
    body: {
      remark: remark?.trim() ? remark.trim() : null,
    },
  });
}

export async function assignFriendTag(friendUserId: string, tagId: string) {
  return apiClient<void>(`/friend/${friendUserId}/tags`, {
    method: 'POST',
    body: { tagId },
  });
}

export async function removeFriendTag(friendUserId: string, tagId: string) {
  return apiClient<void>(`/friend/${friendUserId}/tags/${tagId}`, {
    method: 'DELETE',
  });
}

export function createFriendRequest(input: CreateFriendRequestInput): Promise<void>;
export function createFriendRequest(
  targetId: string,
  message?: string,
): Promise<void>;
export async function createFriendRequest(
  inputOrTargetId: CreateFriendRequestInput | string,
  message?: string,
) {
  const input =
    typeof inputOrTargetId === 'string'
      ? { targetId: inputOrTargetId, ...(message ? { message } : {}) }
      : inputOrTargetId;

  return apiClient<void>('/friend/requests', {
    method: 'POST',
    body: buildCreateFriendRequestBody(input),
  });
}

export async function fetchFriendActivities() {
  const activities = await apiClient<FriendActivity[]>('/friend/activities');
  return activities.map(normalizeFriendActivity);
}

export async function fetchUnreadFriendActivityCount() {
  const response = await apiClient<{ count: number }>(
    '/friend/activities/unread-count',
  );
  return response.count;
}

export async function fetchFriendActivityDetail(activityId: string) {
  const activity = await apiClient<FriendActivity>(
    `/friend/activities/${activityId}`,
  );
  return normalizeFriendActivity(activity);
}

export async function markFriendActivityRead(activityId: string) {
  return apiClient<void>(`/friend/activities/${activityId}/read`, {
    method: 'POST',
  });
}

export async function acceptFriendRequest(requestId: string) {
  return apiClient<void>(`/friend/requests/${requestId}/accept`, {
    method: 'POST',
  });
}

export async function rejectFriendRequest(requestId: string) {
  return apiClient<void>(`/friend/requests/${requestId}/reject`, {
    method: 'POST',
  });
}

export async function cancelFriendRequest(requestId: string) {
  return apiClient<void>(`/friend/requests/${requestId}`, {
    method: 'DELETE',
  });
}

export const FRIEND_REPORT_CATEGORIES = [
  'harassment',
  'spam',
  'impersonation',
  'fraud',
  'other',
] as const;
export type FriendReportCategory = (typeof FRIEND_REPORT_CATEGORIES)[number];

export async function reportFriend(
  friendUserId: string,
  payload: {
    category: FriendReportCategory;
    description: string;
    evidence?: string[];
  },
) {
  return apiClient<void>(`/friend/${friendUserId}/report`, {
    method: 'POST',
    body: payload,
  });
}
