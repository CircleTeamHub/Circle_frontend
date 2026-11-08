import { ApiError, apiClient, isDefinitiveAuthFailure } from '@/services/api/client';
import {
  buildQuery,
  normalizeUserAvatarFrameAppearance,
  allowPeerMediaUrl,
} from '@/services/api/utils';
import { normalizeImageMedia } from './image-media';
import { useAuthStore } from '@/stores/authStore';
import { clearPageSnapshots, getPageSnapshotRevision, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import type {
  CreateMomentInput,
  MomentComment,
  MomentPost,
  PaginatedResponse,
  AvatarFrameAppearance,
  MomentAttachment,
} from '@/types';

type BackendMomentPost = Omit<MomentPost, 'author'> & {
  author: Omit<MomentPost['author'], 'avatarFrameAppearance'> & {
    avatarFrameAppearance?: AvatarFrameAppearance | null;
  };
};

let lastMomentMutationAt = 0;

async function markMomentWrite<T>(request: Promise<T>): Promise<T> {
  const { user, sessionEpoch } = useAuthStore.getState();
  const result = await request;
  lastMomentMutationAt = Date.now();
  if (user?.id && useAuthStore.getState().sessionEpoch === sessionEpoch) {
    clearPageSnapshots(user?.id, 'social:user-moments:');
    clearPageSnapshots(user?.id, 'social:moments-feed');
    clearPageSnapshots(user?.id, 'social:moment:');
  }
  return result;
}

export function momentsMutatedSince(since: number): boolean {
  return lastMomentMutationAt >= since;
}

export function normalizeMomentComment(comment: MomentComment): MomentComment {
  const normalizedMedia = normalizeImageMedia(
    comment.images,
    (comment as unknown as { media?: unknown }).media,
  );
  return {
    ...comment,
    images: normalizedMedia.images,
    ...(normalizedMedia.media.length > 0
      ? { media: normalizedMedia.media }
      : {}),
    ignoredMentionCount:
      Number.isInteger(comment.ignoredMentionCount) &&
      comment.ignoredMentionCount >= 0
        ? comment.ignoredMentionCount
        : 0,
  };
}

export function normalizeMoment(post: BackendMomentPost): MomentPost {
  const normalizedMedia = normalizeImageMedia(
    (post as unknown as { images?: unknown }).images,
    (post as unknown as { media?: unknown }).media,
  );
  const attachments = (Array.isArray(post.attachments) ? post.attachments : []).flatMap((item): MomentAttachment[] => {
    if (!item || (item.type !== 'image' && item.type !== 'video')) return [];
    const url = allowPeerMediaUrl(item.url);
    if (!url) return [];
    const posterUrl = allowPeerMediaUrl(item.posterUrl);
    return [{ ...item, url, posterUrl: posterUrl ?? undefined }];
  });
  return {
    ...post,
    // normalizeMediaUrl 返回 `string | null | undefined`；之前 `as string ?? url` 是骗类型系统，
    // null 也能命中 ?? 的 fallback，但 cast 谎报实际类型。直接用 ?? 即可，运行时行为不变。
    images: normalizedMedia.images,
    attachments,
    ...(normalizedMedia.media.length > 0
      ? { media: normalizedMedia.media }
      : {}),
    author: {
      ...post.author,
      avatarUrl: post.author.avatarUrl
        ? allowPeerMediaUrl(post.author.avatarUrl)
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
  const { user, sessionEpoch } = useAuthStore.getState();
  const revision = getPageSnapshotRevision();
  const at = Date.now();
  try {
    const result = normalizeMoment(await apiClient<BackendMomentPost>(`/trace/${id}`));
    if (useAuthStore.getState().sessionEpoch === sessionEpoch && revision === getPageSnapshotRevision() && !momentsMutatedSince(at)) writePageSnapshot(user?.id, `social:moment:${id}`, result, at);
    return result;
  } catch (error) {
    if (isDefinitiveAuthFailure(error) || (error instanceof ApiError && error.status === 404)) removePageSnapshot(user?.id, `social:moment:${id}`);
    throw error;
  }
}

export async function createMoment(
  input: CreateMomentInput,
  { idempotencyKey }: { idempotencyKey: string },
): Promise<MomentPost> {
  const post = await markMomentWrite(apiClient<BackendMomentPost>('/trace', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: input,
  }));
  return normalizeMoment(post);
}

export async function deleteMoment(id: string): Promise<void> {
  await markMomentWrite(apiClient<void>(`/trace/${id}`, { method: 'DELETE' }));
}

/** 设成指定状态(幂等):重发、乱序到达都不会把赞翻回去。旧的 POST 切换只留给老版本。 */
export async function setMomentLike(
  id: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  return markMomentWrite(apiClient<{ liked: boolean; likeCount: number }>(
    `/trace/${id}/like`,
    { method: 'PUT', body: { liked } },
  ));
}

export async function addMomentComment(
  traceId: string,
  input: {
    content: string;
    replyToId?: string;
    images?: string[];
    mentionedUserIds?: string[];
  },
  { idempotencyKey }: { idempotencyKey: string },
): Promise<MomentComment> {
  const { mentionedUserIds, ...commentInput } = input;
  const comment = await markMomentWrite(apiClient<MomentComment>(`/trace/${traceId}/comment`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      ...commentInput,
      ...(mentionedUserIds?.length ? { mentionedUserIds } : {}),
    },
  }));
  return normalizeMomentComment(comment);
}

export async function deleteMomentComment(
  commentId: string,
): Promise<void> {
  await markMomentWrite(apiClient<void>(`/trace/comment/${commentId}`, { method: 'DELETE' }));
}
