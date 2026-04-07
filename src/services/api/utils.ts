/**
 * api/utils.ts — API 层共享工具函数
 */
import type { AuthUser } from '@/stores/authStore';
import type { BackendAuthUser } from '@/services/api/auth';

/**
 * 将后端用户对象规范化为前端 AuthUser 格式。
 * uid 优先取 accountId（OpenIM 用户 ID），没有时 fallback 到 username。
 * city 字段后端暂未返回，统一置为 null。
 */
export function normalizeUser(user: BackendAuthUser): AuthUser {
  return {
    ...user,
    uid: user.accountId || user.username,
    city: null,
  };
}
