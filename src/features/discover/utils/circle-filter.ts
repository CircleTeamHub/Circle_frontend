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
        // 有意为之（#116）：空 cities = 「未设置」而不是「全国」。「全国可见」在
        // 数据模型里是显式取值（city-selection.ts 的 NATIONWIDE_CITY_VALUE）——
        // 运营者必须主动声明覆盖范围；让空值悄悄等于全国会奖励不填数据的圈子。
        // 因此任何城市筛选下，未设置城市的圈子不可见（清空筛选才出现）。
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
