import type { Circle } from '@/types';

export interface CircleFilterCriteria {
  circleIds: string[];
  cities: string[];
}

export function applyCircleFilter<T extends Pick<Circle, 'id' | 'cities'>>(
  circles: T[],
  { circleIds, cities }: CircleFilterCriteria,
): T[] {
  if (circleIds.length === 0 && cities.length === 0) {
    return circles;
  }

  const idSet = circleIds.length > 0 ? new Set(circleIds) : null;
  const citySet = cities.length > 0 ? new Set(cities) : null;

  return circles.filter((circle) => {
    if (idSet && !idSet.has(circle.id)) {
      return false;
    }

    if (citySet) {
      const circleCities = circle.cities ?? [];
      if (circleCities.length === 0) {
        return false;
      }
      const hasOverlap = circleCities.some((city) => citySet.has(city));
      if (!hasOverlap) {
        return false;
      }
    }

    return true;
  });
}
