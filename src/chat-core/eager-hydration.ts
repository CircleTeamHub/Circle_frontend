interface HydrationCandidate {
  id: string;
  pinned?: boolean;
  lastMessageAt?: string | null;
}

function activityOf(candidate: HydrationCandidate): number {
  const time = candidate.lastMessageAt ? Date.parse(candidate.lastMessageAt) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

/**
 * 冷启动要把哪些会话的时间线从本地库预读进内存:按列表顺序(置顶优先、再按最近活跃)
 * 取前 limit 个,再加上必须预读的会话。其余会话打开时由 loadChatHistory 从本地库补读。
 */
export function pickEagerTimelineIds(
  conversations: readonly HydrationCandidate[],
  options: { limit: number; mustInclude: ReadonlySet<string> },
): Set<string> {
  const ordered = [...conversations].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    return activityOf(right) - activityOf(left);
  });
  const ids = new Set(ordered.slice(0, options.limit).map((candidate) => candidate.id));
  for (const id of options.mustInclude) ids.add(id);
  return ids;
}
