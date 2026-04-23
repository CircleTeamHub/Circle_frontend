import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CITY_SELECTION,
  buildInitialCityPickerState,
  resolveMultiCitySelection,
  resolveSingleCitySelection,
  toggleCitySelection,
} from './city-selection.ts';

test('single-select mode restores one selected city', () => {
  const state = buildInitialCityPickerState({
    isMultiSelect: false,
    singleCity: '上海',
    multiCities: [],
  });

  assert.deepEqual(state, {
    selected: ['上海'],
    isNationwide: false,
  });
});

test('single-select mode restores nationwide selection', () => {
  const state = buildInitialCityPickerState({
    isMultiSelect: false,
    singleCity: '全国',
    multiCities: [],
  });

  assert.deepEqual(state, {
    selected: [],
    isNationwide: true,
  });
});

test('multi-select mode treats empty selection as nationwide', () => {
  const state = buildInitialCityPickerState({
    isMultiSelect: true,
    singleCity: null,
    multiCities: [],
  });

  assert.deepEqual(state, {
    selected: [],
    isNationwide: true,
  });
});

test('single-select mode replaces the previous city instead of appending', () => {
  const result = toggleCitySelection({
    current: ['上海'],
    city: '北京',
    isMultiSelect: false,
  });

  assert.deepEqual(result, {
    nextSelected: ['北京'],
    reachedLimit: false,
  });
});

test('multi-select mode enforces the maximum city limit', () => {
  const current = Array.from(
    { length: MAX_CITY_SELECTION },
    (_, index) => `城市${index + 1}`,
  );

  const result = toggleCitySelection({
    current,
    city: '额外城市',
    isMultiSelect: true,
  });

  assert.equal(result.reachedLimit, true);
  assert.deepEqual(result.nextSelected, current);
});

test('selection resolvers return API-safe values', () => {
  assert.equal(resolveSingleCitySelection(['广州'], false), '广州');
  assert.equal(resolveSingleCitySelection([], true), '全国');
  assert.equal(resolveSingleCitySelection([], false), null);
  assert.deepEqual(resolveMultiCitySelection(['广州', '深圳'], false), [
    '广州',
    '深圳',
  ]);
  assert.deepEqual(resolveMultiCitySelection(['广州'], true), []);
});
