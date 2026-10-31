import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_TIERS,
  clampCreditScore,
  getCreditTierEnd,
  getCreditTierIndex,
  getCreditTierRange,
} from './credit-tiers.ts';

test('clamps scores into 0–100 and drops non-finite values', () => {
  assert.equal(clampCreditScore(Number.NaN), 0);
  assert.equal(clampCreditScore(-5), 0);
  assert.equal(clampCreditScore(74.9), 74);
  assert.equal(clampCreditScore(180), 100);
});

test('places boundary scores in the higher tier', () => {
  const keyOf = (score: number) => CREDIT_TIERS[getCreditTierIndex(score)].key;
  assert.equal(keyOf(0), 'low');
  assert.equal(keyOf(59), 'low');
  assert.equal(keyOf(60), 'basic');
  assert.equal(keyOf(75), 'good');
  assert.equal(keyOf(89), 'good');
  assert.equal(keyOf(90), 'excellent');
  assert.equal(keyOf(100), 'excellent');
});

// 进度条按档位分段，各段终点首尾相接、最后一段封顶满分，不能漏分也不能重叠。
test('tier spans tile the whole 0–100 axis', () => {
  const ends = CREDIT_TIERS.map((_tier, index) => getCreditTierEnd(index));
  assert.deepEqual(ends, [60, 75, 90, 100]);
  const ranges = CREDIT_TIERS.map((_tier, index) => getCreditTierRange(index));
  assert.deepEqual(ranges, [
    { min: 0, max: 59 },
    { min: 60, max: 74 },
    { min: 75, max: 89 },
    { min: 90, max: 100 },
  ]);
});
