import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdempotencyKey } from './idempotency-key.ts';

// In node:test there is no expo-crypto and no CJS require, so the generator
// exercises its fallback path — which must still yield usable, distinct keys.
test('generateIdempotencyKey returns a non-empty string', () => {
  const key = generateIdempotencyKey();
  assert.equal(typeof key, 'string');
  assert.ok(key.length > 0);
});

test('generateIdempotencyKey returns distinct keys across calls', () => {
  const keys = new Set(
    Array.from({ length: 20 }, () => generateIdempotencyKey()),
  );
  assert.equal(keys.size, 20);
});
