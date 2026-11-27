import type { NoteSummary } from '../types';

/** 我的笔记的三种排序：最近编辑 / 最近添加 / 手动排序。 */
export type NoteSortMode = 'edited' | 'added' | 'manual';

export const NOTE_SORT_MODES: readonly NoteSortMode[] = ['edited', 'added', 'manual'];

export const DEFAULT_NOTE_SORT_MODE: NoteSortMode = 'edited';

type SortableNote = Pick<NoteSummary, 'id' | 'pinned' | 'createdAt' | 'updatedAt'>;

const timeOf = (value: string) => Date.parse(value) || 0;

/**
 * 按排序方式排好一组笔记（不改原数组）。置顶的在任何方式下都排最前。
 *
 * 手动排序：manualOrder 里有的按它的先后；还没排过的（新建、新收藏、重新上架）放在最前，
 * 彼此按添加时间新的在前——刚加的笔记不会沉到几百条后面找不到。
 */
export function sortNotes<T extends SortableNote>(
  notes: readonly T[],
  mode: NoteSortMode,
  manualOrder: readonly string[],
): T[] {
  const compare = mode === 'manual'
    ? byManualOrder(notes, manualOrder)
    : mode === 'added'
      ? (a: T, b: T) => timeOf(b.createdAt) - timeOf(a.createdAt)
      : (a: T, b: T) => timeOf(b.updatedAt) - timeOf(a.updatedAt);
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || compare(a, b));
}

function byManualOrder<T extends Pick<NoteSummary, 'id' | 'createdAt'>>(notes: readonly T[], manualOrder: readonly string[]) {
  const position = new Map(manualOrder.map((id, index) => [id, index]));
  const unranked = notes
    .filter((note) => !position.has(note.id))
    .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
  // 没排过的给负数名次，整体排在排过的前面。
  unranked.forEach((note, index) => position.set(note.id, index - unranked.length));
  return (a: T, b: T) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
}

/**
 * 在完整顺序里只重排 nextSubsetIds 占着的那些位置，其他笔记原地不动：
 * 在某个分组里调顺序，不会打乱别的分组里笔记的先后。
 * 完整顺序里已经没有的 id（调顺序时笔记刚被删掉）直接略过，不会顶掉别的笔记。
 */
export function applySubsetOrder(
  fullIds: readonly string[],
  nextSubsetIds: readonly string[],
): string[] {
  const present = new Set(fullIds);
  const next = nextSubsetIds.filter((id) => present.has(id));
  const subset = new Set(next);
  let cursor = 0;
  return fullIds.map((id) => (subset.has(id) ? next[cursor++] : id));
}

type ReorderableNote = Pick<NoteSummary, 'id' | 'pinned' | 'createdAt'>;

/**
 * 手动排序面板提交的新顺序（只含当前分组，置顶在前）→ 新的完整手动顺序。
 * 置顶的和普通的各自只在自己原来占着的位置里重排：置顶只是显示时提到最前，不写进手动顺序，
 * 取消置顶后笔记回到原来的位置。
 */
export function reorderManual(
  notes: readonly ReorderableNote[],
  manualOrder: readonly string[],
  nextIds: readonly string[],
): string[] {
  const fullIds = [...notes].sort(byManualOrder(notes, manualOrder)).map((note) => note.id);
  const pinned = new Set(notes.filter((note) => note.pinned).map((note) => note.id));
  return applySubsetOrder(
    applySubsetOrder(fullIds, nextIds.filter((id) => pinned.has(id))),
    nextIds.filter((id) => !pinned.has(id)),
  );
}

/** 把一个 id 挪到最前（「移到最前」）。 */
export function moveToFront(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((other) => other !== id)];
}
