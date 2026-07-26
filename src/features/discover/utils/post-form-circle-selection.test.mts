import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAvailablePostFormCircles,
  findUnavailablePostFormCircles,
  selectablePostFormCircles,
} from './post-form-circle-selection.ts';

test('filterAvailablePostFormCircles keeps only circles present in the authoritative list and syncs names', () => {
  const filtered = filterAvailablePostFormCircles(
    [
      { id: 'c1', name: 'old name' },
      { id: 'gone', name: 'left circle' },
    ],
    [{ id: 'c1', name: 'new name' }],
  );
  assert.deepEqual(filtered, [{ id: 'c1', name: 'new name' }]);
});

test('filterAvailablePostFormCircles trusts opaque / non-RFC backend ids in the list (no UUID format filtering)', () => {
  // v7 UUID 与 legacy 短 id：只要后端成员列表返回了就是可用的，绝不能被格式规则
  // 丢弃（与 plaza-feed-scope「不得静默丢弃后端 circle id」不变量一致）。
  const available = [
    { id: '018f1234-5678-7abc-8def-0123456789ab', name: 'v7 circle' },
    { id: 'legacy-42', name: 'legacy circle' },
  ];
  const filtered = filterAvailablePostFormCircles(
    available.map((c) => ({ ...c })),
    available,
  );
  assert.deepEqual(filtered, available);
});

test('findUnavailablePostFormCircles returns selections missing from the authoritative list', () => {
  const unavailable = findUnavailablePostFormCircles(
    [
      { id: 'c1', name: 'A' },
      { id: 'gone', name: 'B' },
    ],
    [{ id: 'c1', name: 'A' }],
  );
  assert.deepEqual(unavailable, [{ id: 'gone', name: 'B' }]);
});

test('findUnavailablePostFormCircles never flags an opaque id that is present in the list', () => {
  const unavailable = findUnavailablePostFormCircles(
    [
      { id: '018f1234-5678-7abc-8def-0123456789ab', name: 'v7' },
      { id: 'legacy-42', name: 'legacy' },
    ],
    [
      { id: '018f1234-5678-7abc-8def-0123456789ab', name: 'v7' },
      { id: 'legacy-42', name: 'legacy' },
    ],
  );
  assert.deepEqual(unavailable, []);
});

test('selectablePostFormCircles merges created and joined, deduping by id', () => {
  const merged = selectablePostFormCircles(
    [{ id: 'x', name: 'created x' }],
    [
      { id: 'y', name: 'joined y' },
      { id: 'x', name: 'joined x dup' },
    ],
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(new Set(merged.map((c) => c.id)), new Set(['x', 'y']));
});
