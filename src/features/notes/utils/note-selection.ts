/**
 * 「我的笔记」多选模式的纯函数集合。
 * 选择状态一律以 string[] 承载并返回新数组（不可变更新），配套 note-selection.test.mts 直测。
 */

export function toggleId(
  selected: readonly string[],
  id: string,
): string[] {
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id];
}

/**
 * 全选开关：可见列表已全部选中则清空，否则改为选中全部可见项。
 * 切 tab / 搜索后「可见列表」会变，开关始终以当前可见项为准 ——
 * 之前跨 tab 选中的隐藏项在「全选」时会被替换掉，避免误伤看不见的笔记。
 */
export function toggleSelectAll(
  selected: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const selectedSet = new Set(selected);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  return allSelected ? [] : [...visibleIds];
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

/**
 * 所有目标笔记共同所属的分组 id（保持第一条笔记的分组顺序）。
 * 分组选择器打开时的初始勾选：批量编辑以「大家都在的分组」起步，
 * 保存即替换 —— 弹层里会明示这一语义。
 */
export function commonGroupIds(notes: readonly GroupedLike[]): string[] {
  if (notes.length === 0) return [];
  const [first, ...rest] = notes;
  return first.groups
    .map((group) => group.id)
    .filter((id) => rest.every((note) => note.groups.some((g) => g.id === id)));
}
