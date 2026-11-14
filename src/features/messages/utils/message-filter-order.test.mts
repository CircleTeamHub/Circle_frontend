import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagedFilterOrder,
  changedGroupOrder,
  groupIdFromFilterId,
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

test('managed order lists built-ins first and appends every group, hidden ones included', () => {
  assert.deepEqual(buildManagedFilterOrder(['g-1', 'g-2'], []), [
    'all',
    'unread',
    'group',
    'private',
    'custom:g-1',
    'custom:g-2',
  ]);
});

test('managed order keeps the saved interleaving and drops deleted groups', () => {
  assert.deepEqual(
    buildManagedFilterOrder(['g-2', 'g-3'], [
      'custom:g-2',
      'all',
      'custom:g-1',
      'private',
      'unread',
      'group',
    ]),
    ['custom:g-2', 'all', 'private', 'unread', 'group', 'custom:g-3'],
  );
});

test('moving only built-in tabs does not touch the server group order', () => {
  assert.equal(
    changedGroupOrder(
      ['all', 'unread', 'custom:g-1', 'custom:g-2'],
      ['unread', 'custom:g-1', 'all', 'custom:g-2'],
    ),
    null,
  );
});

test('swapping two groups reports the new relative group order', () => {
  assert.deepEqual(
    changedGroupOrder(
      ['all', 'custom:g-1', 'unread', 'custom:g-2'],
      ['all', 'custom:g-2', 'unread', 'custom:g-1'],
    ),
    ['g-2', 'g-1'],
  );
});

test('only custom filter ids map back to a group id', () => {
  assert.equal(groupIdFromFilterId('custom:abc'), 'abc');
  assert.equal(groupIdFromFilterId('private'), null);
});
