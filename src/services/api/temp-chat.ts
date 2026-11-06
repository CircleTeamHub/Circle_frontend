import { apiClient, isDefinitiveAuthFailure } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { getPageSnapshotRevision, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';

let tempChatMutationVersion = 0;

export type TempChatStatus = 'ACTIVE' | 'ENDED' | 'EXPIRED';

export type TempChatListRow = {
  id: string;
  groupId: string;
  /** 自研会话 id;旧 OpenIM 时代房间为 null(不可再进入)。 */
  conversationId: string | null;
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
  conversationId: string;
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
  const { user, sessionEpoch } = useAuthStore.getState();
  const revision = getPageSnapshotRevision();
  const mutationVersion = tempChatMutationVersion;
  const startedAt = Date.now();
  const rows = await apiClient<TempChatListRow[]>('/temp-chat/mine').catch((error) => {
    if (isDefinitiveAuthFailure(error)) removePageSnapshot(user?.id, 'temp-chats');
    throw error;
  });
  const rooms = rows.map(normalizeTempChat);
  if (useAuthStore.getState().sessionEpoch === sessionEpoch && revision === getPageSnapshotRevision() &&
    mutationVersion === tempChatMutationVersion) {
    writePageSnapshot(user?.id, 'temp-chats', rooms.map((room) => ({ ...room, shareUrl: null })), startedAt);
  }
  return rooms;
}

export class TempChatUnavailableError extends Error {
  constructor() {
    super('Temp chat is no longer active');
    this.name = 'TempChatUnavailableError';
  }
}

/**
 * 媒体上传前的临时房活性闸。
 *
 * socket 最终仍会在落库时校验房间状态，但若等上传完才发现房间已结束，原图与
 * 缩略图会变成无人引用的孤儿对象。这里只用于昂贵的媒体路径，文本/位置仍以
 * socket 的原子校验为准。
 */
export async function assertMyTempChatConversationOpen(
  conversationId: string,
): Promise<void> {
  const rooms = await fetchMyTempChats();
  const room = rooms.find((candidate) => candidate.conversationId === conversationId);
  if (!room || !isTempChatOpenable(room)) {
    throw new TempChatUnavailableError();
  }
}

export async function createTempChat(
  input: CreateTempChatInput = {},
): Promise<CreateTempChatResult> {
  const ownerId = useAuthStore.getState().user?.id;
  const result = await apiClient<CreateTempChatResult>('/temp-chat', {
    method: 'POST',
    body: input,
  });
  tempChatMutationVersion += 1;
  removePageSnapshot(ownerId, 'temp-chats');
  return result;
}

/**
 * 删除自己建的房间。进行中的会先被结束(访客移出、链接失效),房主这边的会话
 * 也一并移除;已经删过的再删照样成功(204)。
 */
export async function deleteTempChat(id: string): Promise<void> {
  const ownerId = useAuthStore.getState().user?.id;
  await apiClient<void>(`/temp-chat/${id}`, { method: 'DELETE' });
  tempChatMutationVersion += 1;
  removePageSnapshot(ownerId, 'temp-chats');
}

export async function endTempChat(
  id: string,
): Promise<{ status: TempChatStatus }> {
  const ownerId = useAuthStore.getState().user?.id;
  const result = await apiClient<{ status: TempChatStatus }>(`/temp-chat/${id}/end`, {
    method: 'POST',
  });
  tempChatMutationVersion += 1;
  removePageSnapshot(ownerId, 'temp-chats');
  return result;
}
