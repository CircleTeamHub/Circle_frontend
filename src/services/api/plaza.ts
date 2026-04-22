import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import type {
  CirclePlazaPost,
  CreatePlazaPostInput,
  PaginatedResponse,
} from '@/types';

function normalizePlazaPost(post: CirclePlazaPost): CirclePlazaPost {
  return {
    ...post,
    images: post.images.map((url) => (normalizeMediaUrl(url) as string) ?? url),
    author: {
      ...post.author,
      avatarUrl: post.author.avatarUrl
        ? normalizeMediaUrl(post.author.avatarUrl)
        : null,
      avatarFrame: post.author.avatarFrame
        ? normalizeMediaUrl(post.author.avatarFrame)
        : null,
    },
  };
}

export async function fetchPlazaFeed(params?: {
  circleId?: string;
  city?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<CirclePlazaPost>> {
  const query = new URLSearchParams();
  if (params?.circleId) query.set('circleId', params.circleId);
  if (params?.city) query.set('city', params.city);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  const result = await apiClient<PaginatedResponse<CirclePlazaPost>>(
    `/circle-plaza/feed${qs ? `?${qs}` : ''}`,
  );

  return {
    ...result,
    items: result.items.map(normalizePlazaPost),
  };
}

export async function createPlazaPost(
  input: CreatePlazaPostInput,
): Promise<CirclePlazaPost> {
  const post = await apiClient<CirclePlazaPost>('/circle-plaza/posts', {
    method: 'POST',
    body: input,
  });
  return normalizePlazaPost(post);
}

export async function deletePlazaPost(id: string): Promise<void> {
  await apiClient<void>(`/circle-plaza/posts/${id}`, { method: 'DELETE' });
}
