export interface MessageFilterOrderItem {
  id: string;
}

export function orderMessageFilters<T extends MessageFilterOrderItem>(
  items: T[],
  orderIds: string[],
): T[] {
  if (orderIds.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of orderIds) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }

  for (const item of items) {
    if (seen.has(item.id)) continue;
    ordered.push(item);
  }

  return ordered;
}

export function normalizeMessageFilterOrder<T extends MessageFilterOrderItem>(
  items: T[],
  orderIds: string[],
): string[] {
  return orderMessageFilters(items, orderIds).map((item) => item.id);
}

export function reorderMessageFilter(
  orderIds: string[],
  filterId: string,
  targetIndex: number,
): string[] {
  const currentIndex = orderIds.indexOf(filterId);
  if (currentIndex < 0) return orderIds;

  const nextIndex = Math.max(0, Math.min(orderIds.length - 1, targetIndex));
  if (nextIndex === currentIndex) return orderIds;

  const next = [...orderIds];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}

/** 消息页固定的四个标签；自定义分组的标签 id 是 `custom:<groupId>`。 */
export const BUILT_IN_MESSAGE_FILTER_IDS = ['all', 'unread', 'group', 'private'] as const;

const CUSTOM_FILTER_PREFIX = 'custom:';

export function customFilterId(groupId: string): string {
  return `${CUSTOM_FILTER_PREFIX}${groupId}`;
}

export function groupIdFromFilterId(filterId: string): string | null {
  return filterId.startsWith(CUSTOM_FILTER_PREFIX)
    ? filterId.slice(CUSTOM_FILTER_PREFIX.length)
    : null;
}

/**
 * 分组管理页那一条列表的顺序：固定标签 + 全部自定义分组（含暂不显示在消息页的），
 * 顺序以本地保存的 filterOrder 为准，没排过的分组按服务端 sortOrder 追加在尾部。
 * 消息页拿同一份 filterOrder 过滤掉隐藏分组，所以两处顺序永远一致。
 */
export function buildManagedFilterOrder(
  groupIds: readonly string[],
  storedOrder: string[],
): string[] {
  const items = [...BUILT_IN_MESSAGE_FILTER_IDS, ...groupIds.map(customFilterId)].map(
    (id) => ({ id }),
  );
  return normalizeMessageFilterOrder(items, storedOrder);
}

/**
 * 拖完一行后分组之间的相对顺序（写回服务端 sortOrder，换设备也保留）。
 * 只挪了固定标签、分组相对顺序没变时返回 null，不必发请求。
 */
export function changedGroupOrder(
  previousOrder: readonly string[],
  nextOrder: readonly string[],
): string[] | null {
  const toGroupIds = (order: readonly string[]) =>
    order.flatMap((id) => {
      const groupId = groupIdFromFilterId(id);
      return groupId ? [groupId] : [];
    });
  const previous = toGroupIds(previousOrder);
  const next = toGroupIds(nextOrder);
  return next.some((id, index) => id !== previous[index]) ? next : null;
}
