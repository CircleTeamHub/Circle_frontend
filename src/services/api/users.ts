import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';

export type PublicUser = {
  id: string;
  accountId: string;
  nickname: string | null;
  avatarUrl: string | null;
  avatarFrame?: string | null;
  cover?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  wechat?: string | null;
  qq?: string | null;
  whatsup?: string | null;
  persona?: string | null;
  helloWords?: string | null;
  birthday?: string | null;
  gender?: 'male' | 'female' | 'other' | 'unset' | string;
  city?: string | null;
  role?: string;
  status?: string;
  lastOnline?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function normalizePublicUser(user: PublicUser): PublicUser {
  return {
    ...user,
    avatarUrl: normalizeMediaUrl(user.avatarUrl),
    avatarFrame: normalizeMediaUrl(user.avatarFrame),
    cover: normalizeMediaUrl(user.cover),
  };
}

export function pickExactAccountMatch<T extends Pick<PublicUser, 'accountId'>>(
  keyword: string,
  users: T[] | null | undefined,
): T | null {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword || !users?.length) {
    return null;
  }

  return (
    users.find(
      (user) => user.accountId?.trim().toLowerCase() === normalizedKeyword,
    ) ?? null
  );
}

export async function searchUsersByAccountId(accountId: string) {
  const keyword = accountId.trim();

  if (!keyword) {
    return null;
  }

  const user = await apiClient<PublicUser | null>(
    `/user/search/account?accountId=${encodeURIComponent(keyword)}`,
  );

  return user ? normalizePublicUser(user) : null;
}
