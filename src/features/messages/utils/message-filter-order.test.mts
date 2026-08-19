import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessageFilterOrder,
  orderMessageFilters,
  reorderMessageFilter,
} from './message-filter-order.ts';

const filters = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'group', label: 'Groups' },
  { id: 'private', label: 'Direct' },
  { id: 'custom:family', label: 'Family' },
];

test('message filter ordering can interleave built-in and custom groups', () => {
  assert.deepEqual(
    orderMessageFilters(filters, [
      'private',
      'custom:family',
      'all',
      'group',
      'unread',
    ]).map((item) => item.id),
    ['private', 'custom:family', 'all', 'group', 'unread'],
  );
});

test('message filter ordering ignores stale ids and appends new groups', () => {
  assert.deepEqual(
    normalizeMessageFilterOrder(filters, ['custom:removed', 'private', 'all']),
    ['private', 'all', 'unread', 'group', 'custom:family'],
  );
});

test('message filter reorder moves fixed filters and clamps target indexes', () => {
  assert.deepEqual(
    reorderMessageFilter(['all', 'unread', 'group', 'private'], 'all', 3),
    ['unread', 'group', 'private', 'all'],
  );
  assert.deepEqual(
    reorderMessageFilter(['all', 'unread', 'group', 'private'], 'private', -1),
    ['private', 'all', 'unread', 'group'],
  );
});
