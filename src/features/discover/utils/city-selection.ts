export const MAX_CITY_SELECTION = 10;

type BuildInitialCityPickerStateArgs = {
  isMultiSelect: boolean;
  singleCity: string | null;
  multiCities: string[];
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
}: BuildInitialCityPickerStateArgs) {
  if (isMultiSelect) {
    return {
      selected: multiCities,
      isNationwide: multiCities.length === 0,
    };
  }

  if (singleCity === '全国') {
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
    return '全国';
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
