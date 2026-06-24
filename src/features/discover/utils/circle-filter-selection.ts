export const MAX_CIRCLE_FILTER_SELECTION = 50;

type SelectionResult = {
  nextSelected: string[];
  reachedLimit: boolean;
};

export function clampCircleFilterIds(
  ids: string[],
  maxItems = MAX_CIRCLE_FILTER_SELECTION,
): string[] {
  return ids.slice(0, maxItems);
}

export function toggleCircleFilterSelection({
  current,
  circleId,
  maxItems = MAX_CIRCLE_FILTER_SELECTION,
}: {
  current: string[];
  circleId: string;
  maxItems?: number;
}): SelectionResult {
  if (current.includes(circleId)) {
    return {
      nextSelected: current.filter((id) => id !== circleId),
      reachedLimit: false,
    };
  }

  if (current.length >= maxItems) {
    return {
      nextSelected: current,
      reachedLimit: true,
    };
  }

  return {
    nextSelected: [...current, circleId],
    reachedLimit: false,
  };
}

export function mergeCircleFilterSelection({
  current,
  candidates,
  maxItems = MAX_CIRCLE_FILTER_SELECTION,
}: {
  current: string[];
  candidates: string[];
  maxItems?: number;
}): SelectionResult {
  const merged = new Set(current);
  for (const id of candidates) {
    merged.add(id);
  }

  const nextSelected = clampCircleFilterIds(Array.from(merged), maxItems);
  return {
    nextSelected,
    reachedLimit: merged.size > nextSelected.length,
  };
}
