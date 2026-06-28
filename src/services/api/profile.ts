/**
 * api/profile.ts — 用户资料相关 API
 *
 * - fetchUserProfile：根据用户 ID 获取他人公开资料
 * - updateUserProfile：更新当前用户资料（PATCH，仅传需要修改的字段）
 */
import { apiClient } from '@/services/api/client';
import { fetchCurrentUser, type BackendAuthUser } from '@/services/api/auth';
import { normalizeUser } from '@/services/api/utils';
import type { AuthUser } from '@/stores/authStore';

export type UpdateProfilePayload = Partial<
  Pick<
    BackendAuthUser,
    | 'nickname'
    | 'avatarUrl'
    | 'avatarFrame'
    | 'cover'
    | 'email'
    | 'phoneNumber'
    | 'wechat'
    | 'qq'
    | 'whatsup'
    | 'persona'
    | 'helloWords'
    | 'birthday'
    | 'gender'
    | 'city'
  >
>;

export async function fetchUserProfile(userId: string) {
  const user = await apiClient<BackendAuthUser>(`/user/${userId}`);
  return normalizeUser(user);
}

export type LikeStatus = { likeCount: number; likedByMeToday: boolean };

/** 给某用户点赞（每人对其每天最多一次），返回最新点赞状态。 */
export async function likeUser(userId: string): Promise<LikeStatus> {
  return apiClient<LikeStatus>(`/user/${userId}/like`, { method: 'POST' });
}

/** 取消今天对某用户的点赞，返回最新点赞状态。 */
export async function unlikeUser(userId: string): Promise<LikeStatus> {
  return apiClient<LikeStatus>(`/user/${userId}/like`, { method: 'DELETE' });
}

export async function updateUserProfile(
  userId: string,
  payload: UpdateProfilePayload,
  currentUser?: AuthUser | null,
) {
  const user = await apiClient<BackendAuthUser | null>(`/user/${userId}`, {
    method: 'PATCH',
    body: payload,
  });

  const patchedUser = user ? normalizeUser(user) : null;

  // 合并顺序的设计权衡（保留原行为 — 见 test/profile-api.test.js:keeps the submitted city ...）：
  //
  // `{ ...refreshedUser, ...payload }` 让 payload 覆盖刷新结果，主要为了**写后读 stale**
  // 场景：副本延迟 / 缓存让 /auth/me 拿到的还是更新前的值，把刚提交的字段也压回旧值，
  // UI 上会"立刻看到更新没生效"。让客户端 payload 视觉上保留住，等下一次 refresh 同步。
  //
  // 代价：如果服务端对字段做了归一化（电话加国码、邮箱小写化），UI 会短暂显示未归一化值，
  // 直到下一次 fetchCurrentUser。比起 stale 数据闪回，这个代价小得多。
  try {
    const refreshedUser = await fetchCurrentUser();
    return {
      ...refreshedUser,
      ...payload,
    };
  } catch {
    if (patchedUser) {
      return {
        ...patchedUser,
        ...payload,
      };
    }

    if (currentUser) {
      return {
        ...currentUser,
        ...payload,
      };
    }

    throw new Error('资料已提交，但刷新用户信息失败');
  }
}
