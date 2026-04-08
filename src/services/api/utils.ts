/**
 * api/utils.ts — API 层共享工具函数
 */
import { API_URL } from '@/constants/config';
import type { AuthUser } from '@/stores/authStore';
import type { BackendAuthUser } from '@/services/api/auth';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1']);

export function normalizeMediaUrl(value: string | null | undefined) {
  if (!value) {
    return value ?? null;
  }

  try {
    const mediaUrl = new URL(value);
    const apiUrl = new URL(API_URL);

    if (
      LOCALHOST_HOSTS.has(mediaUrl.hostname) &&
      !LOCALHOST_HOSTS.has(apiUrl.hostname)
    ) {
      mediaUrl.hostname = apiUrl.hostname;
      return mediaUrl.toString();
    }
  } catch {
    return value;
  }

  return value;
}

/**
 * 将后端用户对象规范化为前端 AuthUser 格式。
 * uid 优先取 accountId（OpenIM 用户 ID），没有时 fallback 到 username。
 * city 字段后端暂未返回，统一置为 null。
 */
export function normalizeUser(user: BackendAuthUser): AuthUser {
  return {
    ...user,
    avatarUrl: normalizeMediaUrl(user.avatarUrl),
    avatarFrame: normalizeMediaUrl(user.avatarFrame),
    cover: normalizeMediaUrl(user.cover),
    uid: user.accountId || user.username,
    city: null,
  };
}
