import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arePostFormCircleIdsValid,
  filterAvailablePostFormCircles,
} from './post-form-circle-selection.ts';

test('filters stale selected circles that are no longer in the available circle list', () => {
  const filtered = filterAvailablePostFormCircles(
    [
      { id: '07b8cd30-afdf-3b74-5dfe-6dd5b422364b', name: 'old shanghai' },
      { id: '07b8cd30-afdf-5b74-9dfe-6dd5b422364b', name: '上海同城交友' },
    ],
    [{ id: '07b8cd30-afdf-5b74-9dfe-6dd5b422364b', name: '上海同城交友' }],
  );

  assert.deepEqual(filtered, [
    { id: '07b8cd30-afdf-5b74-9dfe-6dd5b422364b', name: '上海同城交友' },
  ]);
});

test('rejects selected circle ids that only look uuid-shaped but fail RFC UUID variant bits', () => {
  assert.equal(
    arePostFormCircleIdsValid([
      { id: '07b8cd30-afdf-3b74-5dfe-6dd5b422364b', name: 'old shanghai' },
    ]),
    false,
  );
  assert.equal(
    arePostFormCircleIdsValid([
      { id: '07b8cd30-afdf-5b74-9dfe-6dd5b422364b', name: '上海同城交友' },
    ]),
    true,
  );
});
