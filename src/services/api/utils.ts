/**
 * api/utils.ts — API 层共享工具函数
 */
import { apiClient } from '@/services/api/client';
import { API_URL } from '@/constants/config';
import type { AuthUser } from '@/stores/authStore';
import type { BackendAuthUser } from '@/services/api/auth';
import type { AvatarFrameAppearance } from '@/types';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1']);

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isDevReachabilityHost(hostname: string) {
  return LOCALHOST_HOSTS.has(hostname) || isPrivateIpv4(hostname);
}

/**
 * 把可选参数追加到 URLSearchParams：只在 value 非空（非 undefined / 非空字符串）时写入。
 * 之前 circles.ts / moments.ts / plaza.ts 各写一份 if(params?.x) query.set(...)。
 */
export function appendQueryIfDefined(
  query: URLSearchParams,
  key: string,
  value: string | number | undefined | null,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.length === 0) return;
  query.set(key, String(value));
}

/**
 * 把 query 转成 `?a=1&b=2` 或空字符串。让 caller 一行 `${endpoint}${buildQuery(...)}` 写完。
 */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendQueryIfDefined(query, key, value);
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

/**
 * 拉取仅返 `{ count: number }` 的端点；只暴露 count。
 * friends.ts、circles.ts 都有这种小端点，之前每处都重写一遍。
 */
export async function fetchCountEndpoint(endpoint: string): Promise<number> {
  const result = await apiClient<{ count: number }>(endpoint);
  return result.count;
}

export function normalizeMediaUrl(value: string | null | undefined) {
  if (!value) {
    return value ?? null;
  }

  try {
    const mediaUrl = new URL(value);
    const apiUrl = new URL(API_URL);

    if (isDevReachabilityHost(mediaUrl.hostname) && mediaUrl.hostname !== apiUrl.hostname) {
      // 媒体地址常来自独立服务：OpenIM object 是 10002，MinIO 是 9000。
      // 只能把 dev host 替换成手机可访问的当前 host，不能把端口改成后端 API 端口。
      mediaUrl.protocol = apiUrl.protocol;
      mediaUrl.hostname = apiUrl.hostname;
      if (!mediaUrl.port) {
        mediaUrl.port = apiUrl.port;
      }
      return mediaUrl.toString();
    }
  } catch {
    return value;
  }

  return value;
}

/**
 * Avatar frames render outside the normal media pipeline, so only explicit
 * network URLs are allowed. Production accepts HTTPS. Development may also
 * use HTTP on the configured private/local API host (with a different media
 * port), after normalizeMediaUrl rewrites localhost to the reachable host.
 */
export function normalizeAvatarFrameImageUrl(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  try {
    const originalUrl = new URL(value);
    const isDev =
      typeof __DEV__ !== 'undefined' && Boolean(__DEV__);
    if (
      originalUrl.username ||
      originalUrl.password ||
      (originalUrl.protocol !== 'https:' &&
        originalUrl.protocol !== 'http:') ||
      (originalUrl.protocol === 'http:' && !isDev)
    ) {
      return null;
    }
    const normalized = normalizeMediaUrl(value);
    if (typeof normalized !== 'string') {
      return null;
    }
    const mediaUrl = new URL(normalized);
    if (mediaUrl.username || mediaUrl.password) {
      return null;
    }
    if (mediaUrl.protocol === 'https:') {
      return mediaUrl.toString();
    }
    const apiUrl = new URL(API_URL);
    if (
      isDev &&
      mediaUrl.protocol === 'http:' &&
      apiUrl.protocol === 'http:' &&
      isDevReachabilityHost(apiUrl.hostname) &&
      mediaUrl.hostname === apiUrl.hostname
    ) {
      return mediaUrl.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeAvatarFrameAppearance(
  value: unknown,
): AvatarFrameAppearance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const frame = value as Record<string, unknown>;
  if (
    typeof frame.id !== 'string' ||
    typeof frame.key !== 'string' ||
    typeof frame.name !== 'string' ||
    (frame.imageUrl !== null && typeof frame.imageUrl !== 'string')
  ) {
    return null;
  }
  return {
    id: frame.id,
    key: frame.key,
    name: frame.name,
    imageUrl: normalizeAvatarFrameImageUrl(frame.imageUrl),
  };
}

/**
 * 将后端用户对象规范化为前端 AuthUser 格式。
 * uid 取 accountId（OpenIM 用户 ID）。
 *
 * 显式列出每个字段，不使用 `...user` 展开 —— 后端将来若新增 passwordHash /
 * internalNotes / payoutAccountNumber 等敏感字段，不会因为类型扩张而悄悄
 * 流入前端 store 与 MMKV 持久化。
 */
export function normalizeUser(user: BackendAuthUser): AuthUser {
  return {
    id: user.id,
    accountId: user.accountId,
    inviteCode: user.inviteCode,
    uid: user.accountId,
    nickname: user.nickname,
    avatarUrl: normalizeMediaUrl(user.avatarUrl),
    avatarFrame: normalizeMediaUrl(user.avatarFrame),
    avatarFrameAppearance: normalizeAvatarFrameAppearance(
      user.avatarFrameAppearance,
    ),
    cover: normalizeMediaUrl(user.cover),
    email: user.email,
    phoneNumber: user.phoneNumber,
    wechat: user.wechat,
    qq: user.qq,
    whatsup: user.whatsup,
    persona: user.persona,
    helloWords: user.helloWords,
    birthday: user.birthday,
    gender: user.gender,
    role: user.role,
    status: user.status,
    lastOnline: user.lastOnline,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    city: user.city,
    vipLevel: user.vipLevel,
    creditScore: user.creditScore,
    fancyNumber: user.fancyNumber,
    displayIcons: (user.displayIcons ?? []).map((icon) => ({
      ...icon,
      imageUrl: normalizeMediaUrl(icon.imageUrl),
    })),
    likeCount: user.likeCount ?? user.receivedLikeCount ?? 0,
    recognitionCount: user.recognitionCount ?? 0,
  };
}
