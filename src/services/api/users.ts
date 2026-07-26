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
  // 后端 Gender enum 固定 4 值；之前 union 里加 `| string` 等于退化成 any string，
  // 消费端 switch / equality 形同虚设。删 string 兜底，后端真要新增就让 TS 报错。
  gender?: 'male' | 'female' | 'other' | 'unset';
  city?: string | null;
  role?: string;
  status?: string;
  vipLevel?: number | null;
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

/**
 * 批量查 userId → vipLevel（会员名字特效的 IM/列表回退路径用）。POST /user/vip-levels。
 * 能内联返回 vipLevel 的场景（广场/朋友圈/资料）不走这里；只有仅有 userId 的聊天发送者 /
 * 会话列表 / 通讯录 / 通知才批量补查。空数组直接短路；合法的空对象（{} = 这批确实无人是
 * 会员）照常返回，是正常的权威降级。但**畸形响应**（非对象 / 数组 / 值非有限数字，多半是
 * 5xx 的 HTML、网关错误体或 schema 漂移）必须**抛出**——由 userVipStore.flush 的 catch
 * 接住走有界重试、保住缓存里的会员正档；绝不能兜底成 {}，否则会被 flush 当成「这批都不是
 * 会员」的权威成功，清掉缓存正档 + 标记 5 分钟新鲜，把一次瞬时故障变成会员特效熄灭。抛出的
 * 异常止于 flush 的 catch，不会到达渲染层。
 */
export async function fetchVipLevels(
  ids: string[],
): Promise<Record<string, number>> {
  const cleanedIds = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (cleanedIds.length === 0) {
    return {};
  }
  const raw = await apiClient<unknown>('/user/vip-levels', {
    method: 'POST',
    body: { ids: cleanedIds },
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'Malformed /user/vip-levels response: expected a JSON object',
    );
  }
  const out: Record<string, number> = {};
  for (const [id, level] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      throw new Error(
        `Malformed /user/vip-levels response: non-numeric level for "${id}"`,
      );
    }
    out[id] = level;
  }
  return out;
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
