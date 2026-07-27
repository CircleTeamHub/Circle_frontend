import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCursorPages } from './collect-cursor-pages.ts';

type Item = { id: string };

test('collectCursorPages follows the last id until a short page', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `circle-${index}`,
  }));
  const cursors: Array<string | undefined> = [];

  const result = await collectCursorPages<Item>(
    async (cursor) => {
      cursors.push(cursor);
      return cursor ? [{ id: 'circle-100' }, { id: 'circle-101' }] : firstPage;
    },
    100,
  );

  assert.deepEqual(cursors, [undefined, 'circle-99']);
  assert.equal(result.length, 102);
  assert.equal(result.at(-1)?.id, 'circle-101');
});

test('collectCursorPages de-duplicates ids across adjacent pages', async () => {
  const result = await collectCursorPages<Item>(
    async (cursor) =>
      cursor
        ? [{ id: 'circle-2' }]
        : [{ id: 'circle-1' }, { id: 'circle-2' }],
    2,
  );

  assert.deepEqual(result, [
    { id: 'circle-1' },
    { id: 'circle-2' },
  ]);
});

test('collectCursorPages rejects incomplete and non-progressing pagination', async () => {
  await assert.rejects(
    collectCursorPages<Item>(
      async (cursor) => {
        if (cursor) throw new Error('second page failed');
        return [{ id: 'circle-1' }];
      },
      1,
    ),
    /second page failed/,
  );

  await assert.rejects(
    collectCursorPages<Item>(async () => [{ id: 'circle-1' }], 1),
    /cursor did not advance/,
  );
});

test('collectCursorPages rejects a multi-step cursor cycle (A -> B -> A)', async () => {
  // 每页都是满页，且游标在 A / B 之间来回：只比较「与上一个游标是否相同」永远不会
  // 命中，旧实现会无限请求下去。
  let calls = 0;
  await assert.rejects(
    collectCursorPages<Item>(async (cursor) => {
      calls += 1;
      if (calls > 10) throw new Error('looped without terminating');
      return cursor === 'circle-a'
        ? [{ id: 'circle-x' }, { id: 'circle-b' }]
        : [{ id: 'circle-y' }, { id: 'circle-a' }];
    }, 2),
    /cursor did not advance/,
  );
  assert.ok(calls <= 10, 'should stop well before the loop guard');
});
