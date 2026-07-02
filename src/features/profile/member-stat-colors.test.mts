import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCreditStatBackground,
  getCreditStatTextColor,
  getVipStatBackground,
  getVipStatTextColor,
} from './member-stat-colors.ts';

test('VIP stat background uses a black glass scale and clamps to the top tier', () => {
  assert.equal(getVipStatBackground(0), 'rgba(0, 0, 0, 0.42)');
  assert.equal(getVipStatBackground(1), 'rgba(0, 0, 0, 0.48)');
  assert.equal(getVipStatBackground(3), 'rgba(0, 0, 0, 0.60)');
  assert.equal(getVipStatBackground(5), 'rgba(0, 0, 0, 0.72)');
  assert.equal(getVipStatBackground(99), 'rgba(0, 0, 0, 0.72)');
  assert.equal(getVipStatTextColor(), '#FFFFFF');
});

test('credit stat background uses a white glass scale with dark text', () => {
  assert.equal(getCreditStatBackground(0), 'rgba(255, 255, 255, 0.52)');
  assert.equal(getCreditStatBackground(45), 'rgba(255, 255, 255, 0.60)');
  assert.equal(getCreditStatBackground(80), 'rgba(255, 255, 255, 0.72)');
  assert.equal(getCreditStatBackground(100), 'rgba(255, 255, 255, 0.78)');
  assert.equal(getCreditStatTextColor(), '#111827');
  assert.notEqual(getVipStatBackground(5), getCreditStatBackground(100));
});
