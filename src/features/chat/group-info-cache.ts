import type { ChatMemberDto } from '@/chat-core/protocol';

/**
 * 群聊信息页的内存缓存:退出再进同一个群,先用上次拉到的群资料和成员画出来,
 * 后台照常重拉 —— 不再每次从空白开始逐块跳出来。
 *
 * - 只在内存:成员昵称/头像是别人的资料,不落盘;App 重启即清空。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)整个缓存作废。
 * - 只留最近看过的 MAX_GROUPS 个群,按最近使用淘汰。
 * - 只用于首屏展示:权限仍以活体角色和服务端为准,撤权时调用方要 evict。
 */
const MAX_GROUPS = 20;

export interface CachedGroupInfo {
  /** 圈子群的圈子详情映射(群名/公告/人数);独立群聊与临时房没有。 */
  groupInfo?: { name: string; notice: string; memberCount: number } | null;
  members?: ChatMemberDto[];
}

let cacheEpoch: number | null = null;
const entries = new Map<string, CachedGroupInfo>();

function scopeToEpoch(epoch: number): void {
  if (cacheEpoch === epoch) return;
  entries.clear();
  cacheEpoch = epoch;
}

export function readGroupInfoCache(
  epoch: number,
  groupKey: string,
): CachedGroupInfo | undefined {
  scopeToEpoch(epoch);
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
): void {
  scopeToEpoch(epoch);
  const next = { ...entries.get(groupKey), ...patch };
  entries.delete(groupKey);
  entries.set(groupKey, next);
  while (entries.size > MAX_GROUPS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function evictGroupInfoCache(epoch: number, groupKey: string): void {
  scopeToEpoch(epoch);
  entries.delete(groupKey);
}
