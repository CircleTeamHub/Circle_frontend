import { apiClient } from '@/services/api/client';
import {
  buildQuery,
  normalizeUserAvatarFrameAppearance,
  normalizeMediaUrl,
} from '@/services/api/utils';
import type {
  CreateMomentInput,
  MomentComment,
  MomentPost,
  PaginatedResponse,
  AvatarFrameAppearance,
} from '@/types';

type BackendMomentPost = Omit<MomentPost, 'author'> & {
  author: Omit<MomentPost['author'], 'avatarFrameAppearance'> & {
    avatarFrameAppearance?: AvatarFrameAppearance | null;
  };
};

export function normalizeMomentComment(comment: MomentComment): MomentComment {
  return {
    ...comment,
    images: comment.images?.map((url) => normalizeMediaUrl(url) ?? url),
    ignoredMentionCount:
      Number.isInteger(comment.ignoredMentionCount) &&
      comment.ignoredMentionCount >= 0
        ? comment.ignoredMentionCount
        : 0,
  };
}

function normalizeMoment(post: BackendMomentPost): MomentPost {
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
      avatarFrameAppearance: normalizeUserAvatarFrameAppearance(
        post.author.avatarFrameAppearance,
        post.author.vipLevel,
      ),
    },
    comments: post.comments.map(normalizeMomentComment),
  };
}

export async function fetchMomentsFeed(params?: {
  page?: number;
  limit?: number;
  cursor?: string;
}): Promise<PaginatedResponse<MomentPost>> {
  const result = await apiClient<PaginatedResponse<BackendMomentPost>>(
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
  const result = await apiClient<PaginatedResponse<BackendMomentPost>>(
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
  const result = await apiClient<BackendMomentPost>(`/trace/${id}`);
  return normalizeMoment(result);
}

export async function createMoment(
  input: CreateMomentInput,
): Promise<MomentPost> {
  const post = await apiClient<BackendMomentPost>('/trace', {
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
  input: {
    content: string;
    replyToId?: string;
    images?: string[];
    mentionedUserIds?: string[];
  },
): Promise<MomentComment> {
  const { mentionedUserIds, ...commentInput } = input;
  const comment = await apiClient<MomentComment>(`/trace/${traceId}/comment`, {
    method: 'POST',
    body: {
      ...commentInput,
      ...(mentionedUserIds?.length ? { mentionedUserIds } : {}),
    },
  });
  return normalizeMomentComment(comment);
}

export async function deleteMomentComment(
  commentId: string,
): Promise<void> {
  await apiClient<void>(`/trace/comment/${commentId}`, { method: 'DELETE' });
}
