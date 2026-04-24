import { apiClient } from '@/services/api/client';

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
  return apiClient<UserCollection[]>(`/collections${qs}`);
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
