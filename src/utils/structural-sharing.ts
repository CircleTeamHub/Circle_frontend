/** JSON 形状的深比较:缺字段与 undefined 视为相同(JSON 里没有 undefined)。 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => structurallyEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!structurallyEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * 重新拉回的列表里,内容没变的项沿用上一次的对象;什么都没变时连数组本身也沿用。
 * 订阅方按引用判断,重拉一次就不会把整张列表都重渲染一遍。
 */
export function reuseUnchanged<T extends { id: string }>(previous: readonly T[], next: T[]): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  let identical = previous.length === next.length;
  const shared = next.map((item, index) => {
    const before = previousById.get(item.id);
    const kept = before && structurallyEqual(before, item) ? before : item;
    if (kept !== previous[index]) identical = false;
    return kept;
  });
  return identical ? (previous as T[]) : shared;
}
