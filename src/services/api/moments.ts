import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import type {
  CreateMomentInput,
  MomentComment,
  MomentPost,
  PaginatedResponse,
} from '@/types';

function normalizeMoment(post: MomentPost): MomentPost {
  return {
    ...post,
    images: post.images.map((url) => (normalizeMediaUrl(url) as string) ?? url),
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
}): Promise<PaginatedResponse<MomentPost>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  const result = await apiClient<PaginatedResponse<MomentPost>>(
    `/trace/feed${qs ? `?${qs}` : ''}`,
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
