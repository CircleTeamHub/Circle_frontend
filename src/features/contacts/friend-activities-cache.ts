import type { FriendActivity } from '@/services/api/friends';

/**
 * 「新的朋友」列表的内存缓存:再进这页先画上次拉到的列表,后台照常重拉 —— 不再每次整页转圈。
 *
 * - 只在内存:列表里是别人的昵称、头像和附言,不落盘;App 重启即清空。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)就作废。
 * - at 是那次请求发出的时刻。之后有过好友写请求(详情页同意/拒绝、发出申请…)就不再用:
 *   那份列表会把已处理的申请先画回「待处理」。宁可像以前一样转圈。
 */
let cached: { epoch: number; activities: FriendActivity[]; at: number } | null =
  null;

export function readFriendActivitiesCache(
  epoch: number,
  mutatedSince: (since: number) => boolean,
): FriendActivity[] | null {
  if (cached?.epoch !== epoch) cached = null;
  return cached && !mutatedSince(cached.at) ? cached.activities : null;
}

export function writeFriendActivitiesCache(
  epoch: number,
  activities: FriendActivity[],
  at: number,
): void {
  cached = { epoch, activities, at };
}
