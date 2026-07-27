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
