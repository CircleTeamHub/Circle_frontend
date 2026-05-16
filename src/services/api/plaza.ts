import { apiClient } from '@/services/api/client';
import { buildQuery, normalizeMediaUrl } from '@/services/api/utils';
import type {
  CirclePlazaPost,
  CreatePlazaPostInput,
  PaginatedResponse,
} from '@/types';

function normalizePlazaPost(post: CirclePlazaPost): CirclePlazaPost {
  return {
    ...post,
    // 同 moments.ts 注释：normalizeMediaUrl 是 nullable，?? 接住 fallback；as string 是骗 TS。
    images: post.images.map((url) => normalizeMediaUrl(url) ?? url),
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
  const result = await apiClient<PaginatedResponse<CirclePlazaPost>>(
    `/circle-plaza/feed${buildQuery(params ?? {})}`,
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
