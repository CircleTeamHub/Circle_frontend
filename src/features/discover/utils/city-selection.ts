export const MAX_CITY_SELECTION = 10;

// 单选模式下的「全国」标记 —— 后端约定值。前端不通过 i18n 翻译这个常量，因为它是 wire format
// 的一部分；UI 展示的「全国」label 由 i18n 单独提供。
export const NATIONWIDE_CITY_VALUE = '全国';

type BuildInitialCityPickerStateArgs = {
  isMultiSelect: boolean;
  singleCity: string | null;
  multiCities: string[];
  emptyMultiSelectIsNationwide?: boolean;
};

type ToggleCitySelectionArgs = {
  current: string[];
  city: string;
  isMultiSelect: boolean;
  maxCities?: number;
};

export function buildInitialCityPickerState({
  isMultiSelect,
  singleCity,
  multiCities,
  emptyMultiSelectIsNationwide = true,
}: BuildInitialCityPickerStateArgs) {
  if (isMultiSelect) {
    return {
      selected: multiCities,
      isNationwide: emptyMultiSelectIsNationwide && multiCities.length === 0,
    };
  }

  if (singleCity === NATIONWIDE_CITY_VALUE) {
    return {
      selected: [],
      isNationwide: true,
    };
  }

  return {
    selected: singleCity ? [singleCity] : [],
    isNationwide: false,
  };
}

export function toggleCitySelection({
  current,
  city,
  isMultiSelect,
  maxCities = MAX_CITY_SELECTION,
}: ToggleCitySelectionArgs) {
  if (!isMultiSelect) {
    return {
      nextSelected: [city],
      reachedLimit: false,
    };
  }

  if (current.includes(city)) {
    return {
      nextSelected: current.filter((value) => value !== city),
      reachedLimit: false,
    };
  }

  if (current.length >= maxCities) {
    return {
      nextSelected: current,
      reachedLimit: true,
    };
  }

  return {
    nextSelected: [...current, city],
    reachedLimit: false,
  };
}

export function resolveSingleCitySelection(
  selected: string[],
  isNationwide: boolean,
) {
  if (isNationwide) {
    return NATIONWIDE_CITY_VALUE;
  }

  return selected[0] ?? null;
}

export function resolveMultiCitySelection(
  selected: string[],
  isNationwide: boolean,
) {
  if (isNationwide) {
    return [];
  }

  return selected;
}

/**
 * 发现页筛选的城市数上限。
 *
 * `programStatusKnown` 为 false 表示会员计划状态未知（冷启动首拉失败且无缓存）。此时
 * 不能按 floor 0 处理 —— 那会把一次瞬时的接口失败放大成「一个城市都选不了」；改用通用
 * 默认，等状态到手后再按真实档位收敛。
 *
 * `'unlimited'` 映射为 Infinity，调用方据此不设上限。
 */
export function resolveFilterCityLimit(
  cityLimitEntitlement: number | 'unlimited',
  programStatusKnown: boolean,
): number {
  if (!programStatusKnown) {
    return MAX_CITY_SELECTION;
  }

  return cityLimitEntitlement === 'unlimited'
    ? Number.POSITIVE_INFINITY
    : cityLimitEntitlement;
}

/**
 * 把待写回的城市按当前上限收敛。
 *
 * 选择页停留期间权益可能下调（会员计划正式启用会把 floor 从 2 降回 0），此时上限变小
 * 而已选列表不会自动缩短。写回前必须收敛，否则会存下超出权益的城市，信息流随后被后端
 * 以 CITY_FILTER_QUOTA_REACHED 整体拒绝。
 */
export function clampCitiesToLimit(cities: string[], limit: number): string[] {
  return cities.slice(0, limit);
}
