export type PostFormCircleSelection = {
  id: string;
  name: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPostFormCircleId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export function arePostFormCircleIdsValid(
  circles: PostFormCircleSelection[],
): boolean {
  return circles.every((circle) => isValidPostFormCircleId(circle.id));
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

export function filterAvailablePostFormCircles(
  selected: PostFormCircleSelection[],
  available: PostFormCircleSelection[],
): PostFormCircleSelection[] {
  const availableById = new Map(
    available
      .filter((circle) => isValidPostFormCircleId(circle.id))
      .map((circle) => [circle.id, circle]),
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
