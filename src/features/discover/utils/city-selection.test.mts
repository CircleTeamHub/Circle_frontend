import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CITY_SELECTION,
  buildInitialCityPickerState,
  clampCitiesToLimit,
  resolveFilterCityLimit,
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

test('filter multi-select mode treats empty selection as no city filter', () => {
  const state = buildInitialCityPickerState({
    isMultiSelect: true,
    singleCity: null,
    multiCities: [],
    emptyMultiSelectIsNationwide: false,
  });

  assert.deepEqual(state, {
    selected: [],
    isNationwide: false,
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

test('filter city limit falls back to the generic default when program status is unknown', () => {
  // 计划状态未拉到（冷启动首拉失败且无缓存）：即便按 vipLevel 算出的权益是 0，
  // 也不能把用户封成一个城市都选不了 —— 那是把一次瞬时接口失败放大成功能不可用。
  assert.equal(resolveFilterCityLimit(0, false), MAX_CITY_SELECTION);
  assert.equal(resolveFilterCityLimit('unlimited', false), MAX_CITY_SELECTION);
});

test('filter city limit follows the entitlement once program status is known', () => {
  assert.equal(resolveFilterCityLimit(0, true), 0);
  assert.equal(resolveFilterCityLimit(10, true), 10);
  assert.equal(resolveFilterCityLimit(50, true), 50);
  assert.equal(
    resolveFilterCityLimit('unlimited', true),
    Number.POSITIVE_INFINITY,
  );
});

test('cities are clamped to the current limit before being written back', () => {
  // floor 由 2 回落到 0（计划正式启用）后重新确认：旧的已选城市必须被收敛掉，
  // 否则会写回超出权益的城市，信息流被后端整体拒绝。
  assert.deepEqual(clampCitiesToLimit(['广州', '深圳', '北京'], 0), []);
  assert.deepEqual(clampCitiesToLimit(['广州', '深圳', '北京'], 2), [
    '广州',
    '深圳',
  ]);
  // 上限未收紧时原样保留，'unlimited' 映射来的 Infinity 也不应截断。
  assert.deepEqual(clampCitiesToLimit(['广州', '深圳'], 10), ['广州', '深圳']);
  assert.deepEqual(
    clampCitiesToLimit(['广州', '深圳'], Number.POSITIVE_INFINITY),
    ['广州', '深圳'],
  );
});
