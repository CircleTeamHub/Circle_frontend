/**
 * 「我的笔记」多选模式的纯函数集合。
 * 选择状态一律以 string[] 承载并返回新数组（不可变更新），配套 note-selection.test.mts 直测。
 */

export function toggleId(
  selected: readonly string[],
  id: string,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  if (selected.includes(id)) {
    return selected.filter((item) => item !== id);
  }
  return selected.length >= limit ? [...selected] : [...selected, id];
}

/**
 * 全选开关：可见列表已全部选中则清空，否则改为选中全部可见项。
 * 切 tab / 搜索后「可见列表」会变，开关始终以当前可见项为准 ——
 * 之前跨 tab 选中的隐藏项在「全选」时会被替换掉，避免误伤看不见的笔记。
 */
export function toggleSelectAll(
  selected: readonly string[],
  visibleIds: readonly string[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const selectedSet = new Set(selected);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  return allSelected ? [] : visibleIds.slice(0, limit);
}

/** 列表刷新后清掉已不存在的选中项（被删/被下架的笔记不再计入批量操作）。 */
export function pruneSelection(
  selected: readonly string[],
  existingIds: readonly string[],
): string[] {
  const existing = new Set(existingIds);
  const pruned = selected.filter((id) => existing.has(id));
  return pruned.length === selected.length ? [...selected] : pruned;
}

interface GroupedLike {
  groups: readonly { id: string }[];
}

/** 分组在所选笔记里的归属状态：全部都在 / 部分在 / 都不在。 */
export type GroupMembershipState = 'all' | 'some' | 'none';

/** 用户对某个分组的显式操作：把所选笔记全部加入 / 全部移出。 */
export type GroupMembershipChange = 'add' | 'remove';

/**
 * 分组选择器打开时的三态底图：勾选态按「所选笔记是否全部/部分/都不在
 * 该分组」呈现。批量编辑不做整套替换 —— 只有被用户显式改动的分组会写回。
 */
export function groupMembershipStates(
  notes: readonly GroupedLike[],
  groups: readonly { id: string }[],
): Map<string, GroupMembershipState> {
  const states = new Map<string, GroupMembershipState>();
  for (const group of groups) {
    let count = 0;
    for (const note of notes) {
      if (note.groups.some((g) => g.id === group.id)) count += 1;
    }
    states.set(
      group.id,
      count === 0 || notes.length === 0
        ? 'none'
        : count === notes.length
          ? 'all'
          : 'some',
    );
  }
  return states;
}

interface GroupedWithId extends GroupedLike {
  id: string;
}

/**
 * 把用户的显式改动（加入/移出某些分组）套到每条笔记自己的分组集合上：
 * 未被改动的分组保持该笔记原样。只返回净变化非零的笔记 ——
 * 调用方据此逐条 PATCH，不给无变化的笔记发请求。
 */
export function applyGroupMembershipChanges(
  notes: readonly GroupedWithId[],
  changes: Readonly<Record<string, GroupMembershipChange>>,
): { id: string; groupIds: string[] }[] {
  const entries = Object.entries(changes);
  if (entries.length === 0) return [];
  const ops: { id: string; groupIds: string[] }[] = [];
  for (const note of notes) {
    const current = note.groups.map((group) => group.id);
    const currentSet = new Set(current);
    const next = current.filter((id) => changes[id] !== 'remove');
    for (const [groupId, op] of entries) {
      if (op === 'add' && !currentSet.has(groupId)) next.push(groupId);
    }
    const changed =
      next.length !== current.length ||
      next.some((id, index) => id !== current[index]);
    if (changed) ops.push({ id: note.id, groupIds: next });
  }
  return ops;
}
