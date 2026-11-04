import { apiClient } from '@/services/api/client';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { isChatMessageDto, type ChatMessageDto } from '@/chat-core/protocol';

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

export async function fetchCollections(type?: CollectionType) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  const items = await apiClient<(Omit<UserCollection, 'message'> & { message?: unknown })[]>(`/collections${qs}`);
  return items.map((item): UserCollection => {
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
}

export async function createCollection(input: CreateCollectionInput) {
  return apiClient<UserCollection>('/collections', {
    method: 'POST',
    body: input,
  });
}

export async function deleteCollection(id: string) {
  return apiClient<void>(`/collections/${id}`, { method: 'DELETE' });
}
