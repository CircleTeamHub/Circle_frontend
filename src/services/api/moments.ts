import { apiClient } from '@/services/api/client';
import { buildQuery, normalizeMediaUrl } from '@/services/api/utils';
import type {
  CreateMomentInput,
  MomentComment,
  MomentPost,
  PaginatedResponse,
} from '@/types';

function normalizeMoment(post: MomentPost): MomentPost {
  return {
    ...post,
    // normalizeMediaUrl 返回 `string | null | undefined`；之前 `as string ?? url` 是骗类型系统，
    // null 也能命中 ?? 的 fallback，但 cast 谎报实际类型。直接用 ?? 即可，运行时行为不变。
    images: post.images.map((url) => normalizeMediaUrl(url) ?? url),
    author: {
      ...post.author,
      avatarUrl: post.author.avatarUrl
        ? normalizeMediaUrl(post.author.avatarUrl)
        : null,
    },
  };
}

export async function fetchMomentsFeed(params?: {
  page?: number;
  limit?: number;
  cursor?: string;
}): Promise<PaginatedResponse<MomentPost>> {
  const result = await apiClient<PaginatedResponse<MomentPost>>(
    `/trace/feed${buildQuery(params ?? {})}`,
  );

  return {
    ...result,
    items: result.items.map(normalizeMoment),
  };
}

export async function fetchUserMoments(
  userId: string,
  params?: { page?: number; limit?: number; cursor?: string },
): Promise<PaginatedResponse<MomentPost>> {
  const result = await apiClient<PaginatedResponse<MomentPost>>(
    `/trace/feed${buildQuery({ ...(params ?? {}), authorId: userId })}`,
  );

  return {
    ...result,
    items: result.items.map(normalizeMoment),
  };
}

export async function fetchNewMomentsCount(since: string): Promise<number> {
  const result = await apiClient<number>(
    `/trace/feed/new-count?since=${encodeURIComponent(since)}`,
  );
  return result;
}

export async function fetchMomentById(id: string): Promise<MomentPost> {
  const result = await apiClient<MomentPost>(`/trace/${id}`);
  return normalizeMoment(result);
}

export async function createMoment(
  input: CreateMomentInput,
): Promise<MomentPost> {
  const post = await apiClient<MomentPost>('/trace', {
    method: 'POST',
    body: input,
  });
  return normalizeMoment(post);
}

export async function deleteMoment(id: string): Promise<void> {
  await apiClient<void>(`/trace/${id}`, { method: 'DELETE' });
}

export async function toggleMomentLike(
  id: string,
): Promise<{ liked: boolean; likeCount: number }> {
  return apiClient<{ liked: boolean; likeCount: number }>(
    `/trace/${id}/like`,
    { method: 'POST' },
  );
}

export async function addMomentComment(
  traceId: string,
  input: { content: string; replyToId?: string },
): Promise<MomentComment> {
  return apiClient<MomentComment>(`/trace/${traceId}/comment`, {
    method: 'POST',
    body: input,
  });
}

export async function deleteMomentComment(
  commentId: string,
): Promise<void> {
  await apiClient<void>(`/trace/comment/${commentId}`, { method: 'DELETE' });
}
