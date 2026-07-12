export function reduceCircleLoadFailure<T>({
  circle,
  hasLoaded,
  isLatestRequest,
  isNotFound,
}: {
  circle: T | null;
  hasLoaded: boolean;
  isLatestRequest: boolean;
  isNotFound: boolean;
}): { circle: T | null; hasLoaded: boolean; applyError: boolean } {
  if (!isLatestRequest) {
    return { circle, hasLoaded, applyError: false };
  }

  if (isNotFound) {
    return { circle: null, hasLoaded: false, applyError: true };
  }

  return { circle, hasLoaded, applyError: true };
}
