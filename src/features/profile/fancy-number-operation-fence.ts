import type {
  FancyNumberItem,
  FancyNumberList,
} from '@/services/api/fancy-number';

let latestOperation = 0;

export function beginFancyNumberOperation(): number {
  latestOperation += 1;
  return latestOperation;
}

export function isLatestFancyNumberOperation(operation: number): boolean {
  return operation === latestOperation;
}

export function hasMatchingFancyNumberCatalogQuote(
  current: FancyNumberList,
  next: FancyNumberList,
): boolean {
  return (
    current.unitPrice === next.unitPrice &&
    current.minMonths === next.minMonths &&
    current.maxMonths === next.maxMonths &&
    current.purchaseMode === next.purchaseMode
  );
}

export function hasConflictingFancyNumberRecommendations(
  current: readonly Pick<FancyNumberItem, 'id' | 'value'>[],
  next: readonly Pick<FancyNumberItem, 'id' | 'value'>[],
): boolean {
  const valueById = new Map<string, string>();
  const idByValue = new Map<string, string>();
  for (const item of [...current, ...next]) {
    const knownValue = valueById.get(item.id);
    const knownId = idByValue.get(item.value);
    if (
      (knownValue !== undefined && knownValue !== item.value) ||
      (knownId !== undefined && knownId !== item.id)
    ) {
      return true;
    }
    valueById.set(item.id, item.value);
    idByValue.set(item.value, item.id);
  }
  return false;
}
