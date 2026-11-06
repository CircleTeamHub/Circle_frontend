import type { CircleDetail, CircleInvitation } from '@/types';
import { Platform } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { getEncryptedInstance } from '@/storage/encrypted-init';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { groupOrCircleMutatedSince } from '@/features/chat/utils/group-reload-key';

/**
 * 圈子详情页的内存缓存:再进看过的圈子,先用上次拉到的详情画出来,后台照常重拉 ——
 * 不再每次打开都整页转圈。
 *
 * - 加密保存同账号展示快照;恢复的 myStatus/myRole 不能充当本次授权。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)整个缓存作废。
 * - 只留最近看过的 MAX_CIRCLES 个圈子,按最近使用淘汰。
 * - 只用于首屏展示:加入/退出/管理按钮先按缓存里的成员关系画,每次打开都会重拉校准;
 *   按钮背后的写操作服务端都会再校验。本页就地改过的(加入/退出/换头像封面)要同步或 evict。
 * - 封面/头像是公开且不过期的地址,缓存住不会失效。
 */
const MAX_CIRCLES = 30;

export interface CachedCircleDetail {
  circle?: CircleDetail;
  /** 这份详情的请求发出时刻;之后有过群/圈子写操作,调用方就不该再用它(见 CircleDetailScreen)。 */
  at?: number;
  /** 我在该圈进行中的入圈申请(10 人担保验证);null = 没有。 */
  invitation?: CircleInvitation | null;
}

let cacheEpoch: number | null = null;
let cacheOwner: string | null = null;
let cacheRevision = -1;
const entries = new Map<string, CachedCircleDetail>();
const SNAPSHOT_KEY = 'social:circle-detail';

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
  const saved = readPageSnapshot<[string, CachedCircleDetail][]>(owner, SNAPSHOT_KEY);
  for (const [key, value] of saved?.value ?? []) entries.set(key, value);
  return true;
}

export function readCircleDetailCache(
  epoch: number,
  circleId: string,
): CachedCircleDetail | undefined {
  if (!scopeToEpoch(epoch)) return undefined;
  const hit = entries.get(circleId);
  if (hit) {
    // Map 按插入顺序迭代:删了再放回就成了最近使用。
    entries.delete(circleId);
    entries.set(circleId, hit);
  }
  return hit;
}

export function writeCircleDetailCache(
  epoch: number,
  circleId: string,
  patch: CachedCircleDetail,
  requestRevision = getPageSnapshotRevision(),
  requestStartedAt = patch.at,
): void {
  if (requestRevision !== getPageSnapshotRevision() || (requestStartedAt !== undefined && groupOrCircleMutatedSince(requestStartedAt))) return;
  if (!scopeToEpoch(epoch)) return;
  const next = { ...entries.get(circleId), ...patch };
  entries.delete(circleId);
  entries.set(circleId, next);
  while (entries.size > MAX_CIRCLES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  if (requestRevision === getPageSnapshotRevision()) writePageSnapshot(cacheOwner, SNAPSHOT_KEY, [...entries]);
}

/** 本页就地改了头像/封面:改进缓存里那份;没缓存过就不凭空造一个只有半截字段的圈子。 */
export function patchCachedCircle(
  epoch: number,
  circleId: string,
  patch: Partial<CircleDetail>,
): void {
  const cached = readCircleDetailCache(epoch, circleId)?.circle;
  if (!cached) return;
  writeCircleDetailCache(epoch, circleId, { circle: { ...cached, ...patch } });
}

export function evictCircleDetailCache(epoch: number, circleId: string): void {
  if (!scopeToEpoch(epoch)) return;
  entries.delete(circleId);
  writePageSnapshot(cacheOwner, SNAPSHOT_KEY, [...entries]);
}
