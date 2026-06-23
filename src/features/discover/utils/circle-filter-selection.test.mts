import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CIRCLE_FILTER_SELECTION,
  clampCircleFilterIds,
  mergeCircleFilterSelection,
  toggleCircleFilterSelection,
} from './circle-filter-selection.ts';

test('circle filter selection is capped at the backend multi-filter limit', () => {
  const ids = Array.from(
    { length: MAX_CIRCLE_FILTER_SELECTION + 10 },
    (_, index) => `circle-${index + 1}`,
  );

  assert.deepEqual(
    clampCircleFilterIds(ids),
    ids.slice(0, MAX_CIRCLE_FILTER_SELECTION),
  );
});

test('circle filter toggle refuses additional selections after the cap', () => {
  const current = Array.from(
    { length: MAX_CIRCLE_FILTER_SELECTION },
    (_, index) => `circle-${index + 1}`,
  );

  const result = toggleCircleFilterSelection({
    current,
    circleId: 'circle-extra',
  });

  assert.equal(result.reachedLimit, true);
  assert.deepEqual(result.nextSelected, current);
});

test('select all merges only up to the cap and reports truncation', () => {
  const current = ['circle-1'];
  const candidates = Array.from(
    { length: MAX_CIRCLE_FILTER_SELECTION + 5 },
    (_, index) => `circle-${index + 1}`,
  );

  const result = mergeCircleFilterSelection({ current, candidates });

  assert.equal(result.reachedLimit, true);
  assert.equal(result.nextSelected.length, MAX_CIRCLE_FILTER_SELECTION);
  assert.deepEqual(
    result.nextSelected,
    candidates.slice(0, MAX_CIRCLE_FILTER_SELECTION),
  );
});
