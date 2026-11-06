import type { UserProfileData } from './data/profiles';
import type { FriendSettings, FriendStatus } from '@/services/api/friends';
import { friendsMutatedSince } from '@/services/api/friends';
import { Platform } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { getEncryptedInstance } from '@/storage/encrypted-init';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';

/**
 * 资料页的内存缓存:再进看过的人直接用缓存先画出来,窗口内不重发请求。
 *
 * - 加密落盘的资料投影去掉联系方式;恢复只供首屏展示,本次会话仍后台重查。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)整个缓存作废。
 * - 只留最近看过的 MAX_PROFILES 个人,按最近使用淘汰 —— 和好友多少无关。
 */
const MAX_PROFILES = 50;
/** 拉到后这么久之内再进同一个人的资料页,不再请求。 */
export const PROFILE_CACHE_MAX_AGE_MS = 30_000;

type Stamped<T> = { value: T; at: number; restored?: boolean };

export interface CachedUserProfile {
  album?: Stamped<{ id: string; nickname: string; avatarUrl: string | null; cover: string | null; signature: string }>;
  profile?: Stamped<UserProfileData>;
  friendStatus?: Stamped<FriendStatus | null>;
  friendSettings?: Stamped<FriendSettings | null>;
}

let cacheEpoch: number | null = null;
let cacheOwner: string | null = null;
let cacheRevision = -1;
const entries = new Map<string, CachedUserProfile>();
const SNAPSHOT_KEY = 'social:profiles';

function scopeToEpoch(epoch: number): boolean {
  const auth = useAuthStore.getState();
  if (auth.sessionEpoch !== epoch) return false;
  const owner = auth.isAuthenticated ? auth.user?.id ?? null : null;
  const revision = getPageSnapshotRevision();
  if (cacheEpoch === epoch && cacheOwner === owner && cacheRevision === revision) return true;
  if (Platform.OS !== 'web' && !getEncryptedInstance()) return false;
  entries.clear();
  cacheEpoch = epoch;
  cacheOwner = owner;
  cacheRevision = revision;
  const saved = readPageSnapshot<[string, CachedUserProfile][]>(owner, SNAPSHOT_KEY);
  for (const [key, entry] of saved?.value ?? []) {
    entries.set(key, {
      ...entry,
      ...(entry.profile && { profile: { ...entry.profile, restored: true } }),
      ...(entry.album && { album: { ...entry.album, restored: true } }),
      ...(entry.friendStatus && { friendStatus: { ...entry.friendStatus, restored: true } }),
      ...(entry.friendSettings && { friendSettings: { ...entry.friendSettings, restored: true } }),
    });
  }
  return true;
}

function persistProfiles(): void {
  writePageSnapshot(cacheOwner, SNAPSHOT_KEY, [...entries].map(([key, entry]) => [key, {
    ...entry,
    ...(entry.profile && { profile: {
      ...entry.profile,
      value: { ...entry.profile.value, contact: { phone: null, email: null, wechat: null, qq: null } },
    } }),
  }]));
}

// Profile routes can use an account ID; their child routes use the canonical UUID.
function resolveCacheKey(userKey: string): string {
  return entries.has(userKey) ? userKey : [...entries].find(([, entry]) =>
    entry.profile?.value.id === userKey || entry.album?.value.id === userKey ||
    entry.profile?.value.accountId?.toLowerCase() === userKey.toLowerCase(),
  )?.[0] ?? userKey;
}

export function readUserProfileCache(epoch: number, userKey: string): CachedUserProfile | undefined {
  if (!scopeToEpoch(epoch)) return undefined;
  const key = resolveCacheKey(userKey);
  const hit = entries.get(key);
  if (hit) {
    entries.delete(key);
    entries.set(key, hit);
  }
  return hit;
}

export function writeUserProfileCache(epoch: number, userKey: string, patch: CachedUserProfile, requestRevision = getPageSnapshotRevision()): void {
  if (requestRevision !== getPageSnapshotRevision() || Object.values(patch).some((stamp) => stamp && friendsMutatedSince(stamp.at))) return;
  if (!scopeToEpoch(epoch)) return;
  const key = resolveCacheKey(userKey);
  const next = { ...entries.get(key), ...patch };
  entries.delete(key);
  entries.set(key, next);
  while (entries.size > MAX_PROFILES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  if (requestRevision === getPageSnapshotRevision()) persistProfiles();
}

export function evictUserProfileCache(epoch: number, userKey: string): void {
  if (!scopeToEpoch(epoch)) return;
  entries.delete(resolveCacheKey(userKey));
  persistProfiles();
}

/**
 * 在窗口内、之后也没有相关写请求时才算新鲜。at 是请求发出的时刻:数据是那一刻的,
 * 期间的写请求要算作「之后」。时钟回拨(差值为负)当作不新鲜。
 */
export function isProfileCacheFresh<T extends { at: number; restored?: boolean }>(
  stamp: T | undefined,
  now: number,
  mutatedSince: (since: number) => boolean,
): stamp is T {
  if (!stamp || stamp.restored) return false;
  const age = now - stamp.at;
  return age >= 0 && age <= PROFILE_CACHE_MAX_AGE_MS && !mutatedSince(stamp.at);
}
