import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceCircleLoadFailure } from './circle-detail-load-state.ts';

const priorCircle = { id: 'circle-1', name: 'Existing circle' };

test('silent network and 500 failures preserve a previously loaded circle', () => {
  for (const failure of ['network', 'server'] as const) {
    assert.deepEqual(
      reduceCircleLoadFailure({
        circle: priorCircle,
        hasLoaded: true,
        isLatestRequest: true,
        isNotFound: false,
      }),
      { circle: priorCircle, hasLoaded: true, applyError: true },
      failure,
    );
  }
});

test('an explicit 404 clears a previously loaded circle', () => {
  assert.deepEqual(
    reduceCircleLoadFailure({
      circle: priorCircle,
      hasLoaded: true,
      isLatestRequest: true,
      isNotFound: true,
    }),
    { circle: null, hasLoaded: false, applyError: true },
  );
});

test('a stale request failure is ignored', () => {
  assert.deepEqual(
    reduceCircleLoadFailure({
      circle: priorCircle,
      hasLoaded: true,
      isLatestRequest: false,
      isNotFound: true,
    }),
    { circle: priorCircle, hasLoaded: true, applyError: false },
  );
});
