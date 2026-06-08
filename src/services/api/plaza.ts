import { apiClient } from '@/services/api/client';
import { buildQuery, normalizeMediaUrl } from '@/services/api/utils';
import type {
  CirclePlazaPost,
  CreatePlazaPostInput,
  MyCirclePost,
  PaginatedResponse,
  PostSignupItem,
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

export async function signupForPost(
  id: string,
): Promise<{ signed: boolean; signupCount: number }> {
  return apiClient<{ signed: boolean; signupCount: number }>(
    `/circle-plaza/posts/${id}/signup`,
    { method: 'POST' },
  );
}

export async function cancelSignup(
  id: string,
): Promise<{ signed: boolean; signupCount: number }> {
  return apiClient<{ signed: boolean; signupCount: number }>(
    `/circle-plaza/posts/${id}/signup`,
    { method: 'DELETE' },
  );
}

// ── Signup management (报名管理) ──────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function booleanField(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMyPost(post: unknown): MyCirclePost {
  const p = asRecord(post);
  const firstImage = stringField(p.firstImage) || null;
  return {
    id: stringField(p.id),
    circleId: stringField(p.circleId),
    excerpt: stringField(p.excerpt),
    firstImage: firstImage
      ? (normalizeMediaUrl(firstImage) ?? firstImage)
      : null,
    signupCount: numberField(p.signupCount),
    unreadSignupCount: numberField(p.unreadSignupCount),
    status: stringField(p.status, 'UNKNOWN'),
    createdAt: stringField(p.createdAt),
  };
}

export async function fetchMyCirclePosts(
  page = 1,
): Promise<PaginatedResponse<MyCirclePost>> {
  const result = await apiClient<PaginatedResponse<unknown>>(
    `/circle-plaza/me/posts${buildQuery({ page })}`,
  );
  return { ...result, items: result.items.map(normalizeMyPost) };
}

export async function fetchAllMyCirclePosts(): Promise<MyCirclePost[]> {
  const items: MyCirclePost[] = [];
  let page = 1;

  while (true) {
    const result = await fetchMyCirclePosts(page);
    items.push(...result.items);
    if (!result.hasMore) return items;
    page += 1;
  }
}

function normalizePostSignup(signup: unknown): PostSignupItem {
  const s = asRecord(signup);
  const avatarUrl = stringField(s.avatarUrl) || null;
  return {
    userId: stringField(s.userId),
    imUserId: stringField(s.imUserId),
    nickname: stringField(s.nickname, '用户'),
    avatarUrl: avatarUrl ? (normalizeMediaUrl(avatarUrl) ?? avatarUrl) : null,
    accountId: stringField(s.accountId),
    signedAt: stringField(s.signedAt),
    seen: booleanField(s.seen),
  };
}

export async function fetchMyPostSignups(
  postId: string,
): Promise<PostSignupItem[]> {
  const { items } = await apiClient<{ items: unknown[] }>(
    `/circle-plaza/me/posts/${postId}/signups`,
  );
  return items.map(normalizePostSignup);
}

export async function markMyPostSignupsRead(
  postId: string,
): Promise<{ count: number }> {
  return apiClient<{ count: number }>(
    `/circle-plaza/me/posts/${postId}/signups/read`,
    { method: 'POST' },
  );
}

export async function fetchMySignupsUnreadCount(): Promise<number> {
  const { count } = await apiClient<{ count: number }>(
    '/circle-plaza/me/signups/unread-count',
  );
  return count;
}
