import type { ChatMemberDto } from '@/chat-core/protocol';
import { Platform } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { getEncryptedInstance } from '@/storage/encrypted-init';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { groupOrCircleMutatedSince } from '@/features/chat/utils/group-reload-key';

/**
 * 群聊信息页的内存缓存:退出再进同一个群,先用上次拉到的群资料和成员画出来,
 * 后台照常重拉 —— 不再每次从空白开始逐块跳出来。
 *
 * - 同账号加密保存展示资料;validatedAccess 与临时房不落盘。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)整个缓存作废。
 * - 只留最近看过的 MAX_GROUPS 个群,按最近使用淘汰。
 * - 只用于首屏展示:权限仍以活体角色和服务端为准,撤权时调用方要 evict。
 */
const MAX_GROUPS = 20;

export interface CachedGroupInfo {
  /** 圈子群的圈子详情映射(群名/公告/人数);独立群聊与临时房没有。 */
  groupInfo?: { name: string; notice: string; memberCount: number } | null;
  members?: ChatMemberDto[];
  /** Only a successful live membership query may populate this; never seed from a conversation DTO. */
  validatedAccess?: {
    userID: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    roleHint: string | null;
    checkedAt: number;
  };
}

let cacheEpoch: number | null = null;
let cacheOwner: string | null = null;
let cacheRevision = -1;
const entries = new Map<string, CachedGroupInfo>();
const SNAPSHOT_KEY = 'social:group-info';

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
  const saved = readPageSnapshot<[string, Pick<CachedGroupInfo, 'groupInfo' | 'members'>][]>(owner, SNAPSHOT_KEY);
  for (const [key, value] of saved?.value ?? []) entries.set(key, { groupInfo: value.groupInfo, members: value.members });
  return true;
}

function persistGroups(): void {
  writePageSnapshot(cacheOwner, SNAPSHOT_KEY, [...entries]
    .filter(([key]) => !key.startsWith('temp:'))
    .map(([key, value]) => [key, { groupInfo: value.groupInfo, members: value.members }]));
}

export function readGroupInfoCache(
  epoch: number,
  groupKey: string,
): CachedGroupInfo | undefined {
  if (!scopeToEpoch(epoch)) return undefined;
  const hit = entries.get(groupKey);
  if (hit) {
    // Map 按插入顺序迭代:删了再放回就成了最近使用。
    entries.delete(groupKey);
    entries.set(groupKey, hit);
  }
  return hit;
}

export function writeGroupInfoCache(
  epoch: number,
  groupKey: string,
  patch: CachedGroupInfo,
  requestRevision = getPageSnapshotRevision(),
  requestStartedAt?: number,
): void {
  if (requestRevision !== getPageSnapshotRevision() || (requestStartedAt !== undefined && groupOrCircleMutatedSince(requestStartedAt))) return;
  if (!scopeToEpoch(epoch)) return;
  const next = { ...entries.get(groupKey), ...patch };
  entries.delete(groupKey);
  entries.set(groupKey, next);
  while (entries.size > MAX_GROUPS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  if (requestRevision === getPageSnapshotRevision() && (patch.members !== undefined || patch.groupInfo !== undefined)) persistGroups();
}

export function evictGroupInfoCache(epoch: number, groupKey: string): void {
  if (!scopeToEpoch(epoch)) return;
  entries.delete(groupKey);
  persistGroups();
}
