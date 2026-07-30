import type { FancyNumberList } from '@/services/api/fancy-number';

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
