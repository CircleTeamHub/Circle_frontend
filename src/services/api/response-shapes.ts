import type { DisplayIcon } from '@/types';
import { isPlainObject } from '@/utils/validate';

/** Shared boundary shape for display icons returned by auth and icon APIs. */
export function isDisplayIconShape(value: unknown): value is DisplayIcon {
  if (!isPlainObject(value)) return false;

  return (
    typeof value.id === 'string' &&
    (value.type === 'SYSTEM' || value.type === 'CIRCLE') &&
    typeof value.title === 'string' &&
    (value.imageUrl === null || typeof value.imageUrl === 'string') &&
    (value.fallbackIconName === null || typeof value.fallbackIconName === 'string') &&
    typeof value.sortOrder === 'number' &&
    Number.isFinite(value.sortOrder) &&
    (value.circleId === undefined || typeof value.circleId === 'string') &&
    (value.circleName === undefined || typeof value.circleName === 'string') &&
    (value.systemKey === undefined || typeof value.systemKey === 'string') &&
    (value.systemVariant === undefined || typeof value.systemVariant === 'string') &&
    (value.recognitionCount === undefined ||
      (typeof value.recognitionCount === 'number' && Number.isFinite(value.recognitionCount)))
  );
}
