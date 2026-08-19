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
