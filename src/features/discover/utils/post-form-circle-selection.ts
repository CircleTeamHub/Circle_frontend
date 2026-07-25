export type PostFormCircleSelection = {
  id: string;
  name: string;
};

// 合并「我创建的 + 我加入的」圈子为去重列表，作为发帖时「当前可用圈子」的权威来源。
// 与 SelectCircleScreen 的合并顺序一致（created 先入，joined 覆盖同 id）。
export function selectablePostFormCircles<T extends PostFormCircleSelection>(
  createdCircles: readonly T[],
  joinedCircles: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const circle of createdCircles) byId.set(circle.id, circle);
  for (const circle of joinedCircles) byId.set(circle.id, circle);
  return Array.from(byId.values());
}

export function arePostFormCircleSelectionsEqual(
  left: PostFormCircleSelection[],
  right: PostFormCircleSelection[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (circle, index) =>
      circle.id === right[index]?.id && circle.name === right[index]?.name,
  );
}

// 保留 selected 中「仍在权威成员列表 available 里」的圈子，同步最新名称并去重。
//
// available 是 fetchMyCircles 的结果 —— 后端权威列表，其 id 一律信任，绝不做 UUID
// 之类的格式校验：否则会误删后端合法但非 RFC-4122 的 id（legacy / v6 / v7 等），
// 与 plaza-feed-scope「不得静默丢弃后端 circle id」的不变量冲突。可用性的唯一判据
// 就是「是否出现在 available 里」。
export function filterAvailablePostFormCircles(
  selected: PostFormCircleSelection[],
  available: PostFormCircleSelection[],
): PostFormCircleSelection[] {
  const availableById = new Map(
    available.map((circle) => [circle.id, circle] as const),
  );
  const seen = new Set<string>();
  const filtered: PostFormCircleSelection[] = [];

  for (const circle of selected) {
    const current = availableById.get(circle.id);
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    filtered.push({ id: current.id, name: current.name });
  }

  return filtered;
}

// 返回 selected 中「不在权威成员列表 available 里」的圈子（发帖提交前校验用）。
// 只看 id 是否存在，不比较名称 —— 圈子改名不算失效。
export function findUnavailablePostFormCircles(
  selected: PostFormCircleSelection[],
  available: PostFormCircleSelection[],
): PostFormCircleSelection[] {
  const availableIds = new Set(available.map((circle) => circle.id));
  return selected.filter((circle) => !availableIds.has(circle.id));
}
