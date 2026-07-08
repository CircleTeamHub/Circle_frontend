import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orderCircleShortcuts,
  reorderCircleShortcut,
} from './circle-shortcut-order.ts';

const circles = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

test('circle shortcut ordering uses saved ids first and appends new circles in default order', () => {
  assert.deepEqual(
    orderCircleShortcuts(circles, ['c', 'missing', 'a']).map((circle) => circle.id),
    ['c', 'a', 'b'],
  );
});

test('circle shortcut reorder moves an item to a drag target index and clamps at the edges', () => {
  assert.deepEqual(reorderCircleShortcut(['a', 'b', 'c'], 'b', 0), ['b', 'a', 'c']);
  assert.deepEqual(reorderCircleShortcut(['a', 'b', 'c'], 'b', 2), ['a', 'c', 'b']);
  assert.deepEqual(reorderCircleShortcut(['a', 'b', 'c'], 'a', -10), ['a', 'b', 'c']);
  assert.deepEqual(reorderCircleShortcut(['a', 'b', 'c'], 'a', 99), ['b', 'c', 'a']);
});
