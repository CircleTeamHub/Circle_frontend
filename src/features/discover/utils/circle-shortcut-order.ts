export type ShortcutCircle = {
  id: string;
};

export function orderCircleShortcuts<T extends ShortcutCircle>(
  circles: T[],
  orderIds: string[],
): T[] {
  if (orderIds.length === 0) return circles;

  const byId = new Map(circles.map((circle) => [circle.id, circle]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of orderIds) {
    const circle = byId.get(id);
    if (!circle || seen.has(id)) continue;
    ordered.push(circle);
    seen.add(id);
  }

  for (const circle of circles) {
    if (seen.has(circle.id)) continue;
    ordered.push(circle);
  }

  return ordered;
}

export function normalizeCircleShortcutOrder<T extends ShortcutCircle>(
  circles: T[],
  orderIds: string[],
): string[] {
  return orderCircleShortcuts(circles, orderIds).map((circle) => circle.id);
}

export function reorderCircleShortcut(
  orderIds: string[],
  circleId: string,
  targetIndex: number,
): string[] {
  const currentIndex = orderIds.indexOf(circleId);
  if (currentIndex < 0) return orderIds;

  const nextIndex = Math.max(0, Math.min(orderIds.length - 1, targetIndex));
  if (nextIndex === currentIndex) return orderIds;

  const next = [...orderIds];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}
