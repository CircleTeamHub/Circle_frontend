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
