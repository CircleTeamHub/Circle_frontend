import assert from 'node:assert/strict';
import test from 'node:test';

import { getKnownClearTargetHeight } from './clear-history-target.ts';

test('uses the highest confirmed conversation or timeline height', () => {
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: { height: 42 } },
      [{ height: 39 }, { height: 41 }],
    ),
    42,
  );
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: { height: 40 } },
      [{ height: 43 }, { height: 41 }],
    ),
    43,
  );
});

test('omits the target when no trustworthy height is available', () => {
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: null },
      [{ height: Number.POSITIVE_INFINITY }, { height: -1 }],
    ),
    undefined,
  );
});
