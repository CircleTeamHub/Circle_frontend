import { apiClient } from '@/services/api/client';

export type TempChatStatus = 'ACTIVE' | 'ENDED' | 'EXPIRED';

export type TempChatListRow = {
  id: string;
  groupId: string;
  title: string;
  status: TempChatStatus;
  guestCount: number;
  memberCount: number;
  maxMembers: number;
  expiresAt: string;
  createdAt: string;
  endedAt: string | null;
  shareUrl: string | null;
};

export type TempChatListItem = TempChatListRow & {
  isActive: boolean;
  isExpired: boolean;
};

export type CreateTempChatInput = {
  title?: string;
  ttlMinutes?: number;
  maxMembers?: number;
};

export type CreateTempChatResult = {
  id: string;
  groupId: string;
  title: string;
  maxMembers: number;
  expiresAt: string;
  shareUrl: string;
};

function normalizeTempChat(row: TempChatListRow): TempChatListItem {
  const expiresAtMs = Date.parse(row.expiresAt);
  const isExpired =
    row.status === 'EXPIRED' ||
    (row.status === 'ACTIVE' &&
      Number.isFinite(expiresAtMs) &&
      expiresAtMs <= Date.now());

  return {
    ...row,
    isActive: row.status === 'ACTIVE' && !isExpired,
    isExpired,
  };
}

/**
 * 列表里的 isActive 是抓取时刻按 Date.now() 算出来的快照；房间可能在用户停留期间过期。
 * 进群前用这个函数按当前时间重新判断，避免点开一个已经过期的临时群。
 */
export function isTempChatOpenable(
  room: Pick<TempChatListRow, 'status' | 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  if (room.status !== 'ACTIVE') return false;
  const expiresAtMs = Date.parse(room.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs > now;
}

export async function fetchMyTempChats(): Promise<TempChatListItem[]> {
  const rows = await apiClient<TempChatListRow[]>('/temp-chat/mine');
  return rows.map(normalizeTempChat);
}

export async function createTempChat(
  input: CreateTempChatInput = {},
): Promise<CreateTempChatResult> {
  return apiClient<CreateTempChatResult>('/temp-chat', {
    method: 'POST',
    body: input,
  });
}

export async function endTempChat(
  id: string,
): Promise<{ status: TempChatStatus }> {
  return apiClient<{ status: TempChatStatus }>(`/temp-chat/${id}/end`, {
    method: 'POST',
  });
}
