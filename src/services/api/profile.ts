/**
 * api/profile.ts — 用户资料相关 API
 *
 * - fetchUserProfile：根据用户 ID 获取他人公开资料
 * - updateUserProfile：更新当前用户资料（PATCH，仅传需要修改的字段）
 */
import { apiClient } from '@/services/api/client';
import type { BackendAuthUser } from '@/services/api/auth';
import { normalizeUser } from '@/services/api/utils';

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
  >
>;

export async function fetchUserProfile(userId: string) {
  const user = await apiClient<BackendAuthUser>(`/user/${userId}`);
  return normalizeUser(user);
}

export async function updateUserProfile(
  userId: string,
  payload: UpdateProfilePayload
) {
  const user = await apiClient<BackendAuthUser>(`/user/${userId}`, {
    method: 'PATCH',
    body: payload,
  });

  return normalizeUser(user);
}
