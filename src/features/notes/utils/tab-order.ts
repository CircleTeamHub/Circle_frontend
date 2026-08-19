/**
 * 「我的笔记」tab 顺序合并：把本地持久化的顺序(含固定 tab「全部/未分组」)
 * 与服务端分组列表对齐。固定 tab 没有服务端行,位置只存在本地;
 * 分组之间的相对顺序仍以服务端 sortOrder 为准(新分组追加在尾部)。
 */

export const NOTES_TAB_ALL = 'all';
export const NOTES_TAB_UNGROUPED = 'ungrouped';

export function mergeTabOrder(
  stored: readonly string[],
  groupIds: readonly string[],
): string[] {
  const valid = new Set([NOTES_TAB_ALL, NOTES_TAB_UNGROUPED, ...groupIds]);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of stored) {
    if (!valid.has(id) || seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }
  // 固定 tab 丢失(首次使用/存储被清)时兜底:「全部」回到最前、「未分组」紧随其后。
  if (!seen.has(NOTES_TAB_ALL)) {
    merged.unshift(NOTES_TAB_ALL);
    seen.add(NOTES_TAB_ALL);
  }
  if (!seen.has(NOTES_TAB_UNGROUPED)) {
    merged.splice(merged.indexOf(NOTES_TAB_ALL) + 1, 0, NOTES_TAB_UNGROUPED);
    seen.add(NOTES_TAB_UNGROUPED);
  }
  for (const id of groupIds) {
    if (seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }
  return merged;
}
