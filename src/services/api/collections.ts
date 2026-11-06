import { apiClient, ApiError } from '@/services/api/client';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { isChatMessageDto, type ChatMessageDto } from '@/chat-core/protocol';
import { useAuthStore } from '@/stores/authStore';
import { getPageSnapshotRevision, removePageSnapshot } from '@/storage/page-snapshots';

export type CollectionType = 'CHAT' | 'VIDEO' | 'VOICE' | 'MESSAGE' | 'NOTE';

export type UserCollection = {
  id: string;
  userID: string;
  type: CollectionType;
  title: string;
  summary: string | null;
  sourceID: string | null;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  /** null means the source is unavailable; absent means an older server. */
  message?: ChatMessageDto | null;
};

export type CreateCollectionInput = {
  type: CollectionType;
  title: string;
  summary?: string;
  sourceID?: string;
  payload?: Record<string, unknown>;
};

// One session's full list, in memory only. Sending still calls the live fetch below.
let snapshot: { userID: string; epoch: number; revision: number; startedAt: number; items: UserCollection[] } | null = null;
let mutationVersion = 0;
let lastMutationAt = 0;

export function getCachedCollections() {
  const { user, sessionEpoch } = useAuthStore.getState();
  return snapshot?.userID === user?.id && snapshot?.epoch === sessionEpoch && snapshot?.revision === getPageSnapshotRevision() ? snapshot : null;
}

export function collectionsMutatedSince(since: number) {
  return lastMutationAt >= since;
}

async function markCollectionWrite<T>(request: Promise<T>) {
  const { user, sessionEpoch } = useAuthStore.getState();
  const result = await request;
  mutationVersion += 1;
  lastMutationAt = Date.now();
  snapshot = null;
  if (useAuthStore.getState().sessionEpoch === sessionEpoch) removePageSnapshot(user?.id, 'collections');
  return result;
}

export async function fetchCollections(type?: CollectionType) {
  const { user, sessionEpoch } = useAuthStore.getState();
  const version = mutationVersion;
  const revision = getPageSnapshotRevision();
  const startedAt = Date.now();
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  const items = await apiClient<(Omit<UserCollection, 'message'> & { message?: unknown })[]>(`/collections${qs}`).catch((error) => {
    if (useAuthStore.getState().sessionEpoch === sessionEpoch && error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      snapshot = null;
      removePageSnapshot(user?.id, 'collections');
    }
    throw error;
  });
  const normalized = items.map((item): UserCollection => {
    if (item.message === undefined) return { ...item, message: undefined };
    if (!isChatMessageDto(item.message) || item.message.deleted || item.message.revokedAt) {
      return { ...item, message: null };
    }
    const content = { ...item.message.content };
    // Server sources never use another device's local preview path.
    delete content.localUri;
    for (const field of ['url', 'thumbUrl']) {
      const value = content[field];
      const url = allowPeerMediaUrl(typeof value === 'string' ? value : undefined);
      if (url) content[field] = url;
      else delete content[field];
    }
    return { ...item, message: {
      ...item.message,
      content,
      sender: item.message.sender ? {
        ...item.message.sender,
        avatarUrl: allowPeerMediaUrl(item.message.sender.avatarUrl),
      } : null,
    } };
  });
  if (!type && user?.id && useAuthStore.getState().sessionEpoch === sessionEpoch && version === mutationVersion && revision === getPageSnapshotRevision()) {
    snapshot = { userID: user.id, epoch: sessionEpoch, revision, startedAt, items: normalized };
  }
  return normalized;
}

export async function createCollection(input: CreateCollectionInput) {
  return markCollectionWrite(apiClient<UserCollection>('/collections', {
    method: 'POST',
    body: input,
  }));
}

export async function deleteCollection(id: string) {
  return markCollectionWrite(apiClient<void>(`/collections/${id}`, { method: 'DELETE' }));
}
