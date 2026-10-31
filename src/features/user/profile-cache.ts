import type { UserProfileData } from './data/profiles';
import type { FriendSettings, FriendStatus } from '@/services/api/friends';

/**
 * 资料页的内存缓存:再进看过的人直接用缓存先画出来,窗口内不重发请求。
 *
 * - 只在内存:资料里有对方按隐私设置放出的手机号/邮箱/微信,不能落盘;App 重启即清空。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)整个缓存作废。
 * - 只留最近看过的 MAX_PROFILES 个人,按最近使用淘汰 —— 和好友多少无关。
 */
const MAX_PROFILES = 50;
/** 拉到后这么久之内再进同一个人的资料页,不再请求。 */
export const PROFILE_CACHE_MAX_AGE_MS = 30_000;

type Stamped<T> = { value: T; at: number };

export interface CachedUserProfile {
  profile?: Stamped<UserProfileData>;
  friendStatus?: Stamped<FriendStatus | null>;
  friendSettings?: Stamped<FriendSettings | null>;
}

let cacheEpoch: number | null = null;
const entries = new Map<string, CachedUserProfile>();

function scopeToEpoch(epoch: number): void {
  if (cacheEpoch === epoch) return;
  entries.clear();
  cacheEpoch = epoch;
}

export function readUserProfileCache(
  epoch: number,
  userKey: string,
): CachedUserProfile | undefined {
  scopeToEpoch(epoch);
  const hit = entries.get(userKey);
  if (hit) {
    // Map 按插入顺序迭代:删了再放回就成了最近使用。
    entries.delete(userKey);
    entries.set(userKey, hit);
  }
  return hit;
}

export function writeUserProfileCache(
  epoch: number,
  userKey: string,
  patch: CachedUserProfile,
): void {
  scopeToEpoch(epoch);
  const next = { ...entries.get(userKey), ...patch };
  entries.delete(userKey);
  entries.set(userKey, next);
  while (entries.size > MAX_PROFILES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function evictUserProfileCache(epoch: number, userKey: string): void {
  scopeToEpoch(epoch);
  entries.delete(userKey);
}

/**
 * 在窗口内、之后也没有相关写请求时才算新鲜。at 是请求发出的时刻:数据是那一刻的,
 * 期间的写请求要算作「之后」。时钟回拨(差值为负)当作不新鲜。
 */
export function isProfileCacheFresh<T extends { at: number }>(
  stamp: T | undefined,
  now: number,
  mutatedSince: (since: number) => boolean,
): stamp is T {
  if (!stamp) return false;
  const age = now - stamp.at;
  return age >= 0 && age <= PROFILE_CACHE_MAX_AGE_MS && !mutatedSince(stamp.at);
}
