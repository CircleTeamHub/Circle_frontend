/**
 * 会话变更序号流的纯决策(与后端 GET /chat/conversations/:id/sync 配套)。
 * 不依赖 store / 网络 / 本地库,方便单测覆盖游标与缺口的判断。
 */

/**
 * 本地游标落后超过这么多个序号时,不再逐页追平,直接跳到最新(这个会话的旧缓存作废)。
 * 逐页追一千条以上的热群只会把重连拖住;更早的历史用户往上翻时照常从服务端拉。
 */
export const SYNC_LIVE_WINDOW = 1000;

export type ConversationSyncPlan =
  | { kind: 'up-to-date' }
  /** 本地没有这个会话的缓存:没东西要对账,直接把游标种在服务端当前位置。 */
  | { kind: 'adopt'; revision: number }
  | { kind: 'pull'; from: number; to: number }
  | { kind: 'jump'; revision: number };

export function planConversationSync(input: {
  localRevision: number;
  targetRevision: number;
  hasLocalMessages: boolean;
}): ConversationSyncPlan {
  const { localRevision, targetRevision, hasLocalMessages } = input;
  if (targetRevision <= localRevision) return { kind: 'up-to-date' };
  if (!hasLocalMessages) return { kind: 'adopt', revision: targetRevision };
  if (targetRevision - localRevision > SYNC_LIVE_WINDOW) {
    return { kind: 'jump', revision: targetRevision };
  }
  return { kind: 'pull', from: localRevision, to: targetRevision };
}

/** 需要同步的会话(服务端序号比本地新),当前打开的会话排最前,其余保持列表顺序。 */
export function orderSyncTargets(
  conversations: readonly { id: string; syncRevision?: number | null }[],
  localRevisions: ReadonlyMap<string, number>,
  prioritizeId: string | null,
): { id: string; target: number }[] {
  const stale: { id: string; target: number }[] = [];
  for (const conversation of conversations) {
    const target = conversation.syncRevision;
    if (typeof target !== 'number' || !Number.isSafeInteger(target)) continue;
    if (target <= (localRevisions.get(conversation.id) ?? 0)) continue;
    stale.push({ id: conversation.id, target });
  }
  const index = prioritizeId
    ? stale.findIndex((item) => item.id === prioritizeId)
    : -1;
  if (index <= 0) return stale;
  return [stale[index], ...stale.slice(0, index), ...stale.slice(index + 1)];
}

/**
 * 实时事件带来的序号推进游标。只有连续的序号才能推进:中间缺一个就说明有一条
 * 变更没收到(断线、被服务端过滤、或两个并发提交的广播到达顺序反了),游标停在
 * 缺口前,等补上或交给一次增量同步。
 */
export function advanceRevisionCursor(
  cursor: number,
  pendingAbove: ReadonlySet<number>,
  revision: number,
): { cursor: number; pendingAbove: Set<number>; gap: boolean } {
  const pending = new Set(pendingAbove);
  if (!Number.isSafeInteger(revision) || revision <= cursor) {
    return { cursor, pendingAbove: pending, gap: pending.size > 0 };
  }
  pending.add(revision);
  let next = cursor;
  while (pending.has(next + 1)) {
    next += 1;
    pending.delete(next);
  }
  return { cursor: next, pendingAbove: pending, gap: pending.size > 0 };
}
