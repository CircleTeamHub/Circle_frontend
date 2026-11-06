import { friendsMutatedSince, type FriendActivity } from '@/services/api/friends';
import { useAuthStore } from '@/stores/authStore';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';

/**
 * 「新的朋友」列表的内存缓存:再进这页先画上次拉到的列表,后台照常重拉 —— 不再每次整页转圈。
 *
 * - 同账号加密保存展示快照;进入后照常后台刷新。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)就作废。
 * - at 是那次请求发出的时刻。之后有过好友写请求(详情页同意/拒绝、发出申请…)就不再用:
 *   那份列表会把已处理的申请先画回「待处理」。宁可像以前一样转圈。
 */
let cached: { epoch: number; activities: FriendActivity[]; at: number } | null =
  null;
let cacheRevision = -1;

export function readFriendActivitiesCache(
  epoch: number,
  mutatedSince: (since: number) => boolean,
): FriendActivity[] | null {
  const auth = useAuthStore.getState();
  if (auth.sessionEpoch !== epoch) return null;
  const revision = getPageSnapshotRevision();
  if (cached?.epoch !== epoch || cacheRevision !== revision) cached = null;
  cacheRevision = revision;
  if (!cached) {
    const saved = readPageSnapshot<FriendActivity[]>(auth.user?.id, 'social:friend-activities');
    if (saved) cached = { epoch, activities: saved.value, at: saved.at };
  }
  return cached && !mutatedSince(cached.at) ? cached.activities : null;
}

export function writeFriendActivitiesCache(
  epoch: number,
  activities: FriendActivity[],
  at: number,
  requestRevision = getPageSnapshotRevision(),
): void {
  const auth = useAuthStore.getState();
  if (auth.sessionEpoch !== epoch) return;
  cached = { epoch, activities, at };
  cacheRevision = getPageSnapshotRevision();
  if (requestRevision === cacheRevision && !friendsMutatedSince(at)) writePageSnapshot(auth.user?.id, 'social:friend-activities', activities, at);
}
